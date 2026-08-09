/**
 * @fileoverview Download history management with persistent tracking and analytics
 * Handles download history logging, search, analytics, and enterprise audit trails
 * @module HistoryManager
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const fsPromises = fs.promises;

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface HistoryEntry {
    timestamp: string;
    url: string;
    filePath: string;
    status: 'success' | 'failed' | 'in_progress';
    size: number | null;
    duration: number | null;
    error: string | null;
    correlationId: string;
    // Caller-supplied agent identity (opaque identifiers, stored verbatim).
    // Optional because entries written before these fields existed lack them.
    agentId?: string | null;
    sessionId?: string | null;
    requestId?: string | null;
    conversationId?: string | null;
    metadata: Record<string, unknown>;
    version: string;
}

interface LogDownloadInput {
    url: string;
    filePath: string;
    status: 'success' | 'failed' | 'in_progress';
    size?: number;
    duration?: number;
    error?: string;
    correlationId?: string;
    agentId?: string | null;
    sessionId?: string | null;
    requestId?: string | null;
    conversationId?: string | null;
    metadata?: Record<string, unknown>;
}

interface HistoryOptions {
    limit?: number;
    status?: string;
    search?: string;
    since?: Date;
    until?: Date;
    agentId?: string;
    sessionId?: string;
    requestId?: string;
    conversationId?: string;
}

interface StatisticsOptions {
    days?: number;
}

interface SizeSummary {
    smallest: number | null;
    largest: number | null;
    average: number;
}

interface HistoryStatistics {
    totalDownloads: number;
    successfulDownloads: number;
    failedDownloads: number;
    inProgressDownloads: number;
    totalSize: number;
    averageDuration: number;
    successRate: string | number;
    topErrors: Record<string, number>;
    downloadsByDay: Record<string, number>;
    /** Download counts keyed by caller-supplied agent id; entries without one are omitted */
    downloadsByAgent: Record<string, number>;
    sizeSummary: SizeSummary;
}

/**
 * History Manager for tracking download operations with enterprise-grade audit capabilities
 * Supports structured logging, search, analytics, and configurable retention policies
 */
class HistoryManager {
    historyDir: string;
    historyFile: string;
    maxHistorySize: number;
    maxHistoryEntries: number;
    retentionDays: number;

    constructor() {
        this.historyDir = '.nget';
        this.historyFile = 'nget.history';
        this.maxHistorySize = 10 * 1024 * 1024; // 10MB default
        this.maxHistoryEntries = 10000; // Max entries before rotation
        this.retentionDays = 90; // Default retention period
    }

    /**
     * Create history directory if it doesn't exist
     * @param destination - Target directory for history
     * @returns Path to history directory
     */
    async ensureHistoryDir(destination: string): Promise<string> {
        const historyPath = path.join(destination || process.cwd(), this.historyDir);
        try {
            await fsPromises.mkdir(historyPath, {recursive: true});
            return historyPath;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to create history directory: ${msg}`);
        }
    }

    /**
     * Get full path to history file
     * @param destination - Target directory
     * @returns Full path to history file
     */
    getHistoryPath(destination: string): string {
        const historyDir = path.join(destination || process.cwd(), this.historyDir);
        return path.join(historyDir, this.historyFile);
    }

    /**
     * Log a download operation to history
     * @param entry - Download entry to log
     */
    async logDownload(entry: LogDownloadInput): Promise<void> {
        try {
            const destination = path.dirname(entry.filePath);
            await this.ensureHistoryDir(destination);

            const historyEntry: HistoryEntry = {
                timestamp: (entry as { timestamp?: string }).timestamp ?? new Date().toISOString(),
                url: this.sanitizeUrl(entry.url),
                filePath: entry.filePath,
                status: entry.status,
                size: entry.size || null,
                duration: entry.duration || null,
                error: entry.error || null,
                correlationId: entry.correlationId || this.generateCorrelationId(),
                // Opaque caller-supplied identity — persisted verbatim, never
                // parsed or enriched (same precedent as sanitizeUrl: only
                // credentials are stripped, identifiers pass through).
                agentId: entry.agentId ?? null,
                sessionId: entry.sessionId ?? null,
                requestId: entry.requestId ?? null,
                conversationId: entry.conversationId ?? null,
                metadata: entry.metadata || {},
                version: '1.0',
            };

            const historyPath = this.getHistoryPath(destination);
            const logLine = JSON.stringify(historyEntry) + '\n';

            await fsPromises.appendFile(historyPath, logLine, 'utf8');

            // Check if rotation is needed
            await this.checkRotation(historyPath);

        } catch (error: unknown) {
            // Don't fail downloads because of history logging issues
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`Failed to log download history: ${msg}`);
        }
    }

    /**
     * Read download history from file
     * @param destination - Target directory
     * @param options - Search and filter options
     * @returns Array of history entries
     */
    async getHistory(destination: string, options: HistoryOptions = {}): Promise<HistoryEntry[]> {
        try {
            const historyPath = this.getHistoryPath(destination);

            // Check if history file exists
            try {
                await fsPromises.access(historyPath);
            } catch {
                return []; // No history file exists
            }

            const content = await fsPromises.readFile(historyPath, 'utf8');
            const lines = content.trim().split('\n').filter(line => line.trim());

            let entries: HistoryEntry[] = [];
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line) as HistoryEntry;
                    entries.push(entry);
                } catch (parseError: unknown) {
                    // Skip malformed lines
                    const msg = parseError instanceof Error ? parseError.message : String(parseError);
                    console.warn(`Skipping malformed history entry: ${msg}`);
                }
            }

            // Apply filters
            entries = this.filterEntries(entries, options);

            // Sort by timestamp (newest first)
            entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

            // Apply limit
            if (options.limit && options.limit > 0) {
                entries = entries.slice(0, options.limit);
            }

            return entries;

        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to read download history: ${msg}`);
        }
    }

    /**
     * Clear download history
     * @param destination - Target directory
     */
    async clearHistory(destination: string): Promise<void> {
        try {
            const historyPath = this.getHistoryPath(destination);

            try {
                await fsPromises.access(historyPath);
                await fsPromises.unlink(historyPath);
            } catch {
                // File doesn't exist, nothing to clear
            }

        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to clear download history: ${msg}`);
        }
    }

    /**
     * Get download statistics
     * @param destination - Target directory
     * @param options - Options for statistics calculation
     * @returns Statistics object
     */
    async getStatistics(destination: string, options: StatisticsOptions = {}): Promise<HistoryStatistics> {
        const days = options.days || 30;
        const since = new Date();
        since.setDate(since.getDate() - days);

        const entries = await this.getHistory(destination, {since});

        const stats: HistoryStatistics = {
            totalDownloads: entries.length,
            successfulDownloads: 0,
            failedDownloads: 0,
            inProgressDownloads: 0,
            totalSize: 0,
            averageDuration: 0,
            successRate: 0,
            topErrors: {},
            downloadsByDay: {},
            downloadsByAgent: {},
            sizeSummary: {
                smallest: null,
                largest: null,
                average: 0,
            },
        };

        let totalDuration = 0;
        let durationCount = 0;
        const sizes: number[] = [];

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

            // Downloads by agent (legacy entries without an agentId are omitted)
            if (entry.agentId) {
                stats.downloadsByAgent[entry.agentId] = (stats.downloadsByAgent[entry.agentId] || 0) + 1;
            }
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
     * @param destination - Target directory
     * @param format - Export format ('json', 'csv')
     * @param options - Export options
     * @returns Exported data as string
     */
    async exportHistory(destination: string, format: string, options: HistoryOptions = {}): Promise<string> {
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
     * @param entries - Array of history entries
     * @param options - Filter options
     * @returns Filtered entries
     * @private
     */
    filterEntries(entries: HistoryEntry[], options: HistoryOptions): HistoryEntry[] {
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

            // Agent identity filters — exact match on opaque identifiers.
            // Entries written before these fields existed (or without them)
            // have undefined/null values and therefore never match a filter.
            if (options.agentId && entry.agentId !== options.agentId) {
                return false;
            }

            if (options.sessionId && entry.sessionId !== options.sessionId) {
                return false;
            }

            if (options.requestId && entry.requestId !== options.requestId) {
                return false;
            }

            if (options.conversationId && entry.conversationId !== options.conversationId) {
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
     * @param entries - History entries
     * @returns CSV formatted string
     * @private
     */
    exportToCsv(entries: HistoryEntry[]): string {
        const headers = ['Timestamp', 'URL', 'File Path', 'Status', 'Size (bytes)', 'Duration (ms)', 'Error', 'Correlation ID', 'Agent ID', 'Session ID', 'Request ID', 'Conversation ID'];
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
                // Caller-supplied identifiers are arbitrary strings — quote them
                entry.agentId ? `"${entry.agentId}"` : '',
                entry.sessionId ? `"${entry.sessionId}"` : '',
                entry.requestId ? `"${entry.requestId}"` : '',
                entry.conversationId ? `"${entry.conversationId}"` : '',
            ];
            rows.push(row.join(','));
        }

        return rows.join('\n');
    }

    /**
     * Check if history file needs rotation and perform it
     * @param historyPath - Path to history file
     * @private
     */
    async checkRotation(historyPath: string): Promise<void> {
        try {
            const stats = await fsPromises.stat(historyPath);

            // Check file size
            if (stats.size > this.maxHistorySize) {
                await this.rotateHistoryFile(historyPath);
                return;
            }

            // Check entry count
            const content = await fsPromises.readFile(historyPath, 'utf8');
            const lineCount = content.split('\n').filter(line => line.trim()).length;

            if (lineCount > this.maxHistoryEntries) {
                await this.rotateHistoryFile(historyPath);
            }

        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`Failed to check history rotation: ${msg}`);
        }
    }

    /**
     * Rotate history file when it becomes too large
     * @param historyPath - Path to history file
     * @private
     */
    async rotateHistoryFile(historyPath: string): Promise<void> {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const archivePath = historyPath.replace('.history', `.history.${timestamp}`);

            // Move current file to archive
            await fsPromises.rename(historyPath, archivePath);

            console.log(`History file rotated to: ${path.basename(archivePath)}`);

        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`Failed to rotate history file: ${msg}`);
        }
    }

    /**
     * Sanitize URL for logging (remove credentials)
     * @param url - Original URL
     * @returns Sanitized URL
     * @private
     */
    sanitizeUrl(url: string): string {
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
     * @returns Correlation ID
     * @private
     */
    generateCorrelationId(): string {
        return `hist-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    }

    /**
     * Clean up old history entries based on retention policy
     * @param destination - Target directory
     */
    async cleanupOldEntries(destination: string): Promise<void> {
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

                await fsPromises.writeFile(historyPath, newContent, 'utf8');

                const removedCount = entries.length - validEntries.length;
                console.log(`Cleaned up ${removedCount} old history entries`);
            }

        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`Failed to cleanup old history entries: ${msg}`);
        }
    }
}

export = HistoryManager;
