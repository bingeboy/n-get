/**
 * @fileoverview SFTP download manager with SSH authentication support
 * Handles SFTP downloads, connection management, and SSH key authentication
 * @module sftpManager
 */

const fs = require('node:fs');
const path = require('node:path');
const {Transform} = require('node:stream');
const SftpClient = require('ssh2-sftp-client');
const ui = require('./ui');
const resumeManager = require('./resumeManager');

/**
 * SFTP Manager for handling SSH/SFTP downloads with authentication and connection caching
 * Supports key-based authentication, password authentication, and connection reuse
 */
class SftpManager {
    constructor() {
        this.connections = new Map(); // Cache connections per server
        this.defaultPort = 22;
    }

    /**
     * Parse SFTP URL and extract connection details
     */
    parseSftpUrl(url) {
        try {
            const urlObject = new URL(url);

            if (urlObject.protocol !== 'sftp:') {
                throw new Error('Not an SFTP URL');
            }

            const connection = {
                host: urlObject.hostname,
                port: urlObject.port ? Number.parseInt(urlObject.port) : this.defaultPort,
                username: urlObject.username || process.env.USER || 'anonymous',
                password: urlObject.password || null,
                remotePath: decodeURIComponent(urlObject.pathname),
                filename: path.basename(urlObject.pathname),
            };

            if (!connection.host) {
                throw new Error('Invalid SFTP URL: missing hostname');
            }

            if (!connection.remotePath || connection.remotePath === '/') {
                throw new Error('Invalid SFTP URL: missing file path');
            }

            return connection;
        } catch (error) {
            throw new Error(`Failed to parse SFTP URL: ${error.message}`);
        }
    }

    /**
     * Get SSH connection key for caching
     */
    getConnectionKey(config) {
        return `${config.username}@${config.host}:${config.port}`;
    }

    /**
     * Create SSH connection configuration
     */
    async createConnectionConfig(config, options = {}) {
        const sshConfig = {
            host: config.host,
            port: config.port,
            username: config.username,
            readyTimeout: options.timeout || 30000,
            algorithms: {
                kex: ['ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521', 'diffie-hellman-group14-sha256'],
                serverHostKey: ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa', 'ecdsa-sha2-nistp256'],
                cipher: ['aes128-gcm', 'aes256-gcm', 'aes128-ctr', 'aes256-ctr'],
                hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1'],
            },
        };

        // Authentication methods in order of preference
        if (options.privateKey) {
            sshConfig.privateKey = options.privateKey;
            sshConfig.passphrase = options.passphrase;
        } else if (options.keyPath) {
            try {
                sshConfig.privateKey = await fs.promises.readFile(options.keyPath);
                sshConfig.passphrase = options.passphrase;
            } catch (error) {
                throw new Error(`Failed to read SSH key: ${error.message}`);
            }
        } else if (config.password) {
            sshConfig.password = config.password;
        } else if (options.password) {
            sshConfig.password = options.password;
        } else {
            // Try default SSH key locations
            const defaultKeyPaths = [
                path.join(process.env.HOME || process.env.USERPROFILE || '', '.ssh', 'id_rsa'),
                path.join(process.env.HOME || process.env.USERPROFILE || '', '.ssh', 'id_ed25519'),
                path.join(process.env.HOME || process.env.USERPROFILE || '', '.ssh', 'id_ecdsa'),
            ];

            // Try default SSH key locations asynchronously
            for (const keyPath of defaultKeyPaths) {
                try {
                    await fs.promises.access(keyPath);
                    sshConfig.privateKey = await fs.promises.readFile(keyPath);
                    break;
                } catch {
                    // Try next key
                    continue;
                }
            }

            if (!sshConfig.privateKey) {
                throw new Error('No authentication method available. Provide password, private key, or ensure SSH keys are in ~/.ssh/');
            }
        }

        return sshConfig;
    }

    /**
     * Get or create SFTP connection
     */
    async getConnection(config, options = {}) {
        const connectionKey = this.getConnectionKey(config);

        // Check for existing connection
        if (this.connections.has(connectionKey)) {
            const cachedConnection = this.connections.get(connectionKey);
            try {
                // Test connection
                await cachedConnection.cwd();
                return cachedConnection;
            } catch {
                // Connection is stale, remove from cache
                this.connections.delete(connectionKey);
            }
        }

        // Create new connection
        const sftp = new SftpClient();
        const sshConfig = await this.createConnectionConfig(config, options);

        try {
            ui.displayInfo(`Connecting to ${config.username}@${config.host}:${config.port}...`);
            await sftp.connect(sshConfig);

            // Cache the connection
            this.connections.set(connectionKey, sftp);

            ui.displaySuccess(`Connected to ${config.host}`);
            return sftp;
        } catch (error) {
            throw new Error(`SFTP connection failed: ${error.message}`);
        }
    }

    /**
     * Get remote file information
     */
    async getFileInfo(sftp, remotePath) {
        try {
            const stats = await sftp.stat(remotePath);

            // Handle different SFTP server stat object formats
            let isFile; let isDirectory;

            if (typeof stats.isFile === 'function') {
                // Node.js fs.Stats-like object
                isFile = stats.isFile();
                isDirectory = stats.isDirectory();
            } else if (typeof stats.isFile === 'boolean') {
                // Some servers return boolean properties
                isFile = stats.isFile;
                isDirectory = stats.isDirectory;
            } else {
                // Fallback: determine from mode field (POSIX stat)
                const S_IFMT = 0o170000; // Bit mask for file type
                const S_IFREG = 0o100000; // Regular file
                const S_IFDIR = 0o040000; // Directory

                const fileType = stats.mode & S_IFMT;
                isFile = fileType === S_IFREG;
                isDirectory = fileType === S_IFDIR;
            }

            return {
                size: stats.size,
                mode: stats.mode,
                mtime: stats.mtime,
                isFile,
                isDirectory,
            };
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error(`Remote file not found: ${remotePath}`);
            }

            throw new Error(`Failed to get file info: ${error.message}`);
        }
    }

    /**
     * Check if SFTP server supports resume (always true for SFTP)
     */
    async checkResumeSupport(sftp, remotePath) {
        try {
            const fileInfo = await this.getFileInfo(sftp, remotePath);
            return {
                supportsResume: true,
                totalSize: fileInfo.size,
                lastModified: fileInfo.mtime,
                isFile: fileInfo.isFile,
            };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Create progress tracking transform for SFTP
     */
    createSftpProgressTracker(progressBar, totalSize, startByte = 0) {
        let downloaded = startByte;
        let lastUpdate = Date.now();
        let chunkCount = 0;

        return new Transform({
            transform(chunk, encoding, callback) {
                downloaded += chunk.length;
                chunkCount++;
                const now = Date.now();

                // Update progress every 500ms or every 10 chunks
                if (now - lastUpdate > 500 || chunkCount % 10 === 0) {
                    const speed = chunk.length / ((now - lastUpdate) / 1000);
                    lastUpdate = now;

                    if (progressBar) {
                        progressBar.update(downloaded, {
                            speed: ui.formatSpeed(speed),
                        });
                    }
                }

                callback(null, chunk);
            },
        });
    }

    /**
     * Download file via SFTP with resume support
     */
    async downloadFile(url, destination, index, total, enableResume = true, options = {}) {
        const startTime = process.hrtime();

        try {
            const config = this.parseSftpUrl(url);
            const sftp = await this.getConnection(config, options);

            // Set up local file path
            let localPath;
            localPath = destination ? path.join(destination, config.filename) : path.join(process.cwd(), config.filename);

            // Get remote file info
            const serverInfo = await this.checkResumeSupport(sftp, config.remotePath);

            if (!serverInfo.isFile) {
                throw new Error(`Remote path is not a file: ${config.remotePath}`);
            }

            const {totalSize} = serverInfo;
            let startByte = 0;
            let isResume = false;

            // Check for resume capability
            if (enableResume) {
                const resumeInfo = await resumeManager.checkPartialDownload(url, localPath, totalSize, {'last-modified': serverInfo.lastModified});

                if (resumeInfo.canResume) {
                    startByte = resumeInfo.resumeFrom;
                    isResume = true;
                    ui.displayDownloadStart(config.filename, totalSize, index, total, true, startByte);
                } else if (resumeInfo.isComplete) {
                    ui.displayInfo(`File already complete: ${config.filename}`);
                    return {
                        path: localPath,
                        size: totalSize,
                        duration: 0,
                        speed: 0,
                        resumed: false,
                        alreadyComplete: true,
                    };
                } else {
                    // Handle duplicate files
                    try {
                        await fs.promises.access(localPath);
                        const timestamp = new Date().toISOString();
                        localPath = `${localPath}(${timestamp})`;
                        ui.displayWarning(`Cannot resume SFTP download, renamed to: ${path.basename(localPath)}`);
                    } catch {
                        // File doesn't exist, proceed normally
                    }
                }
            }

            if (!isResume) {
                ui.displayDownloadStart(config.filename, totalSize, index, total);
            }

            // Create progress bar for large files
            let progressBar = null;
            if (totalSize > 1024) {
                progressBar = ui.createProgressBar(config.filename, totalSize);
                if (isResume) {
                    progressBar.update(startByte, {speed: 'Resuming...'});
                }
            }

            // Create write stream (append for resume, write for new)
            const writeStream = fs.createWriteStream(localPath, {
                flags: isResume ? 'a' : 'w',
                start: isResume ? startByte : 0,
            });

            // Create progress tracker
            const progressTracker = this.createSftpProgressTracker(progressBar, totalSize, startByte);

            // Download with SFTP
            const readStream = await sftp.createReadStream(config.remotePath, {
                start: startByte,
                end: totalSize - 1,
                flags: 'r',
                autoClose: true,
            });

            // Pipe with progress tracking
            await new Promise((resolve, reject) => {
                let hasErrored = false;

                readStream.on('error', error => {
                    if (!hasErrored) {
                        hasErrored = true;
                        reject(new Error(`SFTP read error: ${error.message}`));
                    }
                });

                writeStream.on('error', error => {
                    if (!hasErrored) {
                        hasErrored = true;
                        reject(new Error(`Write error: ${error.message}`));
                    }
                });

                writeStream.on('finish', () => {
                    if (!hasErrored) {
                        resolve();
                    }
                });

                readStream.pipe(progressTracker).pipe(writeStream);
            });

            // Calculate metrics
            const diff = process.hrtime(startTime);
            const durationMs = (diff[0] * 1e9 + diff[1]) / 1e6;
            const durationSeconds = durationMs / 1000;
            const downloadedBytes = isResume ? (totalSize - startByte) : totalSize;
            const speed = downloadedBytes > 0 ? downloadedBytes / durationSeconds : 0;

            // Display completion
            ui.displayDownloadComplete(config.filename, totalSize, durationSeconds, speed);

            // Save metadata for resume capability
            if (enableResume && !isResume) {
                await resumeManager.saveMetadata(url, localPath, totalSize, {
                    'last-modified': serverInfo.lastModified,
                });
            }

            // Clean up metadata on successful completion
            if (enableResume && isResume) {
                await resumeManager.cleanupMetadata(url, path.dirname(localPath));
            }

            return {
                path: localPath,
                size: totalSize,
                duration: durationMs,
                speed,
                resumed: isResume,
                resumeFrom: startByte,
            };
        } catch (error) {
            ui.displayError(`SFTP download failed: ${error.message}`, url);
            throw error;
        }
    }

    /**
     * Test SFTP connection
     */
    async testConnection(url, options = {}) {
        try {
            const config = this.parseSftpUrl(url);
            const sftp = await this.getConnection(config, options);

            // Test by listing current directory
            await sftp.cwd();
            return true;
        } catch (error) {
            throw new Error(`SFTP connection test failed: ${error.message}`);
        }
    }

    /**
     * List directory contents (for future directory download support)
     */
    async listDirectory(url, options = {}) {
        try {
            const config = this.parseSftpUrl(url);
            const sftp = await this.getConnection(config, options);

            const list = await sftp.list(config.remotePath);
            return list.map(item => ({
                name: item.name,
                size: item.size,
                type: item.type,
                modifyTime: item.modifyTime,
                isFile: item.type === '-',
                isDirectory: item.type === 'd',
            }));
        } catch (error) {
            throw new Error(`Failed to list directory: ${error.message}`);
        }
    }

    /**
     * Close all SFTP connections
     */
    async closeAllConnections() {
        const closePromises = [...this.connections.values()].map(async sftp => {
            try {
                await sftp.end();
            } catch {
                // Ignore close errors
            }
        });

        await Promise.all(closePromises);
        this.connections.clear();
    }

    /**
     * Close specific connection
     */
    async closeConnection(config) {
        const connectionKey = this.getConnectionKey(config);
        const sftp = this.connections.get(connectionKey);

        if (sftp) {
            try {
                await sftp.end();
            } catch {
                // Ignore close errors
            }

            this.connections.delete(connectionKey);
        }
    }
}

// Singleton instance
const sftpManager = new SftpManager();

// Cleanup connections on exit
process.on('SIGINT', async() => {
    await sftpManager.closeAllConnections();
    process.exit(0);
});

process.on('SIGTERM', async() => {
    await sftpManager.closeAllConnections();
    process.exit(0);
});

module.exports = sftpManager;
