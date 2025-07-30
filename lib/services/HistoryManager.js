/**
 * @fileoverview Download history management with persistent tracking and analytics
 * Handles download history logging, search, analytics, and enterprise audit trails
 * @module HistoryManager
 */

const fs = require('node:fs').promises;
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * History Manager for tracking download operations with enterprise-grade audit capabilities
 * Supports structured logging, search, analytics, and configurable retention policies
 */
class HistoryManager {
    constructor() {
        this.historyDir = '.nget';
        this.historyFile = 'nget.history';
        this.maxHistorySize = 10 * 1024 * 1024; // 10MB default
        this.maxHistoryEntries = 10000; // Max entries before rotation
        this.retentionDays = 90; // Default retention period
    }

    /**
     * Create history directory if it doesn't exist
     * @param {string} destination - Target directory for history
     * @returns {Promise<string>} Path to history directory
     */
    async ensureHistoryDir(destination) {
        const historyPath = path.join(destination || process.cwd(), this.historyDir);
        try {
            await fs.mkdir(historyPath, {recursive: true});
            return historyPath;
        } catch (error) {
            throw new Error(`Failed to create history directory: ${error.message}`);
        }
    }

    /**
     * Get full path to history file
     * @param {string} destination - Target directory
     * @returns {string} Full path to history file
     */
    getHistoryPath(destination) {
        const historyDir = path.join(destination || process.cwd(), this.historyDir);
        return path.join(historyDir, this.historyFile);
    }

    /**
     * Log a download operation to history
     * @param {Object} entry - Download entry to log
     * @param {string} entry.url - Download URL
     * @param {string} entry.filePath - Local file path
     * @param {string} entry.status - 'success', 'failed', 'in_progress'
     * @param {number} [entry.size] - File size in bytes
     * @param {number} [entry.duration] - Download duration in milliseconds
     * @param {string} [entry.error] - Error message if failed
     * @param {string} [entry.correlationId] - Unique correlation ID
     * @param {Object} [entry.metadata] - Additional metadata
     * @returns {Promise<void>}
     */
    async logDownload(entry) {
        try {
            const destination = path.dirname(entry.filePath);
            await this.ensureHistoryDir(destination);

            const historyEntry = {
                timestamp: new Date().toISOString(),
                url: this.sanitizeUrl(entry.url),
                filePath: entry.filePath,
                status: entry.status,
                size: entry.size || null,
                duration: entry.duration || null,
                error: entry.error || null,
                correlationId: entry.correlationId || this.generateCorrelationId(),
                metadata: entry.metadata || {},
                version: '1.0',
            };

            const historyPath = this.getHistoryPath(destination);
            const logLine = JSON.stringify(historyEntry) + '\n';

            await fs.appendFile(historyPath, logLine, 'utf8');

            // Check if rotation is needed
            await this.checkRotation(historyPath);

        } catch (error) {
            // Don't fail downloads because of history logging issues
            console.warn(`Failed to log download history: ${error.message}`);
        }
    }

    /**
     * Read download history from file
     * @param {string} destination - Target directory
     * @param {Object} [options] - Search and filter options
     * @param {number} [options.limit] - Maximum number of entries to return
     * @param {string} [options.status] - Filter by status
     * @param {string} [options.search] - Search term for URL or filename
     * @param {Date} [options.since] - Only entries after this date
     * @param {Date} [options.until] - Only entries before this date
     * @returns {Promise<Array>} Array of history entries
     */
    async getHistory(destination, options = {}) {
        try {
            const historyPath = this.getHistoryPath(destination);
            
            // Check if history file exists
            try {
                await fs.access(historyPath);
            } catch {
                return []; // No history file exists
            }

            const content = await fs.readFile(historyPath, 'utf8');
            const lines = content.trim().split('\n').filter(line => line.trim());
            
            let entries = [];
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line);
                    entries.push(entry);
                } catch (parseError) {
                    // Skip malformed lines
                    console.warn(`Skipping malformed history entry: ${parseError.message}`);
                }
            }

            // Apply filters
            entries = this.filterEntries(entries, options);

            // Sort by timestamp (newest first)
            entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            // Apply limit
            if (options.limit && options.limit > 0) {
                entries = entries.slice(0, options.limit);
            }

            return entries;

        } catch (error) {
            throw new Error(`Failed to read download history: ${error.message}`);
        }
    }

    /**
     * Clear download history
     * @param {string} destination - Target directory
     * @returns {Promise<void>}
     */
    async clearHistory(destination) {
        try {
            const historyPath = this.getHistoryPath(destination);
            
            try {
                await fs.access(historyPath);
                await fs.unlink(historyPath);
            } catch {
                // File doesn't exist, nothing to clear
            }

        } catch (error) {
            throw new Error(`Failed to clear download history: ${error.message}`);
        }
    }

    /**
     * Get download statistics
     * @param {string} destination - Target directory
     * @param {Object} [options] - Options for statistics calculation
     * @param {number} [options.days] - Number of days to analyze (default: 30)
     * @returns {Promise<Object>} Statistics object
     */
    async getStatistics(destination, options = {}) {
        const days = options.days || 30;
        const since = new Date();
        since.setDate(since.getDate() - days);

        const entries = await this.getHistory(destination, {since});

        const stats = {
            totalDownloads: entries.length,
            successfulDownloads: 0,
            failedDownloads: 0,
            inProgressDownloads: 0,
            totalSize: 0,
            averageDuration: 0,
            successRate: 0,
            topErrors: {},
            downloadsByDay: {},
            sizeSummary: {
                smallest: null,
                largest: null,
                average: 0,
            },
        };

        let totalDuration = 0;
        let durationCount = 0;
        const sizes = [];

        for (const entry of entries) {
            // Count by status
            switch (entry.status) {
            case 'success':
                stats.successfulDownloads++;
                break;
            case 'failed':
                stats.failedDownloads++;
                // Track error types
                if (entry.error) {
                    stats.topErrors[entry.error] = (stats.topErrors[entry.error] || 0) + 1;
                }
                break;
            case 'in_progress':
                stats.inProgressDownloads++;
                break;
            }

            // Size tracking
            if (entry.size && entry.size > 0) {
                stats.totalSize += entry.size;
                sizes.push(entry.size);
            }

            // Duration tracking
            if (entry.duration && entry.duration > 0) {
                totalDuration += entry.duration;
                durationCount++;
            }

            // Downloads by day
            const day = entry.timestamp.split('T')[0];
            stats.downloadsByDay[day] = (stats.downloadsByDay[day] || 0) + 1;
        }

        // Calculate averages and rates
        if (stats.totalDownloads > 0) {
            stats.successRate = (stats.successfulDownloads / stats.totalDownloads * 100).toFixed(2);
        }

        if (durationCount > 0) {
            stats.averageDuration = Math.round(totalDuration / durationCount);
        }

        if (sizes.length > 0) {
            stats.sizeSummary.smallest = Math.min(...sizes);
            stats.sizeSummary.largest = Math.max(...sizes);
            stats.sizeSummary.average = Math.round(stats.totalSize / sizes.length);
        }

        return stats;
    }

    /**
     * Export history in different formats
     * @param {string} destination - Target directory
     * @param {string} format - Export format ('json', 'csv')
     * @param {Object} [options] - Export options
     * @returns {Promise<string>} Exported data as string
     */
    async exportHistory(destination, format, options = {}) {
        const entries = await this.getHistory(destination, options);

        switch (format.toLowerCase()) {
        case 'json':
            return JSON.stringify(entries, null, 2);
            
        case 'csv':
            return this.exportToCsv(entries);
            
        default:
            throw new Error(`Unsupported export format: ${format}`);
        }
    }

    /**
     * Filter history entries based on options
     * @param {Array} entries - Array of history entries
     * @param {Object} options - Filter options
     * @returns {Array} Filtered entries
     * @private
     */
    filterEntries(entries, options) {
        return entries.filter(entry => {
            // Status filter
            if (options.status && entry.status !== options.status) {
                return false;
            }

            // Date range filters
            if (options.since && new Date(entry.timestamp) < options.since) {
                return false;
            }

            if (options.until && new Date(entry.timestamp) > options.until) {
                return false;
            }

            // Search filter
            if (options.search) {
                const search = options.search.toLowerCase();
                const url = entry.url.toLowerCase();
                const filename = path.basename(entry.filePath).toLowerCase();
                
                if (!url.includes(search) && !filename.includes(search)) {
                    return false;
                }
            }

            return true;
        });
    }

    /**
     * Export entries to CSV format
     * @param {Array} entries - History entries
     * @returns {string} CSV formatted string
     * @private
     */
    exportToCsv(entries) {
        const headers = ['Timestamp', 'URL', 'File Path', 'Status', 'Size (bytes)', 'Duration (ms)', 'Error', 'Correlation ID'];
        const rows = [headers.join(',')];

        for (const entry of entries) {
            const row = [
                entry.timestamp,
                `"${entry.url}"`,
                `"${entry.filePath}"`,
                entry.status,
                entry.size || '',
                entry.duration || '',
                entry.error ? `"${entry.error}"` : '',
                entry.correlationId || '',
            ];
            rows.push(row.join(','));
        }

        return rows.join('\n');
    }

    /**
     * Check if history file needs rotation and perform it
     * @param {string} historyPath - Path to history file
     * @returns {Promise<void>}
     * @private
     */
    async checkRotation(historyPath) {
        try {
            const stats = await fs.stat(historyPath);
            
            // Check file size
            if (stats.size > this.maxHistorySize) {
                await this.rotateHistoryFile(historyPath);
                return;
            }

            // Check entry count
            const content = await fs.readFile(historyPath, 'utf8');
            const lineCount = content.split('\n').filter(line => line.trim()).length;
            
            if (lineCount > this.maxHistoryEntries) {
                await this.rotateHistoryFile(historyPath);
            }

        } catch (error) {
            console.warn(`Failed to check history rotation: ${error.message}`);
        }
    }

    /**
     * Rotate history file when it becomes too large
     * @param {string} historyPath - Path to history file
     * @returns {Promise<void>}
     * @private
     */
    async rotateHistoryFile(historyPath) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const archivePath = historyPath.replace('.history', `.history.${timestamp}`);
            
            // Move current file to archive
            await fs.rename(historyPath, archivePath);
            
            console.log(`History file rotated to: ${path.basename(archivePath)}`);

        } catch (error) {
            console.warn(`Failed to rotate history file: ${error.message}`);
        }
    }

    /**
     * Sanitize URL for logging (remove credentials)
     * @param {string} url - Original URL
     * @returns {string} Sanitized URL
     * @private
     */
    sanitizeUrl(url) {
        try {
            const urlObj = new URL(url);
            if (urlObj.username || urlObj.password) {
                urlObj.username = '';
                urlObj.password = '';
            }
            return urlObj.toString();
        } catch {
            // If URL parsing fails, just return original
            return url;
        }
    }

    /**
     * Generate a unique correlation ID
     * @returns {string} Correlation ID
     * @private
     */
    generateCorrelationId() {
        return `hist-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    }

    /**
     * Clean up old history entries based on retention policy
     * @param {string} destination - Target directory
     * @returns {Promise<void>}
     */
    async cleanupOldEntries(destination) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

            const entries = await this.getHistory(destination);
            const validEntries = entries.filter(entry => 
                new Date(entry.timestamp) > cutoffDate,
            );

            if (validEntries.length < entries.length) {
                // Rewrite history file with only valid entries
                const historyPath = this.getHistoryPath(destination);
                const newContent = validEntries
                    .map(entry => JSON.stringify(entry))
                    .join('\n') + '\n';

                await fs.writeFile(historyPath, newContent, 'utf8');
                
                const removedCount = entries.length - validEntries.length;
                console.log(`Cleaned up ${removedCount} old history entries`);
            }

        } catch (error) {
            console.warn(`Failed to cleanup old history entries: ${error.message}`);
        }
    }
}

module.exports = HistoryManager;