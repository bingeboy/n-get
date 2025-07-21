/**
 * @fileoverview Core download pipeline with HTTP/HTTPS and SFTP support
 * Handles concurrent downloads, resume functionality, progress tracking, and file streaming
 * Supports both individual and batch downloads with advanced error handling
 * @module downloadPipeline
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('node:fs');
const path = require('node:path');
const {pipeline} = require('node:stream');
const {promisify} = require('node:util');
const {Transform} = require('node:stream');
const http = require('node:http');
const https = require('node:https');
const IPv6Utils = require('./utils/ipv6Utils');
// Colors is imported to extend String.prototype with color methods
require('colors');

const streamPipeline = promisify(pipeline);

// HTTP agent configuration - will be created with ConfigManager values
let httpAgent = null;
let httpsAgent = null;

/**
 * Initialize HTTP agents with configuration values and IPv6 support
 * @param {ConfigManager} configManager - Configuration manager instance
 */
function initializeHttpAgents(configManager) {
    let keepAliveConfig = {};
    let maxSockets = 20;
    let ipv6Config = {};
    
    if (configManager) {
        keepAliveConfig = configManager.get('http.keepAlive', {});
        maxSockets = configManager.get('http.maxConnections', 20);
        ipv6Config = configManager.get('http.ipv6', {});
    }
    
    const baseAgentConfig = {
        keepAlive: keepAliveConfig.enabled !== false,
        keepAliveMsecs: keepAliveConfig.timeout || 30000,
        maxSockets: keepAliveConfig.maxSockets || Math.min(maxSockets, 10),
        maxFreeSockets: keepAliveConfig.maxFreeSockets || 5,
    };

    // IPv6 configuration options
    const ipv6Enabled = ipv6Config.enabled !== false; // Default to true
    const preferIPv6 = ipv6Config.preferIPv6 || false;
    const dualStack = ipv6Config.dualStack !== false; // Default to true
    
    // Set family preference based on configuration
    let family = 0; // Default: dual-stack (0 = both IPv4 and IPv6)
    if (!dualStack) {
        if (preferIPv6 && ipv6Enabled) {
            family = 6; // IPv6 only
        } else {
            family = 4; // IPv4 only
        }
    }
    
    const agentConfig = {
        ...baseAgentConfig,
        family, // 0=dual-stack, 4=IPv4 only, 6=IPv6 only
    };

    httpAgent = new http.Agent(agentConfig);
    httpsAgent = new https.Agent(agentConfig);
}

// Lib modules
const chdir = require('./chdir');
const ui = require('./ui');
const resumeManager = require('./resumeManager');
const sftpManager = require('./sftpManager');
const ConcurrencyLimiter = require('./concurrencyLimiter');

// Enterprise error handling and services
const DownloadError = require('./errors/DownloadError');
const Logger = require('./services/Logger');
const SecurityService = require('./services/SecurityService');
const HistoryManager = require('./services/HistoryManager');

// Enterprise services - will be initialized per request
let logger = null;
let securityService = null;
let historyManager = null;

/**
 * Initialize enterprise services with options
 * @param {Object} options - Service options
 * @param {boolean} options.quietMode - Whether to suppress console output
 * @param {ConfigManager} options.configManager - Configuration manager instance
 */
function initializeServices(options = {}) {
    const { quietMode = false, configManager, logFormat = 'text' } = options;
    
    // Initialize HTTP agents (always initialize, even without configManager)
    if (!httpAgent) {
        initializeHttpAgents(configManager);
    }
    
    const loggingConfig = configManager ? configManager.get('logging', {}) : {};
    
    // Use provided log format, falling back to config or default
    const finalLogFormat = logFormat || loggingConfig.format || 'text';
    
    logger = new Logger({
        level: loggingConfig.level || process.env.LOG_LEVEL || 'info',
        format: finalLogFormat,
        outputs: quietMode ? [] : (loggingConfig.outputs || ['console']),
        enableColors: quietMode ? false : (loggingConfig.enableColors !== false)
    });

    const securityConfig = configManager ? configManager.get('security', {}) : {};
    
    securityService = new SecurityService({
        config: {
            security: {
                allowedProtocols: securityConfig.allowedProtocols || ['https', 'http', 'sftp'],
                blockPrivateNetworks: securityConfig.blockPrivateNetworks || false,
                blockLocalhost: securityConfig.blockLocalhost || false
            }
        },
        logger
    });

    // Initialize history manager
    historyManager = new HistoryManager();
}

/**
 * Gets the appropriate HTTP agent based on URL protocol with IPv6 support
 * @function getHttpAgent
 * @param {string} url - The URL to determine agent for
 * @param {Object} [options={}] - Additional options for agent selection
 * @param {boolean} [options.forceIPv6=false] - Force IPv6-only connection
 * @param {boolean} [options.forceIPv4=false] - Force IPv4-only connection
 * @returns {Object} The appropriate HTTP agent
 */
function getHttpAgent(url, options = {}) {
    if (!httpAgent || !httpsAgent) {
        throw new Error('HTTP agents not initialized. Call initializeHttpAgents() first.');
    }
    
    const baseAgent = url.startsWith('https:') ? httpsAgent : httpAgent;
    
    // If specific IP version is requested, create a custom agent
    if (options.forceIPv6 || options.forceIPv4) {
        const family = options.forceIPv6 ? 6 : 4;
        const AgentClass = url.startsWith('https:') ? https.Agent : http.Agent;
        
        // Get the base agent's options and override family
        const baseOptions = baseAgent.options || {};
        const customOptions = {
            ...baseOptions,
            family
        };
        
        return new AgentClass(customOptions);
    }
    
    return baseAgent;
}

/**
 * Determines and validates the destination directory for downloads
 * @function getDestination
 * @param {string} destination - The target destination path
 * @param {boolean} [quiet=false] - Whether to suppress console output during directory change
 * @returns {string} The absolute path to the destination directory
 */
function getDestination(destination, quiet = false) {
    if (!destination || destination === null || destination === './' || destination === ' ') {
        return process.cwd();
    }

    chdir(destination, quiet);
    return process.cwd();
}

// Generate unique filename with incremental postfix
function getUniqueFilename(originalPath) {
    let counter = 1;
    let testPath = originalPath;

    // Check if original file exists
    try {
        fs.accessSync(testPath, fs.constants.F_OK);
    } catch {
        // File doesn't exist, use original name
        return originalPath;
    }

    // File exists, find the next available name
    const dirname = path.dirname(originalPath);
    const basename = path.basename(originalPath);

    while (true) {
        testPath = path.join(dirname, `${basename}.${counter}`);
        try {
            fs.accessSync(testPath, fs.constants.F_OK);
            counter++;
        } catch {
            // File doesn't exist, use this name
            return testPath;
        }
    }
}

// Note: bytesToSize function moved to ui.js module

// Create a progress tracking transform stream with resume support
function createProgressTracker(progressBar, fileSize, startByte = 0, configManager = null) {
    let downloaded = startByte; // Start from resume position
    let chunkCount = 0;
    let lastUpdate = Date.now();
    let speed = 0;
    
    // Get configuration values
    const chunkUpdateFrequency = configManager ? 
        configManager.get('downloads.chunkUpdateFrequency', 1000) : 1000;
    const chunkSize = configManager ? 
        configManager.get('downloads.chunkSize', 50) : 50;

    return new Transform({
        transform(chunk, encoding, callback) {
            downloaded += chunk.length;
            chunkCount++;
            const now = Date.now();

            // Update speed calculation based on config values
            if (now - lastUpdate > chunkUpdateFrequency || chunkCount % chunkSize === 0) {
                const timeDiff = (now - lastUpdate) / 1000;
                speed = timeDiff > 0 ? chunk.length / timeDiff : 0;
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

// Determine protocol and delegate to appropriate downloader
function getProtocol(url) {
    try {
        const urlObject = new URL(url);
        return urlObject.protocol.replace(':', '');
    } catch {
        throw new Error(`Invalid URL: ${url}`);
    }
}

/**
 * Downloads a single file with protocol detection and resume support
 * Supports HTTP/HTTPS and SFTP protocols with automatic protocol detection
 * @async
 * @function downloadFile
 * @param {string} url - The URL to download from
 * @param {string} destination - The destination directory path
 * @param {number} index - The current file index (for progress display)
 * @param {number} total - The total number of files being downloaded
 * @param {boolean} [enableResume=true] - Whether to enable resume functionality
 * @param {Object} [options={}] - Additional download options (SSH credentials, etc.)
 * @returns {Promise<Object>} Download result with path, size, duration, and resume status
 * @throws {Error} When download fails or URL is invalid
 */
async function downloadFile(url, destination, index, total, enableResume = true, options = {}) {
    const { quietMode = false, configManager, logFormat = 'text' } = options;
    
    // Initialize enterprise services with proper quiet mode setting
    initializeServices({ quietMode, configManager, logFormat });
    
    const correlationId = `dl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    logger.setCorrelationId(correlationId);
    
    try {
        // Security validation
        const validationResult = securityService.validateDownloadRequest({
            url,
            destination,
            clientIp: options.clientIp || '127.0.0.1'
        });

        if (!validationResult.isValid) {
            const primaryError = validationResult.errors[0];
            throw DownloadError.validationError(
                primaryError.field,
                primaryError.field === 'url' ? url : destination,
                primaryError.message,
                { validationErrors: validationResult.errors }
            );
        }

        // Log security warnings if any
        if (validationResult.warnings.length > 0) {
            validationResult.warnings.forEach(warning => {
                logger.warn('Security validation warning', {
                    url,
                    warning: warning.message,
                    code: warning.code
                });
            });
        }

        const protocol = getProtocol(url);
        
        logger.info('Starting download', {
            url,
            destination,
            protocol,
            index,
            total,
            enableResume
        });

        // Delegate to appropriate protocol handler
        if (protocol === 'sftp') {
            return await sftpManager.downloadFile(url, destination, index, total, enableResume, options);
        }

        if (protocol === 'http' || protocol === 'https') {
            return await downloadHttpFile(url, destination, index, total, enableResume, options);
        }

        throw new DownloadError(
            'UNSUPPORTED_PROTOCOL',
            `Protocol '${protocol}' is not supported`,
            { protocol, supportedProtocols: ['http', 'https', 'sftp'] }
        );

    } catch (error) {
        logger.error('Download failed', {
            url,
            destination,
            error: error.message,
            errorCode: error.code
        }, error);

        // Re-throw DownloadErrors as-is, wrap others
        if (error instanceof DownloadError) {
            throw error;
        }

        throw new DownloadError(
            'DOWNLOAD_FAILED',
            `Download failed: ${error.message}`,
            { originalError: error, url, destination }
        );
    }
}

// Download HTTP/HTTPS file with enhanced progress tracking and resume support
async function downloadHttpFile(url, destination, index, total, enableResume = true, options = {}) {
    const {outputToStdout = false, quietMode = false, configManager} = options;
    const startTime = process.hrtime();

    try {
        // Get filename from URL
        const urlPath = new URL(url).pathname;
        const filename = path.basename(urlPath) || 'download';

        // Set up write path (not used for stdout output)
        let writePath = null;
        if (!outputToStdout) {
            if (destination) {
                const destPath = getDestination(destination, quietMode);
                writePath = path.join(destPath, filename);
            } else {
                writePath = path.join(process.cwd(), filename);
            }
        }

        // Test server capabilities first
        const serverInfo = await resumeManager.testRangeSupport(url);
        const fileSizeBytes = serverInfo.contentLength || 0;
        const supportsResume = serverInfo.supportsRanges;

        // Check for existing partial download (not applicable for stdout)
        let resumeInfo = null;
        let isResume = false;

        if (!outputToStdout && enableResume && supportsResume) {
            resumeInfo = await resumeManager.checkPartialDownload(url, writePath, fileSizeBytes, serverInfo.headers);

            if (resumeInfo.canResume) {
                isResume = true;
                if (!quietMode) {
                    ui.displayDownloadStart(filename, fileSizeBytes, index, total, true, resumeInfo.resumeFrom);
                }
            } else if (resumeInfo.isComplete) {
                if (!quietMode) {
                    ui.displayInfo(`File already complete: ${filename}`);
                }

                return {
                    path: writePath,
                    size: fileSizeBytes,
                    duration: 0,
                    speed: 0,
                    resumed: false,
                    alreadyComplete: true,
                };
            } else {
                // Check if file exists but can't be resumed
                const originalPath = writePath;
                writePath = getUniqueFilename(writePath);
                if (!quietMode && writePath !== originalPath) {
                    ui.displayWarning(`Cannot resume download, renamed to: ${path.basename(writePath)}`);
                }
            }
        } else if (!outputToStdout) {
            // Handle duplicate files when resume is disabled (not applicable for stdout)
            const originalPath = writePath;
            writePath = getUniqueFilename(writePath);
            if (!quietMode && writePath !== originalPath) {
                ui.displayWarning(`Duplicate file found, renamed to: ${path.basename(writePath)}`);
            }
        }

        if (!isResume && !quietMode) {
            ui.displayDownloadStart(filename, fileSizeBytes, index, total);
        }

        // Determine agent options based on URL and IPv6 support
        const urlInfo = IPv6Utils.parseURL(url);
        const agentOptions = {};
        
        if (urlInfo.isIPv6) {
            // For IPv6 URLs, prefer IPv6 connections
            agentOptions.forceIPv6 = true;
        }

        // Create appropriate request
        let response;
        let writeStream;
        let startByte = 0;

        if (isResume && resumeInfo && !outputToStdout) {
            // Resume download (not available for stdout)
            startByte = resumeInfo.resumeFrom;
            const rangeHeaders = resumeManager.createRangeHeaders(startByte);

            response = await fetch(url, {
                headers: rangeHeaders,
                agent: getHttpAgent(url, agentOptions),
            });

            // Validate range response
            const validation = resumeManager.validateRangeResponse(response, startByte);
            if (!validation.valid) {
                throw new Error(`Resume failed: ${validation.reason}`);
            }

            // Append to existing file
            writeStream = fs.createWriteStream(writePath, {flags: 'a'});
        } else {
            // New download
            response = await fetch(url, {
                agent: getHttpAgent(url, agentOptions),
            });

            if (!response.ok) {
                throw DownloadError.httpError(response.status, response.statusText, url);
            }

            if (outputToStdout) {
                writeStream = process.stdout;
            } else {
                writeStream = fs.createWriteStream(writePath);

                // Save metadata for resume capability
                if (enableResume && supportsResume && fileSizeBytes > 0) {
                    await resumeManager.saveMetadata(url, writePath, fileSizeBytes, serverInfo.headers);
                }
            }
        }

        // Create progress bar if file size is known and file is large enough (not in quiet mode)
        let progressBar = null;
        const totalSize = fileSizeBytes;
        const remainingSize = totalSize - startByte;

        if (!quietMode && totalSize > 1024) {
            progressBar = ui.createProgressBar(filename, totalSize);
            // Update progress bar to show resume position
            if (isResume) {
                progressBar.update(startByte, {speed: 'Resuming...'});
            }
        }

        // Create progress tracker
        const progressTracker = createProgressTracker(progressBar, totalSize, startByte, configManager);

        // Download with progress tracking
        await streamPipeline(response.body, progressTracker, writeStream);

        // Calculate download metrics
        const diff = process.hrtime(startTime);
        const durationMs = (diff[0] * 1e9 + diff[1]) / 1e6;
        const durationSeconds = durationMs / 1000;
        const downloadedBytes = isResume ? remainingSize : totalSize;
        const speed = downloadedBytes > 0 ? downloadedBytes / durationSeconds : 0;

        // Display completion with metrics (not in quiet mode)
        if (!quietMode) {
            ui.displayDownloadComplete(filename, totalSize, durationSeconds, speed);
        }

        // Clean up resume metadata on successful completion (not applicable for stdout)
        if (!outputToStdout && enableResume && supportsResume && writePath) {
            await resumeManager.cleanupMetadata(url, path.dirname(writePath));
        }

        return {
            path: outputToStdout ? 'stdout' : writePath,
            size: totalSize,
            duration: durationMs,
            speed,
            resumed: isResume,
            resumeFrom: startByte,
        };
    } catch (error) {
        logger.error('HTTP download failed', {
            url,
            destination,
            error: error.message,
            errorCode: error.code
        }, error);

        if (!quietMode) {
            if (error instanceof DownloadError) {
                ui.displayError(error.userMessage, url);
            } else {
                ui.displayError(`Download failed: ${error.message}`, url);
            }
        }

        // Wrap non-DownloadErrors
        if (!(error instanceof DownloadError)) {
            if (error.code === 'ENOTFOUND' || error.code === 'EAI_NODATA') {
                throw DownloadError.networkError(error.message, url);
            } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
                throw DownloadError.networkError(error.message, url);
            } else if (error.code === 'ECONNREFUSED') {
                throw DownloadError.networkError(error.message, url);
            } else if (error.code === 'ENOENT' || error.code === 'EACCES') {
                throw DownloadError.fileSystemError('write', destination || 'unknown', error.message);
            } else {
                throw new DownloadError(
                    'HTTP_DOWNLOAD_FAILED',
                    `HTTP download failed: ${error.message}`,
                    { originalError: error, url, destination }
                );
            }
        }

        throw error;
    }
}

/**
 * Main download pipeline function - handles batch downloads with concurrency control
 * Processes multiple URLs with resume support, progress tracking, and error handling
 * @async
 * @function download
 * @param {string[]} urls - Array of URLs to download
 * @param {string} destination - Destination directory for downloads
 * @param {Object} [options={}] - Download configuration options
 * @param {boolean} [options.enableResume=true] - Enable resume functionality
 * @param {boolean} [options.quietMode=false] - Suppress progress output
 * @param {number} [options.maxConcurrent=3] - Maximum concurrent downloads
 * @param {Object} [options.sshOptions={}] - SSH connection options for SFTP
 * @returns {Promise<Object[]>} Array of download results with status, paths, and metrics
 * @throws {Error} When no URLs provided or critical download failures occur
 */
async function download(urls, destination, options = {}) {
    if (!Array.isArray(urls) || urls.length === 0) {
        throw new Error('No URLs provided');
    }

    // Handle both old and new option formats for backwards compatibility
    let enableResume; let sshOptions; let outputToStdout; let quietMode;

    if (typeof options === 'boolean') {
        // Old format: recursivePipe(urls, destination, enableResume, sshOptions)
        enableResume = options;
        sshOptions = arguments[3] || {};
        outputToStdout = false;
        quietMode = false;
    } else {
        // New format: recursivePipe(urls, destination, options)
        enableResume = options.enableResume !== false;
        sshOptions = options.sshOptions || {};
        outputToStdout = options.outputToStdout || false;
        quietMode = options.quietMode || false;
    }

    // Check for logging format from environment (set by logs format command)
    const logFormat = process.env.NGET_LOG_FORMAT || 'text';

    // Parse concurrency limit - use config value as fallback
    const configManager = options.configManager;
    const defaultConcurrency = configManager ? configManager.get('downloads.maxConcurrent', 3) : 3;
    const maxConcurrent = options.maxConcurrent || defaultConcurrency;

    // Handle stdout output mode constraints
    if (outputToStdout) {
        if (urls.length > 1) {
            throw new Error('Cannot output multiple files to stdout. Please specify only one URL when using -o -');
        }

        // Force quiet mode for stdout output
        quietMode = true;
    }

    // Display banner and start info (unless in quiet mode)
    if (!quietMode) {
        ui.displayBanner();

        const resumeText = enableResume ? ' with resume support' : '';
        const concurrencyText = urls.length > 1 ? ` (max ${maxConcurrent} concurrent)` : '';
        ui.displayInfo(`Starting download of ${urls.length} file(s)${resumeText}${concurrencyText}...`);
    }

    const results = [];
    const stats = {
        totalFiles: urls.length,
        successCount: 0,
        errorCount: 0,
        resumedCount: 0,
        totalBytes: 0,
        totalTime: 0,
        speeds: [],
    };

    const overallStartTime = Date.now();
    
    // Generate correlation ID for this download batch
    const batchCorrelationId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create concurrency limiter for parallel downloads
    const concurrencyLimiter = new ConcurrencyLimiter(maxConcurrent);

    // Create download promises for all URLs
    const downloadPromises = urls.map(async (url, index) => {
        try {
            const downloadResult = await concurrencyLimiter.execute(
                downloadFile,
                url,
                destination,
                index + 1,
                urls.length,
                enableResume,
                {
                    sshOptions,
                    outputToStdout,
                    quietMode,
                    configManager,
                    logFormat,
                },
            );

            if (downloadResult.alreadyComplete) {
                // File was already complete
                const result = {
                    url,
                    filePath: downloadResult.path,
                    size: downloadResult.size,
                    duration: 0,
                    speed: 0,
                    success: true,
                    alreadyComplete: true,
                };

                // Log to history
                await historyManager.logDownload({
                    url,
                    filePath: downloadResult.path,
                    status: 'success',
                    size: downloadResult.size,
                    duration: 0,
                    correlationId: batchCorrelationId,
                    metadata: { alreadyComplete: true }
                });

                return result;
            }

            const result = {
                url,
                filePath: downloadResult.path,
                size: downloadResult.size,
                duration: downloadResult.duration,
                speed: downloadResult.speed,
                resumed: downloadResult.resumed,
                resumeFrom: downloadResult.resumeFrom,
                success: true,
            };

            // Log successful download to history
            await historyManager.logDownload({
                url,
                filePath: downloadResult.path,
                status: 'success',
                size: downloadResult.size,
                duration: downloadResult.duration,
                correlationId: batchCorrelationId,
                metadata: {
                    resumed: downloadResult.resumed,
                    resumeFrom: downloadResult.resumeFrom,
                    speed: downloadResult.speed
                }
            });

            return result;
        } catch (error) {
            if (!quietMode) {
                ui.displayError(`Failed to download: ${error.message}`, url);
            }

            // Log failed download to history
            await historyManager.logDownload({
                url,
                filePath: destination, // We might not have actual file path for failed downloads
                status: 'failed',
                error: error.message,
                correlationId: batchCorrelationId,
                metadata: { index: index + 1, total: urls.length }
            });

            return {url, error: error.message, success: false};
        }
    });

    // Wait for all downloads to complete
    const downloadResults = await Promise.allSettled(downloadPromises);

    // Process results and update statistics
    downloadResults.forEach(promiseResult => {
        if (promiseResult.status === 'fulfilled') {
            const result = promiseResult.value;
            results.push(result);

            if (result.success) {
                stats.successCount++;
                if (result.resumed) {
                    stats.resumedCount++;
                }

                if (!result.alreadyComplete) {
                    stats.totalBytes += result.size;
                    stats.totalTime += result.duration;
                    if (result.speed > 0) {
                        stats.speeds.push(result.speed);
                    }
                }
            } else {
                stats.errorCount++;
            }
        } else {
            // Promise was rejected
            stats.errorCount++;
            results.push({url: 'unknown', error: promiseResult.reason.message, success: false});
        }
    });

    // Calculate final statistics
    const overallTime = Date.now() - overallStartTime;
    stats.averageSpeed = stats.speeds.length > 0
        ? stats.speeds.reduce((a, b) => a + b, 0) / stats.speeds.length
        : 0;

    // Extract file paths from successful downloads
    const filePaths = results
        .filter(result => result.success && result.filePath)
        .map(result => result.filePath);

    // Display comprehensive summary with resume info (not in quiet mode)
    if (!quietMode) {
        ui.displaySummary({
            totalFiles: stats.totalFiles,
            successCount: stats.successCount,
            errorCount: stats.errorCount,
            resumedCount: stats.resumedCount,
            totalBytes: stats.totalBytes,
            totalTime: overallTime,
            averageSpeed: stats.averageSpeed,
            filePaths,
        });
    }

    // Cleanup old metadata files
    if (enableResume && destination) {
        await resumeManager.cleanupOldMetadata(destination);
    }

    // Cleanup UI resources (not needed in quiet mode)
    if (!quietMode) {
        ui.cleanup();
    }

    return results;
}

module.exports = download;
module.exports.downloadFile = downloadFile;
