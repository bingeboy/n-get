/**
 * @fileoverview Output Formatter Service for Structured Output
 * Handles formatting of all n-get output in multiple formats for AI agent consumption
 * @module OutputFormatterService
 */

const yaml = require('js-yaml');
const path = require('node:path');

// Load package.json to get version
const packageJson = require('../../package.json');

/**
 * Output Formatter Service for structured, agent-friendly output
 * Provides consistent formatting across all n-get operations
 */
class OutputFormatterService {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.version = packageJson.version;
        this.defaultFormat = options.defaultFormat || 'text';
    }

    /**
     * Format download results for output
     * @param {Array|Object} results - Download results (single or array)
     * @param {Object} options - Formatting options
     * @param {string} options.format - Output format (json, yaml, csv, text)
     * @param {boolean} options.includeMetadata - Include enhanced metadata
     * @param {boolean} options.compact - Use compact output
     * @returns {string} Formatted output
     */
    formatDownloadResults(results, options = {}) {
        const { format = this.defaultFormat, includeMetadata = false, compact = false } = options;
        
        // Ensure results is always an array for consistent processing
        const resultsArray = Array.isArray(results) ? results : [results];
        
        // Build structured output
        const output = {
            operation: 'download',
            timestamp: new Date().toISOString(),
            version: this.version,
            summary: this.generateDownloadSummary(resultsArray),
            results: resultsArray.map(result => this.normalizeDownloadResult(result, includeMetadata))
        };

        return this.formatOutput(output, format, compact);
    }

    /**
     * Format configuration output
     * @param {Object} configData - Configuration data
     * @param {Object} options - Formatting options
     * @returns {string} Formatted output
     */
    formatConfigOutput(configData, options = {}) {
        const { format = this.defaultFormat, compact = false } = options;
        
        const output = {
            operation: 'config',
            timestamp: new Date().toISOString(),
            version: this.version,
            data: configData
        };

        return this.formatOutput(output, format, compact);
    }

    /**
     * Format history output
     * @param {Array} historyData - History entries
     * @param {Object} options - Formatting options
     * @returns {string} Formatted output
     */
    formatHistoryOutput(historyData, options = {}) {
        const { format = this.defaultFormat, compact = false } = options;
        
        const output = {
            operation: 'history',
            timestamp: new Date().toISOString(),
            version: this.version,
            summary: {
                totalEntries: historyData.length,
                successfulDownloads: historyData.filter(h => h.status === 'success').length,
                failedDownloads: historyData.filter(h => h.status === 'failed').length
            },
            entries: historyData
        };

        return this.formatOutput(output, format, compact);
    }

    /**
     * Format error output
     * @param {Error|Object} error - Error object or structured error
     * @param {Object} options - Formatting options
     * @returns {string} Formatted error output
     */
    formatErrorOutput(error, options = {}) {
        const { format = this.defaultFormat, compact = false } = options;
        
        const output = {
            operation: 'error',
            timestamp: new Date().toISOString(),
            version: this.version,
            error: this.normalizeError(error)
        };

        return this.formatOutput(output, format, compact);
    }

    /**
     * Format progress update output
     * @param {Object} progressData - Progress information
     * @param {Object} options - Formatting options
     * @returns {string} Formatted progress output
     */
    formatProgressOutput(progressData, options = {}) {
        const { format = this.defaultFormat, compact = false } = options;
        
        const output = {
            operation: 'progress',
            timestamp: new Date().toISOString(),
            version: this.version,
            progress: progressData
        };

        return this.formatOutput(output, format, compact);
    }

    /**
     * Generate download summary statistics
     * @param {Array} results - Download results
     * @returns {Object} Summary statistics
     * @private
     */
    generateDownloadSummary(results) {
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        const resumed = results.filter(r => r.resumed);
        
        const totalSize = successful.reduce((sum, r) => sum + (r.size || 0), 0);
        const totalDuration = successful.reduce((sum, r) => sum + (r.duration || 0), 0);
        const averageSpeed = totalSize > 0 && totalDuration > 0 
            ? totalSize / (totalDuration / 1000) 
            : 0;

        return {
            total: results.length,
            successful: successful.length,
            failed: failed.length,
            resumed: resumed.length,
            totalSizeBytes: totalSize,
            totalSizeMB: Number((totalSize / 1048576).toFixed(2)),
            totalDurationMs: totalDuration,
            totalDurationSeconds: Number((totalDuration / 1000).toFixed(2)),
            averageSpeedBytesPerSecond: Math.round(averageSpeed),
            averageSpeedMBPerSecond: Number((averageSpeed / 1048576).toFixed(2))
        };
    }

    /**
     * Normalize download result for consistent output
     * @param {Object} result - Raw download result
     * @param {boolean} includeMetadata - Include enhanced metadata
     * @returns {Object} Normalized result
     * @private
     */
    normalizeDownloadResult(result, includeMetadata = false) {
        const normalized = {
            url: result.url,
            success: result.success,
            filePath: result.path || result.filePath,
            fileName: result.path ? path.basename(result.path) : null,
            size: {
                bytes: result.size || 0,
                megabytes: result.size ? Number((result.size / 1048576).toFixed(2)) : 0,
                human: result.size ? this.formatFileSize(result.size) : '0 B'
            },
            duration: {
                milliseconds: result.duration || 0,
                seconds: result.duration ? Number((result.duration / 1000).toFixed(2)) : 0,
                human: result.duration ? this.formatDuration(result.duration / 1000) : '0s'
            },
            speed: {
                bytesPerSecond: result.speed || 0,
                megabytesPerSecond: result.speed ? Number((result.speed / 1048576).toFixed(2)) : 0,
                human: result.speed ? this.formatSpeed(result.speed) : '0 B/s'
            },
            resumed: result.resumed || false,
            resumeFromByte: result.resumeFrom || 0,
            error: result.error || null
        };

        // Add enhanced metadata if requested and available
        if (includeMetadata && (result.metadata || result.fullMetadata)) {
            normalized.metadata = result.metadata || result.fullMetadata;
        }

        // Add checksums if available
        if (result.metadata?.checksums || result.fullMetadata?.integrity?.checksums) {
            normalized.integrity = {
                checksums: result.metadata?.checksums || result.fullMetadata?.integrity?.checksums,
                verified: result.fullMetadata?.integrity?.verified || false
            };
        }

        return normalized;
    }

    /**
     * Normalize error for consistent output
     * @param {Error|Object} error - Error object
     * @returns {Object} Normalized error
     * @private
     */
    normalizeError(error) {
        // Check if this is an enhanced DownloadError
        if (error.code && error.severity && error.category) {
            return {
                code: error.code,
                message: error.message,
                userMessage: error.userMessage,
                severity: error.severity,
                category: error.category,
                isRetryable: error.isRetryable,
                recoveryActions: error.recoveryActions || [],
                timestamp: error.timestamp,
                helpUrl: error.helpUrl,
                correlationId: error.correlationId,
                context: {
                    url: error.context?.url,
                    operation: error.context?.operation,
                    attempt: error.context?.attempt
                }
            };
        }

        if (error instanceof Error) {
            return {
                code: error.code || 'UNKNOWN_ERROR',
                message: error.message,
                userMessage: error.userMessage || error.message,
                severity: 'medium',
                category: 'general',
                isRetryable: true,
                recoveryActions: [{ action: 'retry_operation', params: {} }],
                stack: error.stack,
                timestamp: error.timestamp || new Date().toISOString(),
                helpUrl: error.helpUrl || null
            };
        }

        // Already structured error
        return {
            code: error.code || 'UNKNOWN_ERROR',
            message: error.message || 'Unknown error occurred',
            userMessage: error.userMessage || error.message || 'Unknown error occurred',
            severity: error.severity || 'medium',
            category: error.category || 'general',
            isRetryable: error.isRetryable !== false,
            recoveryActions: error.recoveryActions || [{ action: 'check_logs', params: {} }],
            details: error.details || {},
            timestamp: error.timestamp || new Date().toISOString(),
            helpUrl: error.helpUrl || null,
            correlationId: error.correlationId
        };
    }

    /**
     * Format output in specified format
     * @param {Object} data - Data to format
     * @param {string} format - Output format
     * @param {boolean} compact - Use compact formatting
     * @returns {string} Formatted output
     * @private
     */
    formatOutput(data, format, compact = false) {
        switch (format.toLowerCase()) {
            case 'json':
                return JSON.stringify(data, null, compact ? 0 : 2);
                
            case 'yaml':
                return yaml.dump(data, {
                    indent: compact ? 1 : 2,
                    lineWidth: compact ? 80 : 120,
                    noRefs: true,
                    sortKeys: false
                });
                
            case 'csv':
                return this.formatAsCsv(data);
                
            case 'text':
            default:
                return this.formatAsText(data);
        }
    }

    /**
     * Format as CSV
     * @param {Object} data - Data to format
     * @returns {string} CSV output
     * @private
     */
    formatAsCsv(data) {
        if (data.operation === 'download' && data.results) {
            const headers = [
                'url', 'success', 'filePath', 'fileName', 'sizeBytes', 'sizeMB', 
                'durationMs', 'durationSec', 'speedBps', 'speedMBps', 'resumed', 'error'
            ];
            
            const rows = data.results.map(result => [
                `"${result.url}"`,
                result.success,
                `"${result.filePath || ''}"`,
                `"${result.fileName || ''}"`,
                result.size.bytes,
                result.size.megabytes,
                result.duration.milliseconds,
                result.duration.seconds,
                result.speed.bytesPerSecond,
                result.speed.megabytesPerSecond,
                result.resumed,
                `"${result.error || ''}"`
            ]);
            
            return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
        }
        
        if (data.operation === 'history' && data.entries) {
            const headers = ['timestamp', 'url', 'status', 'filePath', 'size', 'duration', 'error'];
            
            const rows = data.entries.map(entry => [
                `"${entry.timestamp || ''}"`,
                `"${entry.url || ''}"`,
                `"${entry.status || ''}"`,
                `"${entry.filePath || ''}"`,
                entry.size || 0,
                entry.duration || 0,
                `"${entry.error || ''}"`
            ]);
            
            return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
        }
        
        // Fallback for other data types
        return JSON.stringify(data, null, 2);
    }

    /**
     * Format as human-readable text
     * @param {Object} data - Data to format
     * @returns {string} Text output
     * @private
     */
    formatAsText(data) {
        switch (data.operation) {
            case 'download':
                return this.formatDownloadAsText(data);
            case 'history':
                return this.formatHistoryAsText(data);
            case 'config':
                return this.formatConfigAsText(data);
            case 'error':
                return this.formatErrorAsText(data);
            default:
                return JSON.stringify(data, null, 2);
        }
    }

    /**
     * Format download results as text
     * @param {Object} data - Download data
     * @returns {string} Text output
     * @private
     */
    formatDownloadAsText(data) {
        let output = '';
        
        // Summary
        const s = data.summary;
        output += `Download Summary:\n`;
        output += `  Total files: ${s.total}\n`;
        output += `  Successful: ${s.successful}\n`;
        output += `  Failed: ${s.failed}\n`;
        if (s.resumed > 0) {
            output += `  Resumed: ${s.resumed}\n`;
        }
        output += `  Total size: ${this.formatFileSize(s.totalSizeBytes)}\n`;
        output += `  Total time: ${this.formatDuration(s.totalDurationSeconds)}\n`;
        if (s.averageSpeedBytesPerSecond > 0) {
            output += `  Average speed: ${this.formatSpeed(s.averageSpeedBytesPerSecond)}\n`;
        }
        output += '\n';
        
        // Individual results
        data.results.forEach((result, index) => {
            const status = result.success ? '✅' : '❌';
            output += `${index + 1}. ${status} ${result.url}\n`;
            
            if (result.success) {
                output += `   → ${result.filePath}\n`;
                output += `   → ${result.size.human} in ${result.duration.human} (${result.speed.human})\n`;
                if (result.resumed) {
                    output += `   → Resumed from byte ${result.resumeFromByte}\n`;
                }
                if (result.integrity?.checksums) {
                    const checksums = result.integrity.checksums;
                    if (checksums.md5) {
                        output += `   → MD5: ${checksums.md5}\n`;
                    }
                    if (checksums.sha256) {
                        output += `   → SHA256: ${checksums.sha256}\n`;
                    }
                }
            } else {
                output += `   → Error: ${result.error}\n`;
            }
            output += '\n';
        });
        
        return output.trim();
    }

    /**
     * Format history as text
     * @param {Object} data - History data
     * @returns {string} Text output
     * @private
     */
    formatHistoryAsText(data) {
        let output = `Download History (${data.summary.totalEntries} entries):\n\n`;
        
        data.entries.forEach((entry, index) => {
            const status = entry.status === 'success' ? '✅' : '❌';
            const timestamp = new Date(entry.timestamp).toLocaleString();
            
            output += `${index + 1}. ${status} ${timestamp}\n`;
            output += `   URL: ${entry.url}\n`;
            output += `   File: ${entry.filePath || 'N/A'}\n`;
            
            if (entry.status === 'success') {
                if (entry.size) {
                    output += `   Size: ${this.formatFileSize(entry.size)}\n`;
                }
                if (entry.duration) {
                    output += `   Duration: ${this.formatDuration(entry.duration / 1000)}\n`;
                }
            } else {
                output += `   Error: ${entry.error || 'Unknown error'}\n`;
            }
            output += '\n';
        });
        
        return output.trim();
    }

    /**
     * Format config as text
     * @param {Object} data - Config data
     * @returns {string} Text output
     * @private
     */
    formatConfigAsText(data) {
        return JSON.stringify(data.data, null, 2);
    }

    /**
     * Format error as text
     * @param {Object} data - Error data
     * @returns {string} Text output
     * @private
     */
    formatErrorAsText(data) {
        const error = data.error;
        let output = `❌ Error: ${error.userMessage}\n`;
        output += `📋 Code: ${error.code}\n`;
        output += `⚠️  Severity: ${error.severity?.toUpperCase() || 'UNKNOWN'}\n`;
        output += `📂 Category: ${error.category || 'general'}\n`;
        output += `🕒 Time: ${new Date(error.timestamp).toLocaleString()}\n`;
        
        if (error.correlationId) {
            output += `🔍 Correlation ID: ${error.correlationId}\n`;
        }
        
        if (error.context?.url) {
            output += `🔗 URL: ${error.context.url}\n`;
        }
        
        if (error.isRetryable !== undefined) {
            output += `🔄 Retryable: ${error.isRetryable ? 'Yes' : 'No'}\n`;
        }
        
        if (error.recoveryActions && error.recoveryActions.length > 0) {
            output += '\n💡 Suggested Actions:\n';
            error.recoveryActions.forEach((action, index) => {
                const actionName = action.action?.replace(/_/g, ' ') || action;
                output += `   ${index + 1}. ${actionName}\n`;
            });
        }
        
        if (error.helpUrl) {
            output += `\n📖 Help: ${error.helpUrl}\n`;
        }
        
        return output;
    }

    // Utility formatting methods
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatDuration(seconds) {
        if (seconds < 60) {
            return `${seconds.toFixed(1)}s`;
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

    formatSpeed(bytesPerSecond) {
        return `${this.formatFileSize(bytesPerSecond)}/s`;
    }

    /**
     * Get supported output formats
     * @returns {Array} List of supported formats
     */
    getSupportedFormats() {
        return ['json', 'yaml', 'csv', 'text'];
    }

    /**
     * Validate output format
     * @param {string} format - Format to validate
     * @returns {boolean} True if format is supported
     */
    isValidFormat(format) {
        return this.getSupportedFormats().includes(format.toLowerCase());
    }
}

module.exports = OutputFormatterService;