/**
 * @fileoverview SFTP download manager with SSH authentication support
 * Handles SFTP downloads, connection management, and SSH key authentication
 * @module sftpManager
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {Transform} from 'node:stream';

import SftpClient = require('ssh2-sftp-client');
import ui = require('./ui');
import DownloadError from './errors/DownloadError';
import ConfigManager = require('./config/ConfigManager');
// resumeManager is a .js module without types — typed as any (no TS equivalent exists)
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
const resumeManager: any = require('./resumeManager');

interface ParsedSftpConnection {
    host: string;
    port: number;
    username: string;
    password: string | null;
    remotePath: string;
    filename: string;
}

interface SshConnectionConfig {
    host: string;
    port: number;
    username: string;
    readyTimeout: number;
    algorithms: Record<string, string[]>;
    privateKey?: Buffer;
    passphrase?: string;
    password?: string;
}

interface ResumeCheckHeaders {
    'last-modified'?: unknown;
    [key: string]: unknown;
}

interface DownloadOptions {
    outputToStdout?: boolean;
    stdoutMode?: boolean;
    quietMode?: boolean;
    configManager?: InstanceType<typeof ConfigManager> | null;
    timeout?: number;
    privateKey?: Buffer;
    passphrase?: string;
    keyPath?: string;
    password?: string;
}

interface DownloadResult {
    path: string;
    size: number;
    duration: number;
    speed: number;
    resumed: boolean;
    resumeFrom?: number;
    alreadyComplete?: boolean;
}

interface FileInfo {
    size: number;
    mode: number;
    mtime: number;
    isFile: boolean;
    isDirectory: boolean;
}

interface ResumeSupportResult {
    supportsResume: boolean;
    totalSize: number;
    lastModified: number;
    isFile: boolean;
}

interface DirectoryItem {
    name: string;
    size: number;
    type: string;
    modifyTime: number;
    isFile: boolean;
    isDirectory: boolean;
}

/**
 * SFTP Manager for handling SSH/SFTP downloads with authentication and connection caching
 * Supports key-based authentication, password authentication, and connection reuse
 */
class SftpManager {
    connections: Map<string, InstanceType<typeof SftpClient>>;
    defaultPort: number;

    constructor() {
        this.connections = new Map(); // Cache connections per server
        this.defaultPort = 22;
    }

    /**
     * Parse SFTP URL and extract connection details
     */
    parseSftpUrl(url: string): ParsedSftpConnection {
        try {
            const urlObject = new URL(url);

            if (urlObject.protocol !== 'sftp:') {
                throw new Error('Not an SFTP URL');
            }

            const connection: ParsedSftpConnection = {
                host: urlObject.hostname,
                port: urlObject.port ? Number.parseInt(urlObject.port) : this.defaultPort,
                username: urlObject.username || process.env.USER || 'anonymous',
                password: urlObject.password || null,
                remotePath: decodeURIComponent(urlObject.pathname),
                filename: path.basename(urlObject.pathname),
            };

            if (!connection.host) {
                throw DownloadError.validationError('url', url, 'Invalid SFTP URL: missing hostname');
            }

            if (!connection.remotePath || connection.remotePath === '/') {
                throw DownloadError.validationError('url', url, 'Invalid SFTP URL: missing file path');
            }

            return connection;
        } catch (error: any) {
            if (error instanceof DownloadError) {
                throw error;
            }
            throw DownloadError.validationError('url', url, `Failed to parse SFTP URL: ${error.message}`);
        }
    }

    /**
     * Get SSH connection key for caching
     */
    getConnectionKey(config: ParsedSftpConnection): string {
        return `${config.username}@${config.host}:${config.port}`;
    }

    /**
     * Create SSH connection configuration
     */
    async createConnectionConfig(config: ParsedSftpConnection, options: DownloadOptions = {}): Promise<SshConnectionConfig> {
        const {configManager} = options;
        const sshConfig = (configManager ? configManager.get('ssh', {}) : {}) as Record<string, unknown>;

        const connectionConfig: SshConnectionConfig = {
            host: config.host,
            port: config.port,
            username: config.username,
            readyTimeout: options.timeout || (sshConfig['timeout'] as number | undefined) || 30000,
            algorithms: (sshConfig['algorithms'] as Record<string, string[]> | undefined) || {
                kex: ['ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521', 'diffie-hellman-group14-sha256'],
                serverHostKey: ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa', 'ecdsa-sha2-nistp256'],
                cipher: ['aes128-gcm', 'aes256-gcm', 'aes128-ctr', 'aes256-ctr'],
                hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1'],
            },
        };

        // Authentication methods in order of preference
        if (options.privateKey) {
            connectionConfig.privateKey = options.privateKey;
            connectionConfig.passphrase = options.passphrase;
        } else if (options.keyPath) {
            try {
                connectionConfig.privateKey = await fs.promises.readFile(options.keyPath);
                connectionConfig.passphrase = options.passphrase;
            } catch (error: any) {
                throw new Error(`Failed to read SSH key: ${error.message}`);
            }
        } else if (config.password) {
            connectionConfig.password = config.password;
        } else if (options.password) {
            connectionConfig.password = options.password;
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
                    connectionConfig.privateKey = await fs.promises.readFile(keyPath);
                    break;
                } catch {
                    // Try next key
                    continue;
                }
            }

            if (!connectionConfig.privateKey) {
                throw new Error('No authentication method available. Provide password, private key, or ensure SSH keys are in ~/.ssh/');
            }
        }

        return connectionConfig;
    }

    /**
     * Get or create SFTP connection
     */
    async getConnection(config: ParsedSftpConnection, options: DownloadOptions = {}): Promise<InstanceType<typeof SftpClient>> {
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
        } catch (error: any) {
            throw new Error(`SFTP connection failed: ${error.message}`);
        }
    }

    /**
     * Get remote file information
     */
    async getFileInfo(sftp: InstanceType<typeof SftpClient>, remotePath: string): Promise<FileInfo> {
        // Some SFTP servers return Stats with function or boolean isFile/isDirectory
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type SftpStats = SftpClient.FileStats & { isFile?: any; isDirectory?: any };
        try {
            const stats = await sftp.stat(remotePath) as SftpStats;

            // Handle different SFTP server stat object formats
            let isFile: boolean;
            let isDirectory: boolean;

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
                // @types uses modifyTime; some servers expose mtime — use whichever is present
                mtime: stats.modifyTime,
                isFile,
                isDirectory,
            };
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                throw new Error(`Remote file not found: ${remotePath}`);
            }

            throw new Error(`Failed to get file info: ${error.message}`);
        }
    }

    /**
     * Check if SFTP server supports resume (always true for SFTP)
     */
    async checkResumeSupport(sftp: InstanceType<typeof SftpClient>, remotePath: string): Promise<ResumeSupportResult> {
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
    createSftpProgressTracker(progressBar: import('cli-progress').SingleBar | null, totalSize: number, startByte: number = 0): Transform {
        let downloaded = startByte;
        let lastUpdate = Date.now();
        let chunkCount = 0;

        return new Transform({
            transform(chunk: any, encoding: any, callback: any) {
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
    async downloadFile(url: string, destination: string, index: number, total: number, enableResume: boolean = true, options: DownloadOptions = {}): Promise<DownloadResult> {
        const startTime = process.hrtime();
        const {outputToStdout = false, stdoutMode = false, quietMode = false} = options;

        try {
            const config = this.parseSftpUrl(url);
            const sftp = await this.getConnection(config, options);

            // Set up local file path (not used for stdout mode)
            let localPath: string | null = null;
            if (!outputToStdout) {
                localPath = destination ? path.join(destination, config.filename) : path.join(process.cwd(), config.filename);
            }

            // Get remote file info
            const serverInfo = await this.checkResumeSupport(sftp, config.remotePath);

            if (!serverInfo.isFile) {
                throw new Error(`Remote path is not a file: ${config.remotePath}`);
            }

            const {totalSize} = serverInfo;
            let startByte = 0;
            let isResume = false;

            // Check for resume capability (not applicable for stdout mode)
            if (!outputToStdout && enableResume) {
                const resumeInfo = await resumeManager.checkPartialDownload(url, localPath, totalSize, {'last-modified': serverInfo.lastModified} as ResumeCheckHeaders);

                if (resumeInfo.canResume) {
                    startByte = resumeInfo.resumeFrom;
                    isResume = true;
                    if (!quietMode && !stdoutMode) {
                        ui.displayDownloadStart(config.filename, totalSize, index, total, true, startByte);
                    }
                } else if (resumeInfo.isComplete) {
                    if (!quietMode && !stdoutMode) {
                        ui.displayInfo(`File already complete: ${config.filename}`);
                    }
                    return {
                        path: localPath!,
                        size: totalSize,
                        duration: 0,
                        speed: 0,
                        resumed: false,
                        alreadyComplete: true,
                    };
                } else {
                    // Handle duplicate files
                    try {
                        await fs.promises.access(localPath!);
                        const timestamp = new Date().toISOString();
                        localPath = `${localPath}(${timestamp})`;
                        if (!quietMode && !stdoutMode) {
                            ui.displayWarning(`Cannot resume SFTP download, renamed to: ${path.basename(localPath)}`);
                        }
                    } catch {
                        // File doesn't exist, proceed normally
                    }
                }
            }

            if (!isResume && !quietMode && !stdoutMode) {
                ui.displayDownloadStart(config.filename, totalSize, index, total);
            }

            // Create progress bar for large files (not in stdout mode)
            let progressBar: import('cli-progress').SingleBar | null = null;
            if (!quietMode && !stdoutMode && totalSize > 1024) {
                progressBar = ui.createProgressBar(config.filename, totalSize);
                if (isResume) {
                    progressBar.update(startByte, {speed: 'Resuming...'});
                }
            }

            // Create write stream (stdout for stdout mode, file for normal mode)
            let writeStream: NodeJS.WritableStream;
            if (outputToStdout) {
                writeStream = process.stdout;
            } else {
                writeStream = fs.createWriteStream(localPath!, {
                    flags: isResume ? 'a' : 'w',
                    start: isResume ? startByte : 0,
                });
            }

            // Create progress tracker (skip for stdout mode)
            const progressTracker = stdoutMode ?
                new Transform({
                    transform(chunk: any, encoding: any, callback: any) {
                        callback(null, chunk);
                    }
                }) :
                this.createSftpProgressTracker(progressBar, totalSize, startByte);

            // Download with SFTP
            const readStream = await sftp.createReadStream(config.remotePath, {
                start: startByte,
                end: totalSize - 1,
                flags: 'r',
                autoClose: true,
            });

            // Pipe with progress tracking
            await new Promise<void>((resolve, reject) => {
                let hasErrored = false;

                readStream.on('error', (error: Error) => {
                    if (!hasErrored) {
                        hasErrored = true;
                        reject(new Error(`SFTP read error: ${error.message}`));
                    }
                });

                writeStream.on('error', (error: Error) => {
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

            // Display completion (not in stdout mode)
            if (!quietMode && !stdoutMode) {
                ui.displayDownloadComplete(config.filename, totalSize, durationSeconds, speed);
            }

            // Save metadata for resume capability (not applicable for stdout mode)
            if (!outputToStdout && enableResume && !isResume) {
                await resumeManager.saveMetadata(url, localPath, totalSize, {
                    'last-modified': serverInfo.lastModified,
                });
            }

            // Clean up metadata on successful completion (not applicable for stdout mode)
            if (!outputToStdout && enableResume && isResume) {
                await resumeManager.cleanupMetadata(url, path.dirname(localPath!));
            }

            return {
                path: outputToStdout ? 'stdout' : localPath!,
                size: totalSize,
                duration: durationMs,
                speed,
                resumed: isResume,
                resumeFrom: startByte,
            };
        } catch (error: any) {
            // Convert to appropriate DownloadError if not already
            let downloadError = error;

            if (!(error instanceof DownloadError)) {
                downloadError = DownloadError.sftpError('download', error.message, {
                    url,
                    destination,
                    originalError: error,
                });
            }

            ui.displayError(downloadError.userMessage, url);
            throw downloadError;
        }
    }

    /**
     * Test SFTP connection
     */
    async testConnection(url: string, options: DownloadOptions = {}): Promise<boolean> {
        try {
            const config = this.parseSftpUrl(url);
            const sftp = await this.getConnection(config, options);

            // Test by listing current directory
            await sftp.cwd();
            return true;
        } catch (error: any) {
            throw new Error(`SFTP connection test failed: ${error.message}`);
        }
    }

    /**
     * List directory contents (for future directory download support)
     */
    async listDirectory(url: string, options: DownloadOptions = {}): Promise<DirectoryItem[]> {
        try {
            const config = this.parseSftpUrl(url);
            const sftp = await this.getConnection(config, options);

            const list = await sftp.list(config.remotePath);
            return list.map((item) => ({
                name: item.name,
                size: item.size,
                type: item.type,
                modifyTime: item.modifyTime,
                isFile: item.type === '-',
                isDirectory: item.type === 'd',
            }));
        } catch (error: any) {
            throw new Error(`Failed to list directory: ${error.message}`);
        }
    }

    /**
     * Close all SFTP connections
     */
    async closeAllConnections(): Promise<void> {
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
    async closeConnection(config: ParsedSftpConnection): Promise<void> {
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
process.on('SIGINT', async () => {
    await sftpManager.closeAllConnections();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await sftpManager.closeAllConnections();
    process.exit(0);
});

export = sftpManager;
