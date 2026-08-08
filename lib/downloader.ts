/**
 * @fileoverview Core download pipeline with HTTP/HTTPS and SFTP support
 * Handles concurrent downloads, resume functionality, progress tracking, and file streaming
 * Supports both individual and batch downloads with advanced error handling
 * @module downloader
 */


import * as fs   from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { Transform } from 'node:stream';
import * as http  from 'node:http';
import * as https from 'node:https';

const streamPipeline = promisify(pipeline);

import IPv6Utils    = require('./utils/ipv6Utils');
// DownloadError is a class with static methods; esModuleInterop lets us import it directly
import { DownloadError } from './errors/DownloadError';

const chdir             = require('./chdir');
const ui                = require('./ui');
const resumeManager     = require('./resumeManager');
const sftpManager       = require('./sftpManager');
const ConcurrencyLimiter = require('./concurrencyLimiter');
const OutputFormatterService = require('./services/OutputFormatterService');

import HistoryManager   = require('./services/HistoryManager');
import { DownloadSession } from './core/DownloadSession.js';
import type { DownloadOptions, DownloadResult } from '../types/index.js';

// HTTP agent configuration - will be created with ConfigManager values
let httpAgent: http.Agent | null = null;
let httpsAgent: https.Agent | null = null;

/**
 * Initialize HTTP agents with configuration values and IPv6 support
 * @param {ConfigManager} configManager - Configuration manager instance
 */
function initializeHttpAgents(configManager: unknown) {
    let keepAliveConfig: Record<string, unknown> = {};
    let maxSockets = 20;
    let ipv6Config: Record<string, unknown> = {};

    if (configManager) {
        const cm = configManager as { get: (key: string, def: unknown) => unknown };
        keepAliveConfig = cm.get('http.keepAlive', {}) as Record<string, unknown>;
        maxSockets = cm.get('http.maxConnections', 20) as number;
        ipv6Config = cm.get('http.ipv6', {}) as Record<string, unknown>;
    }

    const baseAgentConfig = {
        keepAlive: (keepAliveConfig['enabled'] as boolean) !== false,
        keepAliveMsecs: (keepAliveConfig['timeout'] as number) || 30000,
        maxSockets: (keepAliveConfig['maxSockets'] as number) || Math.min(maxSockets, 10),
        maxFreeSockets: (keepAliveConfig['maxFreeSockets'] as number) || 5,
    };

    // IPv6 configuration options
    const ipv6Enabled = (ipv6Config['enabled'] as boolean) !== false; // Default to true
    const preferIPv6 = (ipv6Config['preferIPv6'] as boolean) || false;
    const dualStack = (ipv6Config['dualStack'] as boolean) !== false; // Default to true

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

/**
 * Gets the appropriate HTTP agent based on URL protocol with IPv6 support
 * @function getHttpAgent
 * @param {string} url - The URL to determine agent for
 * @param {Object} [options={}] - Additional options for agent selection
 * @param {boolean} [options.forceIPv6=false] - Force IPv6-only connection
 * @param {boolean} [options.forceIPv4=false] - Force IPv4-only connection
 * @returns {Object} The appropriate HTTP agent
 */
// NOTE: currently unreachable. downloadHttpFile() builds `agentOptions` and sets
// forceIPv6 for IPv6 URLs, but never passes it here, and nothing else calls this.
// IPv6 connection forcing is therefore not actually wired up — requests fall back
// to Node's default agent and DNS resolution. Kept rather than deleted because it
// documents intended behaviour; wiring it up is a behaviour change, not a lint fix.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getHttpAgent(url: string, options: { forceIPv6?: boolean; forceIPv4?: boolean } = {}) {
    if (!httpAgent || !httpsAgent) {
        throw new Error('HTTP agents not initialized. Call initializeHttpAgents() first.');
    }

    const baseAgent = url.startsWith('https:') ? httpsAgent : httpAgent;

    // If specific IP version is requested, create a custom agent
    if (options.forceIPv6 || options.forceIPv4) {
        const family = options.forceIPv6 ? 6 : 4;
        const AgentClass = url.startsWith('https:') ? https.Agent : http.Agent;

        // Get the base agent's options and override family
        const baseOptions = (baseAgent as unknown as { options?: Record<string, unknown> }).options || {};
        const customOptions = {
            ...baseOptions,
            family,
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
function getDestination(destination: string, quiet = false): string {
    if (!destination || destination === null || destination === './' || destination === ' ') {
        return process.cwd();
    }

    chdir(destination, quiet);
    return process.cwd();
}

// Generate unique filename with incremental postfix
function getUniqueFilename(originalPath: string): string {
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
interface ProgressTracker extends Transform {
    getBytesDownloaded(): number;
}

function createProgressTracker(
    progressBar: unknown,
    fileSize: number,
    startByte  = 0,
    configManager: unknown = null,
    emitter: unknown = null,
    url: string = '',
): ProgressTracker {
    let downloaded = startByte; // Start from resume position
    let chunkCount = 0;
    let lastUpdate = Date.now();
    let speed = 0;

    // Get configuration values
    const cm = configManager as { get: (k: string, d: unknown) => unknown } | null;
    const chunkUpdateFrequency = cm ?
        cm.get('downloads.chunkUpdateFrequency', 1000) as number : 1000;
    const chunkSize = cm ?
        cm.get('downloads.chunkSize', 50) as number : 50;

    const tracker = new Transform({
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
                    (progressBar as { update: (n: number, o: Record<string, unknown>) => void })
                        .update(downloaded, {
                            speed: ui.formatSpeed(speed),
                        });
                }

                if (emitter && url) {
                    (emitter as { progress: (u: string, r: number, t: number, s: number) => void })
                        .progress(url, downloaded, fileSize, speed);
                }
            }

            callback(null, chunk);
        },
    }) as ProgressTracker;

    tracker.getBytesDownloaded = () => downloaded;
    return tracker;
}

// Determine protocol and delegate to appropriate downloader
function getProtocol(url: string): string {
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
async function downloadFile(
    url: string,
    destination: string,
    index: number,
    total: number,
    enableResume = true,
    options: DownloadOptions & { _session?: DownloadSession } = {},
): Promise<Record<string, unknown>> {
    const { quietMode = false, configManager } = options;
    const session: DownloadSession = (options._session as DownloadSession)
        ?? new DownloadSession({ quietMode, configManager, agentId: options.agentId ?? null }).start();
    const { logger, securityService } = session;
    const correlationId = `dl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    logger.setCorrelationId(correlationId);

    session.queueDownload(url);

    // Initialize HTTP agents if not yet initialized
    if (!httpAgent) {
        initializeHttpAgents(configManager);
    }

    try {
        // Security validation
        const validationResult = securityService.validateDownloadRequest({
            url,
            destination,
            clientIp: (options as DownloadOptions & { clientIp?: string }).clientIp || '127.0.0.1',
        });

        if (!validationResult.isValid) {
            const primaryError = validationResult.errors[0];
            throw DownloadError.validationError(
                primaryError.field,
                primaryError.field === 'url' ? url : destination,
                primaryError.message,
                {validationErrors: validationResult.errors},
            );
        }

        // Log security warnings if any
        if (validationResult.warnings.length > 0) {
            validationResult.warnings.forEach((warning: { message: string; code: string }) => {
                logger.warn('Security validation warning', {
                    url,
                    warning: warning.message,
                    code: warning.code,
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
            enableResume,
        });

        // Delegate to appropriate protocol handler
        if (protocol === 'sftp') {
            return await sftpManager.downloadFile(url, destination, index, total, enableResume, options);
        }

        if (protocol === 'http' || protocol === 'https') {
            return await downloadHttpFile(url, destination, index, total, enableResume, options, session);
        }

        throw new DownloadError(
            'UNSUPPORTED_PROTOCOL',
            `Protocol '${protocol}' is not supported`,
            {protocol, supportedProtocols: ['http', 'https', 'sftp']},
        );

    } catch (error) {
        logger.error('Download failed', {
            url,
            destination,
            error: (error as Error).message,
            errorCode: (error as NodeJS.ErrnoException).code,
        }, error);

        // Re-throw DownloadErrors as-is, wrap others
        if (error instanceof DownloadError) {
            throw error;
        }

        throw new DownloadError(
            'DOWNLOAD_FAILED',
            `Download failed: ${(error as Error).message}`,
            {originalError: error, url, destination},
        );
    }
}

// Download HTTP/HTTPS file with enhanced progress tracking and resume support
async function downloadHttpFile(
    url: string,
    destination: string,
    index: number,
    total: number,
    enableResume  = true,
    options: DownloadOptions = {},
    session: DownloadSession,
): Promise<Record<string, unknown>> {
    const { emitter, logger, metadataService } = session;
    const {outputToStdout = false, outputFilename = null, quietMode = false, configManager} = options;
    const startTime = process.hrtime();

    // Declare enhancedMetadata outside try-catch for proper scoping
    let enhancedMetadata = null;

    try {
        // Get filename from URL or use custom output filename
        const urlPath = new URL(url).pathname;
        const urlBasedFilename = path.basename(urlPath) || 'download';
        const filename = outputFilename || urlBasedFilename;

        // Set up write path (not used for stdout output)
        let writePath: string | null = null;
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
        const fileSizeBytes: number = serverInfo.contentLength || 0;
        const supportsResume: boolean = serverInfo.supportsRanges;

        // Check for existing partial download (not applicable for stdout)
        let resumeInfo = null;
        let isResume = false;

        if (!outputToStdout && enableResume && supportsResume) {
            resumeInfo = await resumeManager.checkPartialDownload(url, writePath, fileSizeBytes, serverInfo.headers);

            if (resumeInfo.canResume) {
                isResume = true;
                if (!quietMode) {
                    emitter.downloadStart(url, { filename, bytes_total: fileSizeBytes, index, total, resumed: true, resume_from: resumeInfo.resumeFrom });
                }
            } else if (resumeInfo.isComplete) {
                if (!quietMode) {
                    emitter.info(`File already complete: ${filename}`);
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
                writePath = getUniqueFilename(writePath as string);
                if (!quietMode && writePath !== originalPath) {
                    emitter.warn(`Cannot resume download, renamed to: ${path.basename(writePath)}`);
                }
            }
        } else if (!outputToStdout) {
            // Handle duplicate files when resume is disabled (not applicable for stdout)
            const originalPath = writePath;
            writePath = getUniqueFilename(writePath as string);
            if (!quietMode && writePath !== originalPath) {
                emitter.warn(`Duplicate file found, renamed to: ${path.basename(writePath)}`);
            }
        }

        if (!isResume && !quietMode) {
            emitter.downloadStart(url, { filename, bytes_total: fileSizeBytes, index, total, resumed: false });
        }

        // Determine agent options based on URL and IPv6 support
        const urlInfo = IPv6Utils.parseURL(url);
        const agentOptions: { forceIPv6?: boolean } = {};

        if (urlInfo.isIPv6) {
            // For IPv6 URLs, prefer IPv6 connections
            agentOptions.forceIPv6 = true;
        }

        // Create appropriate request
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let response: any;
        let writeStream: NodeJS.WritableStream;
        let startByte = 0;

        if (isResume && resumeInfo && !outputToStdout) {
            // Resume download (not available for stdout)
            startByte = resumeInfo.resumeFrom;
            const rangeHeaders = resumeManager.createRangeHeaders(startByte);

            response = await fetch(url, {
                headers: rangeHeaders,
            });

            // Validate range response
            const validation = resumeManager.validateRangeResponse(response, startByte);
            if (!validation.valid) {
                throw new Error(`Resume failed: ${validation.reason}`);
            }

            // Append to existing file
            writeStream = fs.createWriteStream(writePath as string, {flags: 'a'});
        } else {
            // New download
            response = await fetch(url, {});

            if (!response.ok) {
                throw DownloadError.httpError(response.status, response.statusText, url);
            }

            if (outputToStdout) {
                writeStream = process.stdout;
            } else {
                writeStream = fs.createWriteStream(writePath as string);

                // Save metadata for resume capability
                if (enableResume && supportsResume && fileSizeBytes > 0) {
                    await resumeManager.saveMetadata(url, writePath, fileSizeBytes, serverInfo.headers);
                }
            }
        }

        // Collect enhanced metadata for agent integration
        if (metadataService) {
            try {
                enhancedMetadata = await metadataService.collectDownloadMetadata({
                    url,
                    filePath: outputToStdout ? 'stdout' : writePath,
                    response,
                    options: {
                        sessionId: options.sessionId,
                        requestId: options.requestId,
                        conversationId: options.conversationId,
                        enableResume,
                        startByte,
                        previousAttempts: (options as DownloadOptions & { previousAttempts?: number }).previousAttempts || 0,
                        requestedBy: options.requestedBy || 'cli',
                        metadata: options.metadata
                    }
                });
            } catch (metadataError) {
                logger.warn('Failed to collect enhanced metadata', {
                    url,
                    error: (metadataError as Error).message
                });
            }
        }

        // Create progress bar if file size is known and file is large enough (not in quiet mode)
        let progressBar = null;
        const totalSize = fileSizeBytes;

        if (!quietMode && totalSize > 1024) {
            progressBar = ui.createProgressBar(filename, totalSize);
            // Update progress bar to show resume position
            if (isResume) {
                progressBar.update(startByte, {speed: 'Resuming...'});
            }
        }

        // Create progress tracker
        const progressTracker = createProgressTracker(progressBar, totalSize, startByte, configManager, emitter, url);

        // Download with progress tracking
        await streamPipeline(response.body, progressTracker, writeStream);

        // Calculate download metrics
        const diff = process.hrtime(startTime);
        const durationMs = (diff[0] * 1e9 + diff[1]) / 1e6;
        const durationSeconds = durationMs / 1000;
        // getBytesDownloaded() is authoritative for chunked responses where Content-Length is absent
        const downloadedBytes = progressTracker.getBytesDownloaded() || (writeStream as fs.WriteStream).bytesWritten || totalSize;
        const speed = downloadedBytes > 0 ? downloadedBytes / durationSeconds : 0;

        // Display completion with metrics (not in quiet mode)
        if (!quietMode) {
            emitter.downloadComplete(url, { filename, size: downloadedBytes, bytes_total: downloadedBytes, duration_ms: durationMs, speed_bps: speed });
        }

        // Clean up resume metadata on successful completion (not applicable for stdout)
        if (!outputToStdout && enableResume && supportsResume && writePath) {
            await resumeManager.cleanupMetadata(url, path.dirname(writePath));
        }

        // Finalize enhanced metadata
        let finalizedMetadata = null;
        if (enhancedMetadata && metadataService) {
            try {
                finalizedMetadata = await metadataService.finalizeMetadata(enhancedMetadata, {
                    success: true,
                    actualSize: downloadedBytes,
                    resumed: isResume,
                    resumeFromByte: startByte
                });
            } catch (metadataError) {
                logger.warn('Failed to finalize enhanced metadata', {
                    url,
                    error: (metadataError as Error).message
                });
            }
        }

        session.completeDownload(url, { path: outputToStdout ? 'stdout' : writePath as string, size: downloadedBytes, duration: durationMs, speed });

        return {
            path: outputToStdout ? 'stdout' : writePath,
            size: downloadedBytes,
            duration: durationMs,
            speed,
            resumed: isResume,
            resumeFrom: startByte,
            // Enhanced metadata for AI agents
            metadata: finalizedMetadata ? finalizedMetadata.summary : null,
            fullMetadata: finalizedMetadata
        };
    } catch (error) {
        logger.error('HTTP download failed', {
            url,
            destination,
            error: (error as Error).message,
            errorCode: (error as NodeJS.ErrnoException).code,
        }, error);

        if (!quietMode) {
            emitter.downloadError(url, error as Error & { code?: string });
        }

        // Finalize enhanced metadata for failed downloads
        if (enhancedMetadata && metadataService) {
            try {
                await metadataService.finalizeMetadata(enhancedMetadata, {
                    success: false,
                    error: (error as Error).message,
                    actualSize: 0
                });
            } catch (metadataError) {
                logger.warn('Failed to finalize error metadata', {
                    url,
                    error: (metadataError as Error).message
                });
            }
        }

        session.failDownload(url, error as Error & { code?: string });

        // Wrap non-DownloadErrors
        if (!(error instanceof DownloadError)) {
            const errCode = (error as NodeJS.ErrnoException).code;
            if (errCode === 'ENOTFOUND' || errCode === 'EAI_NODATA') {
                throw DownloadError.networkError((error as Error).message, url);
            } else if (errCode === 'ETIMEDOUT' || errCode === 'ECONNRESET') {
                throw DownloadError.networkError((error as Error).message, url);
            } else if (errCode === 'ECONNREFUSED') {
                throw DownloadError.networkError((error as Error).message, url);
            } else if (errCode === 'ENOENT' || errCode === 'EACCES') {
                throw DownloadError.fileSystemError('write', destination || 'unknown', (error as Error).message);
            } else {
                throw new DownloadError(
                    'HTTP_DOWNLOAD_FAILED',
                    `HTTP download failed: ${(error as Error).message}`,
                    {originalError: error, url, destination},
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
async function download(urls: string[], destination: string, options: DownloadOptions | boolean = {}): Promise<DownloadResult[]> {
    if (!Array.isArray(urls) || urls.length === 0) {
        throw new Error('No URLs provided');
    }

    // Handle both old and new option formats for backwards compatibility
    let enableResume: boolean; let sshOptions: Record<string, unknown>; let outputToStdout: boolean; let quietMode: boolean;

    if (typeof options === 'boolean') {
        // Old format: recursivePipe(urls, destination, enableResume, sshOptions)
        enableResume = options;
        // `arguments` is deliberate: this branch supports the legacy positional
        // signature download(urls, destination, enableResume, sshOptions), where
        // the 4th argument is not in the declared parameter list. Rest params
        // would change the public signature.
        // eslint-disable-next-line prefer-rest-params
        sshOptions = (arguments as unknown as unknown[])[3] as Record<string, unknown> || {};
        outputToStdout = false;
        quietMode = false;
    } else {
        // New format: recursivePipe(urls, destination, options)
        enableResume = options.enableResume !== false;
        sshOptions = (options.sshOptions || {}) as Record<string, unknown>;
        outputToStdout = options.outputToStdout || false;
        quietMode = options.quietMode || false;
    }

    // Check for logging format from environment (set by logs format command)
    const logFormat = process.env['NGET_LOG_FORMAT'] || 'text';

    // Parse concurrency limit - use config value as fallback
    const configManager = (options as DownloadOptions).configManager;
    const defaultConcurrency = configManager ? configManager.get('downloads.maxConcurrent', 3) : 3;
    const maxConcurrent = (options as DownloadOptions).maxConcurrent || defaultConcurrency;

    // Handle stdout output mode constraints
    if (outputToStdout) {
        if (urls.length > 1) {
            throw new Error('Cannot output multiple files to stdout. Please specify only one URL when using -o -');
        }

        // Force quiet mode for stdout output
        quietMode = true;
    }

    // One session for the whole batch
    const session = new DownloadSession({
        sessionId:     (options as DownloadOptions).sessionId,
        agentId:       (options as DownloadOptions).agentId ?? null,
        humanMode:     (options as DownloadOptions).humanMode ?? false,
        pipeMode:      (options as DownloadOptions).pipeMode  ?? false,
        quietMode,
        configManager: configManager ?? null,
        webhooks:      (options as DownloadOptions).webhooks ?? [],
    }).start();

    const historyManager = new HistoryManager();
    const outputFormatter = new OutputFormatterService({ logger: session.logger, defaultFormat: 'text' });

    if (!quietMode) {
        const resumeText = enableResume ? ' with resume support' : '';
        const concurrencyText = urls.length > 1 ? ` (max ${maxConcurrent} concurrent)` : '';
        session.emitter.info(`Starting download of ${urls.length} file(s)${resumeText}${concurrencyText}...`);
    }

    const results: DownloadResult[] = [];
    const stats: {
        totalFiles: number;
        successCount: number;
        errorCount: number;
        resumedCount: number;
        totalBytes: number;
        totalTime: number;
        speeds: number[];
        averageSpeed: number;
    } = {
        totalFiles: urls.length,
        successCount: 0,
        errorCount: 0,
        resumedCount: 0,
        totalBytes: 0,
        totalTime: 0,
        speeds: [],
        averageSpeed: 0,
    };

    const overallStartTime = Date.now();

    // Generate correlation ID for this download batch
    const batchCorrelationId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create concurrency limiter for parallel downloads
    const concurrencyLimiter = new ConcurrencyLimiter(maxConcurrent);

    // Create download promises for all URLs
    const downloadPromises = urls.map(async(url: string, index: number) => {
        try {
            if ((options as any).session?.isCancelled()) {
                const err = Object.assign(new Error('Download cancelled'), { code: 'CANCELLED' });
                (options as any).session.failDownload(url, err);
                return { url, error: err.message, success: false };
            }
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
                    outputFilename: (options as DownloadOptions).outputFilename,
                    quietMode,
                    configManager,
                    logFormat,
                    _session: session,
                },
            );

            if (downloadResult.alreadyComplete) {
                // File was already complete
                const result: DownloadResult = {
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
                    metadata: {alreadyComplete: true},
                });

                return result;
            }

            const result: DownloadResult = {
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
                    speed: downloadResult.speed,
                },
            });

            return result;
        } catch (error) {
            if (!quietMode) {
                session.emitter.warn(`Failed to download: ${(error as Error).message}`);
            }

            // Log failed download to history
            await historyManager.logDownload({
                url,
                filePath: destination, // We might not have actual file path for failed downloads
                status: 'failed',
                error: (error as Error).message,
                correlationId: batchCorrelationId,
                metadata: {index: index + 1, total: urls.length},
            });

            return {url, error: (error as Error).message, success: false};
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
                    stats.totalBytes += result.size || 0;
                    stats.totalTime += result.duration || 0;
                    if (result.speed && result.speed > 0) {
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
        ? stats.speeds.reduce((a: number, b: number) => a + b, 0) / stats.speeds.length
        : 0;

    // Extract file paths from successful downloads
    const filePaths = results
        .filter(result => result.success && result.filePath)
        .map(result => result.filePath as string);

    // Handle structured output if requested
    const outputFormat = (options as DownloadOptions).outputFormat || 'text';
    const enableMetadata = (options as DownloadOptions).enableMetadata || false;

    if (outputFormat !== 'text' && outputFormatter) {
        try {
            const formattedOutput = outputFormatter.formatDownloadResults(results, {
                format: outputFormat,
                includeMetadata: enableMetadata,
                compact: quietMode
            });

            console.log(formattedOutput);
        } catch (error) {
            session.logger.error('Failed to format structured output', {
                format: outputFormat,
                error: (error as Error).message
            });
        }
    }

    await session.end({
        stats: {
            total:      urls.length,
            success:    stats.successCount,
            errors:     stats.errorCount,
            resumed:    stats.resumedCount,
            bytes:      stats.totalBytes,
            duration:   overallTime,
            avg_speed:  stats.averageSpeed,
            file_paths: filePaths,
        },
    });

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

export = download;
