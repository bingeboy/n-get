const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const ui = require('./ui');

/**
 * Resume Manager for handling interrupted downloads
 * Supports HTTP range requests and partial file validation
 */

class ResumeManager {
    constructor() {
        this.metadataDir = '.nget-resume';
        this.metadataExt = '.nget-meta';
    }

    /**
     * Create metadata directory if it doesn't exist
     */
    async ensureMetadataDir(destination) {
        const metaPath = path.join(destination || process.cwd(), this.metadataDir);
        try {
            await fs.mkdir(metaPath, { recursive: true });
            return metaPath;
        } catch (error) {
            throw new Error(`Failed to create metadata directory: ${error.message}`);
        }
    }

    /**
     * Generate metadata file path for a URL and destination
     */
    getMetadataPath(url, destination) {
        const urlHash = crypto.createHash('md5').update(url).digest('hex');
        const metaDir = path.join(destination || process.cwd(), this.metadataDir);
        return path.join(metaDir, `${urlHash}${this.metadataExt}`);
    }

    /**
     * Save download metadata for resume capability
     */
    async saveMetadata(url, filePath, totalSize, headers = {}) {
        try {
            const destination = path.dirname(filePath);
            await this.ensureMetadataDir(destination);
            
            const metadata = {
                url: url,
                filePath: filePath,
                totalSize: totalSize,
                createdAt: new Date().toISOString(),
                lastModified: headers['last-modified'] || null,
                etag: headers['etag'] || null,
                contentLength: headers['content-length'] || totalSize,
                userAgent: 'n-get-resume/1.0'
            };

            const metadataPath = this.getMetadataPath(url, destination);
            await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
            
            return metadataPath;
        } catch (error) {
            ui.displayWarning(`Failed to save resume metadata: ${error.message}`);
            return null;
        }
    }

    /**
     * Load existing download metadata
     */
    async loadMetadata(url, destination) {
        try {
            const metadataPath = this.getMetadataPath(url, destination);
            const metadataContent = await fs.readFile(metadataPath, 'utf8');
            return JSON.parse(metadataContent);
        } catch (error) {
            return null; // No existing metadata
        }
    }

    /**
     * Check if a partial download exists and is valid
     */
    async checkPartialDownload(url, filePath, expectedSize, serverHeaders = {}) {
        try {
            // Check if the file exists
            const stats = await fs.stat(filePath);
            const currentSize = stats.size;

            // Load metadata
            const metadata = await this.loadMetadata(url, path.dirname(filePath));
            
            if (!metadata) {
                return { canResume: false, reason: 'No resume metadata found' };
            }

            // Validate file path matches metadata
            if (metadata.filePath !== filePath) {
                return { canResume: false, reason: 'File path mismatch' };
            }

            // Check if file is already complete
            if (expectedSize && currentSize >= expectedSize) {
                return { canResume: false, reason: 'File already complete', isComplete: true };
            }

            // Validate server supports resume (check for ETag or Last-Modified)
            const serverEtag = serverHeaders['etag'];
            const serverLastModified = serverHeaders['last-modified'];
            
            if (metadata.etag && serverEtag && metadata.etag !== serverEtag) {
                return { canResume: false, reason: 'File changed on server (ETag mismatch)' };
            }
            
            if (metadata.lastModified && serverLastModified && 
                metadata.lastModified !== serverLastModified) {
                return { canResume: false, reason: 'File changed on server (Last-Modified mismatch)' };
            }

            // Check file size is reasonable
            if (expectedSize && currentSize > expectedSize) {
                return { canResume: false, reason: 'Partial file larger than expected' };
            }

            return {
                canResume: true,
                currentSize: currentSize,
                totalSize: expectedSize || metadata.totalSize,
                resumeFrom: currentSize,
                metadata: metadata
            };

        } catch (error) {
            if (error.code === 'ENOENT') {
                return { canResume: false, reason: 'Partial file not found' };
            }
            return { canResume: false, reason: `File check failed: ${error.message}` };
        }
    }

    /**
     * Test if server supports range requests
     */
    async testRangeSupport(url) {
        try {
            const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
            
            const response = await fetch(url, {
                method: 'HEAD',
                headers: {
                    'User-Agent': 'n-get-resume/1.0'
                }
            });

            const acceptRanges = response.headers.get('accept-ranges');
            const contentLength = response.headers.get('content-length');
            
            return {
                supportsRanges: acceptRanges === 'bytes',
                contentLength: contentLength ? parseInt(contentLength) : null,
                headers: {
                    'etag': response.headers.get('etag'),
                    'last-modified': response.headers.get('last-modified'),
                    'content-length': contentLength
                }
            };
        } catch (error) {
            throw new Error(`Failed to test range support: ${error.message}`);
        }
    }

    /**
     * Create HTTP range request headers
     */
    createRangeHeaders(startByte, endByte = null) {
        const rangeValue = endByte ? `bytes=${startByte}-${endByte}` : `bytes=${startByte}-`;
        
        return {
            'Range': rangeValue,
            'User-Agent': 'n-get-resume/1.0',
            'Connection': 'keep-alive'
        };
    }

    /**
     * Validate range response
     */
    validateRangeResponse(response, expectedStart) {
        const statusCode = response.status;
        const contentRange = response.headers.get('content-range');
        
        if (statusCode !== 206) {
            return { valid: false, reason: `Server returned ${statusCode} instead of 206` };
        }

        if (!contentRange) {
            return { valid: false, reason: 'No Content-Range header in response' };
        }

        // Parse Content-Range: bytes start-end/total
        const rangeMatch = contentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/);
        if (!rangeMatch) {
            return { valid: false, reason: 'Invalid Content-Range format' };
        }

        const [, start, end, total] = rangeMatch;
        const actualStart = parseInt(start);
        
        if (actualStart !== expectedStart) {
            return { 
                valid: false, 
                reason: `Range mismatch: expected ${expectedStart}, got ${actualStart}` 
            };
        }

        return {
            valid: true,
            start: actualStart,
            end: parseInt(end),
            total: total === '*' ? null : parseInt(total)
        };
    }

    /**
     * Clean up metadata after successful download
     */
    async cleanupMetadata(url, destination) {
        try {
            const metadataPath = this.getMetadataPath(url, destination);
            await fs.unlink(metadataPath);
        } catch (error) {
            // Ignore cleanup errors
        }
    }

    /**
     * Clean up old metadata files (older than 7 days)
     */
    async cleanupOldMetadata(destination) {
        try {
            const metaDir = path.join(destination || process.cwd(), this.metadataDir);
            const files = await fs.readdir(metaDir);
            const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days ago

            for (const file of files) {
                if (file.endsWith(this.metadataExt)) {
                    const filePath = path.join(metaDir, file);
                    const stats = await fs.stat(filePath);
                    
                    if (stats.mtime.getTime() < cutoffTime) {
                        await fs.unlink(filePath);
                    }
                }
            }
        } catch (error) {
            // Ignore cleanup errors
        }
    }

    /**
     * Get all resumable downloads in a directory
     */
    async getResumableDownloads(destination) {
        try {
            const metaDir = path.join(destination || process.cwd(), this.metadataDir);
            const files = await fs.readdir(metaDir);
            const resumable = [];

            for (const file of files) {
                if (file.endsWith(this.metadataExt)) {
                    try {
                        const filePath = path.join(metaDir, file);
                        const content = await fs.readFile(filePath, 'utf8');
                        const metadata = JSON.parse(content);
                        
                        // Check if partial file still exists
                        try {
                            const stats = await fs.stat(metadata.filePath);
                            resumable.push({
                                ...metadata,
                                currentSize: stats.size,
                                metadataPath: filePath
                            });
                        } catch (err) {
                            // Partial file doesn't exist, remove metadata
                            await fs.unlink(filePath);
                        }
                    } catch (err) {
                        // Invalid metadata file, ignore
                    }
                }
            }

            return resumable;
        } catch (error) {
            return [];
        }
    }
}

module.exports = new ResumeManager();