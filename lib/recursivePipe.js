const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');
const colors = require('colors');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const { Transform } = require('stream');

const streamPipeline = promisify(pipeline);

// lib modules
const chdir = require('./chdir');
const ui = require('./ui');
const resumeManager = require('./resumeManager');
const sftpManager = require('./sftpManager');

// Keep track of the files to download
let fileCounter = 1;

// Get destination for streams
function getDestination(destination, quiet = false) {
    if (!destination || destination === null || destination === './' || destination === ' ') {
        return process.cwd();
    } else {
        chdir(destination, quiet);
        return process.cwd();
    }
}

// Generate unique filename with incremental postfix
function getUniqueFilename(originalPath) {
    let counter = 1;
    let testPath = originalPath;
    
    // Check if original file exists
    try {
        fs.accessSync(testPath, fs.constants.F_OK);
    } catch (err) {
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
        } catch (err) {
            // File doesn't exist, use this name
            return testPath;
        }
    }
}

// Handles file size display
function bytesToSize(bytes) {
    const k = 1000;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(k)), 10);
    return (bytes / Math.pow(k, i)).toPrecision(3) + ' ' + sizes[i];
}

// Create a progress tracking transform stream with resume support
function createProgressTracker(progressBar, fileSize, startByte = 0) {
    let downloaded = startByte; // Start from resume position
    let chunkCount = 0;
    let lastUpdate = Date.now();
    let speed = 0;
    
    return new Transform({
        transform(chunk, encoding, callback) {
            downloaded += chunk.length;
            chunkCount++;
            const now = Date.now();
            
            // Update speed calculation every 500ms or every 10 chunks
            if (now - lastUpdate > 500 || chunkCount % 10 === 0) {
                const timeDiff = (now - lastUpdate) / 1000;
                speed = timeDiff > 0 ? chunk.length / timeDiff : 0;
                lastUpdate = now;
                
                if (progressBar) {
                    progressBar.update(downloaded, {
                        speed: ui.formatSpeed(speed)
                    });
                }
            }
            
            callback(null, chunk);
        }
    });
}

// Determine protocol and delegate to appropriate downloader
function getProtocol(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.protocol.replace(':', '');
    } catch (error) {
        throw new Error(`Invalid URL: ${url}`);
    }
}

// Download a single file with enhanced progress tracking and resume support
async function downloadFile(url, destination, index, total, enableResume = true, options = {}) {
    const protocol = getProtocol(url);
    
    // Delegate to appropriate protocol handler
    if (protocol === 'sftp') {
        return await sftpManager.downloadFile(url, destination, index, total, enableResume, options);
    } else if (protocol === 'http' || protocol === 'https') {
        return await downloadHttpFile(url, destination, index, total, enableResume, options);
    } else {
        throw new Error(`Unsupported protocol: ${protocol}. Supported protocols: http, https, sftp`);
    }
}

// Download HTTP/HTTPS file with enhanced progress tracking and resume support
async function downloadHttpFile(url, destination, index, total, enableResume = true, options = {}) {
    const { outputToStdout = false, quietMode = false } = options;
    const startTime = process.hrtime();
    
    try {
        // Get filename from URL
        const urlPath = new URL(url).pathname;
        let filename = path.basename(urlPath) || 'download';
        
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
            resumeInfo = await resumeManager.checkPartialDownload(
                url, writePath, fileSizeBytes, serverInfo.headers
            );
            
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
                    alreadyComplete: true
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

        // Create appropriate request
        let response;
        let writeStream;
        let startByte = 0;

        if (isResume && resumeInfo && !outputToStdout) {
            // Resume download (not available for stdout)
            startByte = resumeInfo.resumeFrom;
            const rangeHeaders = resumeManager.createRangeHeaders(startByte);
            
            response = await fetch(url, {
                headers: rangeHeaders
            });

            // Validate range response
            const validation = resumeManager.validateRangeResponse(response, startByte);
            if (!validation.valid) {
                throw new Error(`Resume failed: ${validation.reason}`);
            }

            // Append to existing file
            writeStream = fs.createWriteStream(writePath, { flags: 'a' });
        } else {
            // New download
            response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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
                progressBar.update(startByte, { speed: 'Resuming...' });
            }
        }

        // Create progress tracker
        const progressTracker = createProgressTracker(progressBar, totalSize, startByte);
        
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
            speed: speed,
            resumed: isResume,
            resumeFrom: startByte
        };
        
    } catch (error) {
        if (!quietMode) {
            ui.displayError(`Download failed: ${error.message}`, url);
        }
        throw error;
    }
}

// Process array of URLs and download them with resume support
async function recursivePipe(urls, destination, options = {}) {
    if (!Array.isArray(urls) || urls.length === 0) {
        throw new Error('No URLs provided');
    }

    // Handle both old and new option formats for backwards compatibility
    let enableResume, sshOptions, outputToStdout, quietMode;
    
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
        ui.displayInfo(`Starting download of ${urls.length} file(s)${resumeText}...`);
    }

    const results = [];
    const stats = {
        totalFiles: urls.length,
        successCount: 0,
        errorCount: 0,
        resumedCount: 0,
        totalBytes: 0,
        totalTime: 0,
        speeds: []
    };
    
    const overallStartTime = Date.now();
    
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        try {
            const downloadResult = await downloadFile(url, destination, i + 1, urls.length, enableResume, {
                sshOptions,
                outputToStdout,
                quietMode
            });
            
            if (downloadResult.alreadyComplete) {
                // File was already complete
                results.push({ 
                    url, 
                    filePath: downloadResult.path, 
                    size: downloadResult.size,
                    duration: 0,
                    speed: 0,
                    success: true,
                    alreadyComplete: true
                });
                stats.successCount++;
            } else {
                results.push({ 
                    url, 
                    filePath: downloadResult.path, 
                    size: downloadResult.size,
                    duration: downloadResult.duration,
                    speed: downloadResult.speed,
                    resumed: downloadResult.resumed,
                    resumeFrom: downloadResult.resumeFrom,
                    success: true 
                });
                
                // Update statistics
                stats.successCount++;
                if (downloadResult.resumed) {
                    stats.resumedCount++;
                }
                stats.totalBytes += downloadResult.size;
                stats.totalTime += downloadResult.duration;
                if (downloadResult.speed > 0) {
                    stats.speeds.push(downloadResult.speed);
                }
            }
            
        } catch (error) {
            if (!quietMode) {
                ui.displayError(`Failed to download: ${error.message}`, url);
            }
            results.push({ url, error: error.message, success: false });
            stats.errorCount++;
        }
        
        // Small delay between downloads to be polite
        if (i < urls.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

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
            filePaths: filePaths
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

module.exports = recursivePipe;
module.exports.downloadFile = downloadFile;