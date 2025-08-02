/**
 * @fileoverview Enhanced Metadata Service for AI Agent Integration
 * Collects comprehensive file and download metadata for better agent understanding
 * @module MetadataService
 */

const crypto = require('node:crypto');
const fs = require('node:fs').promises;
const path = require('node:path');
const { pipeline } = require('node:stream');
const { promisify } = require('node:util');

const streamPipeline = promisify(pipeline);

// Load package.json to get version dynamically
const packageJson = require('../../package.json');
const NGET_VERSION = packageJson.version;

/**
 * Enhanced Metadata Service for comprehensive download information
 * Extends basic download tracking with rich metadata collection
 */
class MetadataService {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.config = options.config || {};
        this.enableIntegrityChecks = options.enableIntegrityChecks !== false;
        this.enableTimingMetrics = options.enableTimingMetrics !== false;
        this.version = NGET_VERSION;
    }

    /**
     * Collect comprehensive metadata during download
     * @param {Object} downloadContext - Download context information
     * @param {string} downloadContext.url - Source URL
     * @param {string} downloadContext.filePath - Destination file path
     * @param {Object} downloadContext.response - HTTP response object
     * @param {Object} [downloadContext.options={}] - Download options
     * @returns {Promise<Object>} Enhanced metadata object
     */
    async collectDownloadMetadata(downloadContext) {
        const { url, filePath, response, options = {} } = downloadContext;
        const startTime = process.hrtime.bigint();

        try {
            const metadata = {
                // Basic information
                url,
                filePath,
                timestamp: new Date().toISOString(),
                version: this.version,

                // Source information
                source: await this.extractSourceMetadata(url, response),

                // File information
                file: await this.extractFileMetadata(filePath, response),

                // HTTP metadata
                http: this.extractHttpMetadata(response),

                // Download context
                download: {
                    sessionId: options.sessionId || this.generateSessionId(),
                    requestId: options.requestId || this.generateRequestId(),
                    conversationId: options.conversationId || null,
                    userAgent: options.userAgent || `n-get-enterprise/${this.version}`,
                    resume: {
                        enabled: options.enableResume !== false,
                        startByte: options.startByte || 0,
                        previousAttempts: options.previousAttempts || 0
                    }
                },

                // Performance metrics
                performance: {
                    startTime: Number(startTime),
                    networkLatency: null, // Will be calculated
                    dnsResolutionTime: null,
                    tlsHandshakeTime: null,
                    downloadDuration: null, // Will be calculated on completion
                    bytesPerSecond: null
                },

                // Integrity verification
                integrity: {
                    checksums: {}, // Will be calculated during download
                    verified: false,
                    method: this.enableIntegrityChecks ? 'sha256' : null
                },

                // Custom metadata
                custom: options.metadata || {},

                // Agent context
                agent: {
                    toolName: 'n-get',
                    toolVersion: this.version,
                    capabilities: this.getToolCapabilities(),
                    requestedBy: options.requestedBy || 'cli'
                }
            };

            return metadata;
        } catch (error) {
            this.logger.error('Failed to collect download metadata', {
                url,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Extract source-related metadata
     * @param {string} url - Source URL
     * @param {Object} response - HTTP response object
     * @returns {Promise<Object>} Source metadata
     * @private
     */
    async extractSourceMetadata(url, response) {
        const urlObj = new URL(url);
        
        return {
            originalUrl: url,
            finalUrl: response?.url || url, // After redirects
            protocol: urlObj.protocol.slice(0, -1), // Remove trailing ':'
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            pathname: urlObj.pathname,
            search: urlObj.search,
            hash: urlObj.hash,
            isSecure: urlObj.protocol === 'https:',
            redirectChain: response?.redirected ? this.extractRedirectChain(response) : [],
            ipVersion: this.detectIpVersion(urlObj.hostname),
            cdn: this.detectCdn(response),
            server: response?.headers?.get('server') || null
        };
    }

    /**
     * Extract file-related metadata
     * @param {string} filePath - File path
     * @param {Object} response - HTTP response object
     * @returns {Promise<Object>} File metadata
     * @private
     */
    async extractFileMetadata(filePath, response) {
        const fileName = path.basename(filePath);
        const fileExt = path.extname(fileName).toLowerCase();
        
        return {
            name: fileName,
            basename: path.basename(fileName, fileExt),
            extension: fileExt,
            directory: path.dirname(filePath),
            absolutePath: path.resolve(filePath),
            mimeType: this.extractMimeType(response, fileExt),
            encoding: this.extractEncoding(response),
            size: {
                expected: this.extractContentLength(response),
                actual: null, // Will be set after download
                compressed: this.isCompressed(response)
            },
            timestamps: {
                created: new Date().toISOString(),
                lastModified: response?.headers?.get('last-modified') || null,
                expires: response?.headers?.get('expires') || null
            }
        };
    }

    /**
     * Extract HTTP-related metadata
     * @param {Object} response - HTTP response object
     * @returns {Object} HTTP metadata
     * @private
     */
    extractHttpMetadata(response) {
        if (!response) {
            return {
                status: null,
                headers: {},
                timing: {},
                cache: {}
            };
        }

        return {
            status: {
                code: response.status,
                text: response.statusText,
                ok: response.ok,
                redirected: response.redirected
            },
            headers: this.sanitizeHeaders(response.headers),
            cache: {
                cacheControl: response.headers?.get('cache-control') || null,
                etag: response.headers?.get('etag') || null,
                maxAge: this.extractMaxAge(response.headers?.get('cache-control')),
                lastModified: response.headers?.get('last-modified') || null
            },
            compression: {
                contentEncoding: response.headers?.get('content-encoding') || null,
                transferEncoding: response.headers?.get('transfer-encoding') || null
            },
            security: {
                hsts: response.headers?.get('strict-transport-security') || null,
                contentSecurityPolicy: response.headers?.get('content-security-policy') || null,
                xFrameOptions: response.headers?.get('x-frame-options') || null
            }
        };
    }

    /**
     * Generate checksums for file integrity verification
     * @param {string} filePath - Path to the file
     * @param {string[]} algorithms - Hash algorithms to use
     * @returns {Promise<Object>} Checksums object
     */
    async generateChecksums(filePath, algorithms = ['md5', 'sha256']) {
        const checksums = {};

        try {
            const fileBuffer = await fs.readFile(filePath);
            
            for (const algorithm of algorithms) {
                const hash = crypto.createHash(algorithm);
                hash.update(fileBuffer);
                checksums[algorithm] = hash.digest('hex');
            }

            return checksums;
        } catch (error) {
            this.logger.error('Failed to generate checksums', {
                filePath,
                error: error.message
            });
            return checksums;
        }
    }

    /**
     * Finalize metadata after download completion
     * @param {Object} metadata - Initial metadata object
     * @param {Object} downloadResult - Download completion result
     * @returns {Promise<Object>} Finalized metadata
     */
    async finalizeMetadata(metadata, downloadResult) {
        const endTime = process.hrtime.bigint();
        const durationNs = Number(endTime - BigInt(metadata.performance.startTime));
        const durationMs = durationNs / 1000000;
        const durationSeconds = durationMs / 1000;

        // Update file size
        if (downloadResult.actualSize !== undefined) {
            metadata.file.size.actual = downloadResult.actualSize;
        }

        // Update performance metrics
        metadata.performance.downloadDuration = durationMs;
        metadata.performance.endTime = Number(endTime);
        
        if (downloadResult.actualSize > 0 && durationSeconds > 0) {
            metadata.performance.bytesPerSecond = Math.round(downloadResult.actualSize / durationSeconds);
            metadata.performance.megabytesPerSecond = Number((downloadResult.actualSize / 1048576 / durationSeconds).toFixed(2));
        }

        // Generate checksums if enabled
        if (this.enableIntegrityChecks && downloadResult.success && metadata.filePath !== 'stdout') {
            try {
                metadata.integrity.checksums = await this.generateChecksums(metadata.filePath);
                metadata.integrity.verified = true;
                metadata.integrity.verifiedAt = new Date().toISOString();
            } catch (error) {
                this.logger.warn('Failed to generate checksums', {
                    filePath: metadata.filePath,
                    error: error.message
                });
            }
        }

        // Add completion status
        metadata.completion = {
            success: downloadResult.success,
            error: downloadResult.error || null,
            completedAt: new Date().toISOString(),
            resumed: downloadResult.resumed || false,
            resumeFromByte: downloadResult.resumeFromByte || 0
        };

        // Add agent-friendly summary
        metadata.summary = this.generateAgentSummary(metadata);

        return metadata;
    }

    /**
     * Generate agent-friendly summary
     * @param {Object} metadata - Complete metadata object
     * @returns {Object} Agent summary
     * @private
     */
    generateAgentSummary(metadata) {
        const fileSizeMB = metadata.file.size.actual ? 
            Number((metadata.file.size.actual / 1048576).toFixed(2)) : null;
        
        const speedMBps = metadata.performance.megabytesPerSecond || null;
        const durationSec = metadata.performance.downloadDuration ? 
            Number((metadata.performance.downloadDuration / 1000).toFixed(2)) : null;

        return {
            // Essential info for agents
            url: metadata.url,
            filePath: metadata.filePath,
            fileName: metadata.file.name,
            fileSize: {
                bytes: metadata.file.size.actual,
                megabytes: fileSizeMB,
                human: fileSizeMB ? `${fileSizeMB} MB` : null
            },
            duration: {
                seconds: durationSec,
                human: durationSec ? this.formatDuration(durationSec) : null
            },
            speed: {
                bytesPerSecond: metadata.performance.bytesPerSecond,
                megabytesPerSecond: speedMBps,
                human: speedMBps ? `${speedMBps} MB/s` : null
            },
            mimeType: metadata.file.mimeType,
            success: metadata.completion?.success,
            checksums: metadata.integrity.checksums,
            resumeInfo: metadata.completion?.resumed ? {
                resumed: true,
                resumeFromByte: metadata.completion.resumeFromByte
            } : null,
            context: {
                sessionId: metadata.download.sessionId,
                requestId: metadata.download.requestId,
                conversationId: metadata.download.conversationId
            }
        };
    }

    /**
     * Get tool capabilities for agent discovery
     * @returns {Object} Tool capabilities
     */
    getToolCapabilities() {
        return {
            protocols: ['http', 'https', 'sftp'],
            features: [
                'resume_downloads',
                'concurrent_downloads',
                'progress_tracking',
                'integrity_verification',
                'metadata_collection',
                'structured_output'
            ],
            maxConcurrentDownloads: 20,
            maxFileSize: '10GB',
            supportedFormats: ['all'],
            authentication: ['none', 'basic', 'ssh_key', 'ssh_password'],
            checksumAlgorithms: ['md5', 'sha256', 'sha1'],
            outputFormats: ['json', 'yaml', 'csv', 'text']
        };
    }

    // Utility methods
    generateSessionId() {
        return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    generateRequestId() {
        return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    extractMimeType(response, fileExt) {
        // Try to get from Content-Type header first
        const contentType = response?.headers?.get('content-type');
        if (contentType) {
            return contentType.split(';')[0].trim();
        }

        // Fallback to file extension mapping
        const mimeTypes = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.xml': 'application/xml',
            '.pdf': 'application/pdf',
            '.zip': 'application/zip',
            '.tar': 'application/x-tar',
            '.gz': 'application/gzip',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.mp3': 'audio/mpeg',
            '.mp4': 'video/mp4',
            '.txt': 'text/plain'
        };

        return mimeTypes[fileExt] || 'application/octet-stream';
    }

    extractContentLength(response) {
        const contentLength = response?.headers?.get('content-length');
        return contentLength ? parseInt(contentLength, 10) : null;
    }

    extractEncoding(response) {
        const contentType = response?.headers?.get('content-type');
        if (contentType) {
            const match = contentType.match(/charset=([^;]+)/i);
            return match ? match[1].trim() : null;
        }
        return null;
    }

    isCompressed(response) {
        const contentEncoding = response?.headers?.get('content-encoding');
        return contentEncoding && ['gzip', 'deflate', 'br'].includes(contentEncoding);
    }

    detectIpVersion(hostname) {
        if (hostname.includes(':')) {
            return 'ipv6';
        }
        if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
            return 'ipv4';
        }
        return 'domain';
    }

    detectCdn(response) {
        const server = response?.headers?.get('server') || '';
        const via = response?.headers?.get('via') || '';
        const xCache = response?.headers?.get('x-cache') || '';
        
        const cdnPatterns = {
            'cloudflare': /cloudflare/i,
            'amazonaws': /amazonaws/i,
            'fastly': /fastly/i,
            'cloudfront': /cloudfront/i,
            'akamai': /akamai/i,
            'maxcdn': /maxcdn/i
        };

        const combinedHeaders = `${server} ${via} ${xCache}`.toLowerCase();
        
        for (const [cdn, pattern] of Object.entries(cdnPatterns)) {
            if (pattern.test(combinedHeaders)) {
                return cdn;
            }
        }
        
        return null;
    }

    extractMaxAge(cacheControl) {
        if (!cacheControl) return null;
        const match = cacheControl.match(/max-age=(\d+)/i);
        return match ? parseInt(match[1], 10) : null;
    }

    extractRedirectChain(response) {
        // This would need to be tracked during the fetch process
        // For now, return basic info
        return response.redirected ? [{ from: 'unknown', to: response.url }] : [];
    }

    sanitizeHeaders(headers) {
        const sanitized = {};
        if (headers && headers.forEach) {
            headers.forEach((value, key) => {
                // Exclude sensitive headers
                if (!key.toLowerCase().includes('authorization') && 
                    !key.toLowerCase().includes('cookie')) {
                    sanitized[key.toLowerCase()] = value;
                }
            });
        }
        return sanitized;
    }

    formatDuration(seconds) {
        if (seconds < 60) {
            return `${seconds}s`;
        } else if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = Math.floor(seconds % 60);
            return `${minutes}m ${remainingSeconds}s`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${minutes}m`;
        }
    }
}

module.exports = MetadataService;