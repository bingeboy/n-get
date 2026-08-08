"use strict";
/**
 * @fileoverview Output Formatter Service for Structured Output
 * Handles formatting of all n-get output in multiple formats for AI agent consumption
 * @module OutputFormatterService
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
const yaml = require('js-yaml');
const path = __importStar(require("node:path"));
// Load package.json to get version
const packageJson = require('../../package.json');
/**
 * Output Formatter Service for structured, agent-friendly output
 * Provides consistent formatting across all n-get operations
 */
class OutputFormatterService {
    logger;
    version;
    defaultFormat;
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.version = packageJson.version;
        this.defaultFormat = options.defaultFormat || 'text';
    }
    /**
     * Format download results for output
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
            results: resultsArray.map(result => this.normalizeDownloadResult(result, includeMetadata)),
            // AI-friendly metadata
            agentContext: this.extractAgentContext(options),
            recommendations: this.generateRecommendations(resultsArray),
            _schema: {
                version: '1.0.0',
                format: format,
                spec: 'https://github.com/bingeboy/n-get'
            }
        };
        return this.formatOutput(output, format, compact);
    }
    /**
     * Format configuration output
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
            const e = error;
            return {
                code: e.code || 'UNKNOWN_ERROR',
                message: e.message,
                userMessage: e.userMessage || e.message,
                severity: 'medium',
                category: 'general',
                isRetryable: true,
                recoveryActions: [{ action: 'retry_operation', params: {} }],
                stack: e.stack,
                timestamp: e.timestamp || new Date().toISOString(),
                helpUrl: e.helpUrl || null
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
     */
    formatAsCsv(data) {
        if (data.operation === 'download' && data.results) {
            const headers = [
                'url', 'success', 'filePath', 'fileName', 'sizeBytes', 'sizeMB',
                'durationMs', 'durationSec', 'speedBps', 'speedMBps', 'resumed', 'error'
            ];
            const rows = data.results.map((result) => [
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
            return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
        }
        if (data.operation === 'history' && data.entries) {
            const headers = ['timestamp', 'url', 'status', 'filePath', 'size', 'duration', 'error'];
            const rows = data.entries.map((entry) => [
                `"${entry.timestamp || ''}"`,
                `"${entry.url || ''}"`,
                `"${entry.status || ''}"`,
                `"${entry.filePath || ''}"`,
                entry.size || 0,
                entry.duration || 0,
                `"${entry.error || ''}"`
            ]);
            return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
        }
        // Fallback for other data types
        return JSON.stringify(data, null, 2);
    }
    /**
     * Format as human-readable text
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
            }
            else {
                output += `   → Error: ${result.error}\n`;
            }
            output += '\n';
        });
        return output.trim();
    }
    /**
     * Format history as text
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
            }
            else {
                output += `   Error: ${entry.error || 'Unknown error'}\n`;
            }
            output += '\n';
        });
        return output.trim();
    }
    /**
     * Format config as text
     */
    formatConfigAsText(data) {
        return JSON.stringify(data.data, null, 2);
    }
    /**
     * Format error as text
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
        if (bytes === 0)
            return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    formatDuration(seconds) {
        if (seconds < 60) {
            return `${seconds.toFixed(1)}s`;
        }
        else if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = Math.floor(seconds % 60);
            return `${minutes}m ${remainingSeconds}s`;
        }
        else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${minutes}m`;
        }
    }
    formatSpeed(bytesPerSecond) {
        return `${this.formatFileSize(bytesPerSecond)}/s`;
    }
    /**
     * Extract agent context from options
     */
    extractAgentContext(options = {}) {
        return {
            sessionId: options.sessionId || null,
            requestId: options.requestId || null,
            conversationId: options.conversationId || null,
            requestedBy: options.requestedBy || 'cli',
            timestamp: new Date().toISOString(),
            userAgent: options.userAgent || `n-get/${this.version}`,
            environment: process.env.NODE_ENV || 'production'
        };
    }
    /**
     * Generate AI-friendly recommendations based on results
     */
    generateRecommendations(results) {
        const recommendations = [];
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        // Performance recommendations
        if (successful.length > 0) {
            const avgSpeed = successful.reduce((sum, r) => sum + (r.speed || 0), 0) / successful.length;
            const avgSize = successful.reduce((sum, r) => sum + (r.size || 0), 0) / successful.length;
            if (avgSpeed < 1048576) { // Less than 1 MB/s
                recommendations.push({
                    type: 'performance',
                    category: 'speed_optimization',
                    message: 'Consider increasing max-concurrent downloads for better performance',
                    action: 'increase_concurrency',
                    params: { suggestedConcurrency: Math.min(10, Math.max(5, results.length)) }
                });
            }
            if (avgSize > 104857600) { // Files larger than 100MB
                recommendations.push({
                    type: 'performance',
                    category: 'large_files',
                    message: 'For large files, consider using resume capability and monitoring progress',
                    action: 'enable_resume_monitoring',
                    params: { enableResume: true, enableMetadata: true }
                });
            }
        }
        // Error handling recommendations
        if (failed.length > 0) {
            const networkErrors = failed.filter(f => f.error && f.error.includes('network'));
            const timeoutErrors = failed.filter(f => f.error && f.error.includes('timeout'));
            if (networkErrors.length > 0) {
                recommendations.push({
                    type: 'reliability',
                    category: 'network_issues',
                    message: 'Network errors detected, consider increasing retry count and timeout',
                    action: 'adjust_retry_settings',
                    params: { maxRetries: 5, timeout: 60000 }
                });
            }
            if (timeoutErrors.length > 0) {
                recommendations.push({
                    type: 'reliability',
                    category: 'timeout_issues',
                    message: 'Timeout errors detected, consider increasing timeout or reducing concurrency',
                    action: 'adjust_timeout_settings',
                    params: { timeout: 90000, maxConcurrent: Math.max(1, Math.floor(results.length / 2)) }
                });
            }
        }
        // Security recommendations
        const httpUrls = results.filter(r => r.url && r.url.startsWith('http:'));
        if (httpUrls.length > 0) {
            recommendations.push({
                type: 'security',
                category: 'insecure_protocol',
                message: 'HTTP URLs detected, consider using HTTPS for secure downloads',
                action: 'prefer_https',
                params: { httpsAlternatives: httpUrls.map(r => r.url.replace('http:', 'https:')) }
            });
        }
        // Configuration recommendations
        if (results.length > 10) {
            recommendations.push({
                type: 'configuration',
                category: 'bulk_operations',
                message: 'For bulk downloads, consider using the bulk profile for optimized settings',
                action: 'apply_bulk_profile',
                params: { profile: 'bulk', command: 'nget config profile bulk' }
            });
        }
        return recommendations;
    }
    /**
     * Get supported output formats
     */
    getSupportedFormats() {
        return ['json', 'yaml', 'csv', 'text'];
    }
    /**
     * Validate output format
     */
    isValidFormat(format) {
        return this.getSupportedFormats().includes(format.toLowerCase());
    }
    /**
     * Generate agent-friendly operation summary
     */
    generateOperationSummary(operation, data) {
        const summary = {
            operation,
            timestamp: new Date().toISOString(),
            success: this.determineOperationSuccess(data),
            executionTime: data.executionTime || null,
            resourcesAffected: this.countResourcesAffected(data),
            nextActions: this.suggestNextActions(operation, data)
        };
        return summary;
    }
    /**
     * Determine if operation was successful
     */
    determineOperationSuccess(data) {
        if (data.results && Array.isArray(data.results)) {
            return data.results.some((r) => r.success);
        }
        return data.success !== false;
    }
    /**
     * Count resources affected by operation
     */
    countResourcesAffected(data) {
        if (data.results && Array.isArray(data.results)) {
            return data.results.length;
        }
        if (data.entries && Array.isArray(data.entries)) {
            return data.entries.length;
        }
        return 1;
    }
    /**
     * Suggest next actions based on operation results
     */
    suggestNextActions(operation, data) {
        const actions = [];
        switch (operation) {
            case 'download':
                if (data.results) {
                    const failed = data.results.filter((r) => !r.success);
                    if (failed.length > 0) {
                        actions.push({
                            action: 'retry_failed_downloads',
                            description: 'Retry failed downloads with resume capability',
                            command: 'nget resume'
                        });
                    }
                    const successful = data.results.filter((r) => r.success);
                    if (successful.length > 0) {
                        actions.push({
                            action: 'verify_integrity',
                            description: 'Verify downloaded file integrity',
                            command: 'nget --checksums <files>'
                        });
                    }
                }
                break;
            case 'config':
                actions.push({
                    action: 'test_configuration',
                    description: 'Test configuration with a small download',
                    command: 'nget <test-url>'
                });
                break;
            case 'history':
                actions.push({
                    action: 'analyze_patterns',
                    description: 'Analyze download patterns for optimization',
                    command: 'nget history stats'
                });
                break;
        }
        return actions;
    }
}
module.exports = OutputFormatterService;
