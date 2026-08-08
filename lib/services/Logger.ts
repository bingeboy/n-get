/**
 * @fileoverview Enterprise-grade structured logging service
 * Provides comprehensive logging with multiple outputs, log levels, and structured data
 * @module Logger
 */

import fs from 'node:fs';
import path from 'node:path';
import { LogLevel, LogFormat, LoggerConfig } from '../../types/index.js';

interface FullLoggerConfig extends LoggerConfig {
    outputs: string[];
    logDir: string;
    enableColors: boolean;
    maxFileSize: number;
    maxFiles: number;
    includeStackTrace: boolean;
}

interface LogMetrics {
    logsWritten: number;
    errorsEncountered: number;
    lastRotation: string | null;
    startTime: number;
}

interface LogEntry {
    timestamp: string;
    level: string;
    message: string;
    correlationId: string | null;
    context: Record<string, unknown>[] | undefined;
    process: {
        pid: number;
        memory: NodeJS.MemoryUsage;
        uptime: number;
    };
    meta: Record<string, unknown> | undefined;
    error?: {
        name: string;
        message: string;
        code: string | undefined;
        stack: string | undefined;
    };
    performance?: {
        timestamp: number;
        heapUsed: number;
        logsWritten: number;
    };
}

/**
 * Enterprise logging service with structured output and multiple destinations
 * Supports console, file, and JSON outputs with configurable log levels
 */
class Logger {
    config: FullLoggerConfig;
    levels: Record<string, number>;
    colors: Record<string, string>;
    fileStreams: Map<string, NodeJS.WritableStream>;
    fileSizes: Map<string, number>;
    metrics: LogMetrics;
    contextStack: Record<string, unknown>[];
    correlationId: string | null;
    csvHeaderWritten: boolean;

    /**
     * Creates a logger instance
     * @param {Object} [config={}] - Logger configuration
     * @param {string} [config.level='info'] - Minimum log level
     * @param {string} [config.format='json'] - Output format (json|text|csv)
     * @param {Array<string>} [config.outputs=['console']] - Output destinations
     * @param {string} [config.logDir='./logs'] - Directory for log files
     * @param {boolean} [config.enableColors=true] - Enable colored console output
     * @param {number} [config.maxFileSize=10485760] - Max log file size (10MB)
     * @param {number} [config.maxFiles=5] - Max number of log files to keep
     */
    constructor(config: (LoggerConfig & Record<string, unknown>) | FullLoggerConfig = {}) {
        this.config = {
            level: (config.level as LogLevel) || 'info',
            format: (config.format as LogFormat) || 'text',
            outputs: (config.outputs as string[]) || ['console'],
            logDir: (config.logDir as string) || './.nget/logs',
            enableColors: config.enableColors !== false,
            maxFileSize: (config.maxFileSize as number) || 10 * 1024 * 1024, // 10MB
            maxFiles: (config.maxFiles as number) || 5,
            includeStackTrace: config.includeStackTrace !== false,
            ...config,
        } as FullLoggerConfig;

        // Log levels (lower number = higher priority)
        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3,
            trace: 4,
        };

        // Console colors for text format
        this.colors = {
            error: '\x1b[31m',   // Red
            warn: '\x1b[33m',    // Yellow
            info: '\x1b[36m',    // Cyan
            debug: '\x1b[35m',   // Magenta
            trace: '\x1b[90m',   // Bright black
            reset: '\x1b[0m',     // Reset
        };

        // Initialize logging infrastructure
        this.initializeLogging();

        // Log rotation state
        this.fileStreams = new Map();
        this.fileSizes = new Map();

        // Performance metrics
        this.metrics = {
            logsWritten: 0,
            errorsEncountered: 0,
            lastRotation: null,
            startTime: Date.now(),
        };

        // Context stack for correlated logging
        this.contextStack = [];
        this.correlationId = null;

        // CSV header tracking
        this.csvHeaderWritten = false;
    }

    /**
     * Initializes logging directory and output streams
     * @private
     */
    initializeLogging(): void {
        if (this.config.outputs.includes('file') || this.config.outputs.includes('json-file')) {
            try {
                if (!fs.existsSync(this.config.logDir)) {
                    fs.mkdirSync(this.config.logDir, {recursive: true});
                }
            } catch (error) {
                console.error('Failed to create log directory:', (error as Error).message);
                // Fall back to console only
                this.config.outputs = this.config.outputs.filter(output =>
                    !output.includes('file'));
            }
        }
    }

    /**
     * Logs an error message
     * @param {string} message - Error message
     * @param {Object} [meta={}] - Additional metadata
     * @param {Error} [error] - Error object for stack trace
     */
    error(message: string, meta: Record<string, unknown> = {}, error: Error | null = null): void {
        this.log('error', message, meta, error);
    }

    /**
     * Logs a warning message
     * @param {string} message - Warning message
     * @param {Object} [meta={}] - Additional metadata
     */
    warn(message: string, meta: Record<string, unknown> = {}): void {
        this.log('warn', message, meta);
    }

    /**
     * Logs an info message
     * @param {string} message - Info message
     * @param {Object} [meta={}] - Additional metadata
     */
    info(message: string, meta: Record<string, unknown> = {}): void {
        this.log('info', message, meta);
    }

    /**
     * Logs a debug message
     * @param {string} message - Debug message
     * @param {Object} [meta={}] - Additional metadata
     */
    debug(message: string, meta: Record<string, unknown> = {}): void {
        this.log('debug', message, meta);
    }

    /**
     * Logs a trace message
     * @param {string} message - Trace message
     * @param {Object} [meta={}] - Additional metadata
     */
    trace(message: string, meta: Record<string, unknown> = {}): void {
        this.log('trace', message, meta);
    }

    /**
     * Core logging method
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @param {Object} [meta={}] - Additional metadata
     * @param {Error} [error=null] - Error object
     * @private
     */
    log(level: string, message: string, meta: Record<string, unknown> = {}, error: Error | null = null): void {
        // Check if level should be logged
        if (this.levels[level] > this.levels[this.config.level]) {
            return;
        }

        try {
            const logEntry = this.createLogEntry(level, message, meta, error);
            this.writeToOutputs(logEntry);
            this.metrics.logsWritten++;
        } catch (writeError) {
            this.metrics.errorsEncountered++;
            console.error('Logging system error:', (writeError as Error).message);
        }
    }

    /**
     * Creates a structured log entry
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @param {Object} meta - Additional metadata
     * @param {Error} error - Error object
     * @returns {Object} Structured log entry
     * @private
     */
    createLogEntry(level: string, message: string, meta: Record<string, unknown>, error: Error | null): LogEntry {
        const timestamp = new Date().toISOString();

        const entry: LogEntry = {
            timestamp,
            level: level.toUpperCase(),
            message,
            correlationId: this.correlationId,
            context: this.contextStack.length > 0 ? [...this.contextStack] : undefined,
            process: {
                pid: process.pid,
                memory: process.memoryUsage(),
                uptime: process.uptime(),
            },
            meta: Object.keys(meta).length > 0 ? meta : undefined,
        };

        // Add error information if provided
        if (error) {
            entry.error = {
                name: error.name,
                message: error.message,
                code: (error as NodeJS.ErrnoException).code,
                stack: this.config.includeStackTrace ? error.stack : undefined,
            };
        }

        // Add performance data for error and warn levels
        if (['error', 'warn'].includes(level)) {
            entry.performance = {
                timestamp: Date.now(),
                heapUsed: process.memoryUsage().heapUsed,
                logsWritten: this.metrics.logsWritten,
            };
        }

        return entry;
    }

    /**
     * Writes log entry to configured outputs
     * @param {Object} logEntry - Log entry to write
     * @private
     */
    writeToOutputs(logEntry: LogEntry): void {
        for (const output of this.config.outputs) {
            try {
                switch (output) {
                case 'console':
                    this.writeToConsole(logEntry);
                    break;
                case 'file':
                    this.writeToFile(logEntry, 'application.log');
                    break;
                case 'error-file':
                    if (['ERROR', 'WARN'].includes(logEntry.level)) {
                        this.writeToFile(logEntry, 'error.log');
                    }
                    break;
                case 'json-file':
                    this.writeToJsonFile(logEntry, 'application.json');
                    break;
                case 'audit':
                    if (logEntry.meta?.audit === true) {
                        this.writeToFile(logEntry, 'audit.log');
                    }
                    break;
                default:
                    console.warn(`Unknown log output: ${output}`);
                }
            } catch (outputError) {
                console.error(`Failed to write to ${output}:`, (outputError as Error).message);
            }
        }
    }

    /**
     * Formats log entry as CSV
     * @param {Object} logEntry - Log entry to format
     * @returns {string} CSV formatted log entry
     * @private
     */
    formatAsCSV(logEntry: LogEntry): string {
        const fields = [
            logEntry.timestamp,
            logEntry.level,
            logEntry.message,
            logEntry.correlationId || '',
            logEntry.process?.pid || '',
            JSON.stringify(logEntry.meta || {}),
            logEntry.error?.message || '',
            logEntry.error?.stack || '',
        ];

        return fields.map(field => this.escapeCSVField(String(field))).join(',');
    }

    /**
     * Escapes a field for CSV format
     * @param {string} field - Field to escape
     * @returns {string} Escaped field
     * @private
     */
    escapeCSVField(field: string): string {
        // If field contains comma, double quote, or newline, wrap in quotes and escape quotes
        if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
            return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
    }

    /**
     * Gets CSV header row
     * @returns {string} CSV header
     * @private
     */
    getCSVHeader(): string {
        return 'timestamp,level,message,correlationId,pid,metadata,errorMessage,errorStack';
    }

    /**
     * Writes log entry to console
     * @param {Object} logEntry - Log entry to write
     * @private
     */
    writeToConsole(logEntry: LogEntry): void {
        if (this.config.format === 'json') {
            console.log(JSON.stringify(logEntry));
        } else if (this.config.format === 'csv') {
            // Output CSV header once if this is the first log entry
            if (this.metrics.logsWritten === 0 && !this.csvHeaderWritten) {
                console.log(this.getCSVHeader());
                this.csvHeaderWritten = true;
            }
            console.log(this.formatAsCSV(logEntry));
        } else {
            const color = this.config.enableColors ? this.colors[logEntry.level.toLowerCase()] : '';
            const reset = this.config.enableColors ? this.colors.reset : '';

            let output = `${color}[${logEntry.timestamp}] ${logEntry.level}: ${logEntry.message}${reset}`;

            if (logEntry.meta) {
                output += ` ${JSON.stringify(logEntry.meta)}`;
            }

            if (logEntry.error) {
                output += `\nError: ${logEntry.error.message}`;
                if (logEntry.error.stack && this.config.includeStackTrace) {
                    output += `\n${logEntry.error.stack}`;
                }
            }

            console.log(output);
        }
    }

    /**
     * Writes log entry to text file
     * @param {Object} logEntry - Log entry to write
     * @param {string} filename - Target filename
     * @private
     */
    writeToFile(logEntry: LogEntry, filename: string): void {
        const filePath = path.join(this.config.logDir, filename);

        // Write CSV header for first entry
        if (this.config.format === 'csv' && !fs.existsSync(filePath)) {
            const headerLine = this.getCSVHeader() + '\n';
            fs.writeFileSync(filePath, headerLine);
            this.fileSizes.set(filePath, headerLine.length);
        }

        let logLine: string;
        if (this.config.format === 'json') {
            logLine = JSON.stringify(logEntry) + '\n';
        } else if (this.config.format === 'csv') {
            logLine = this.formatAsCSV(logEntry) + '\n';
        } else {
            logLine = `[${logEntry.timestamp}] ${logEntry.level}: ${logEntry.message}`;
            if (logEntry.meta) {
                logLine += ` ${JSON.stringify(logEntry.meta)}`;
            }
            if (logEntry.error) {
                logLine += ` Error: ${logEntry.error.message}`;
            }
            logLine += '\n';
        }

        // Check for log rotation
        this.checkLogRotation(filePath, logLine.length);

        // Append to file
        fs.appendFileSync(filePath, logLine);

        // Update file size tracking
        const currentSize = this.fileSizes.get(filePath) || 0;
        this.fileSizes.set(filePath, currentSize + logLine.length);
    }

    /**
     * Writes log entry to JSON file
     * @param {Object} logEntry - Log entry to write
     * @param {string} filename - Target filename
     * @private
     */
    writeToJsonFile(logEntry: LogEntry, filename: string): void {
        const filePath = path.join(this.config.logDir, filename);
        const logLine = JSON.stringify(logEntry) + '\n';

        this.checkLogRotation(filePath, logLine.length);
        fs.appendFileSync(filePath, logLine);

        const currentSize = this.fileSizes.get(filePath) || 0;
        this.fileSizes.set(filePath, currentSize + logLine.length);
    }

    /**
     * Checks if log rotation is needed and performs rotation
     * @param {string} filePath - Path to log file
     * @param {number} newDataSize - Size of new data being added
     * @private
     */
    checkLogRotation(filePath: string, newDataSize: number): void {
        const currentSize = this.fileSizes.get(filePath) || this.getFileSize(filePath);

        if (currentSize + newDataSize > this.config.maxFileSize) {
            this.rotateLogFile(filePath);
        }
    }

    /**
     * Rotates a log file when it exceeds size limit
     * @param {string} filePath - Path to log file to rotate
     * @private
     */
    rotateLogFile(filePath: string): void {
        try {
            const dir = path.dirname(filePath);
            const ext = path.extname(filePath);
            const basename = path.basename(filePath, ext);

            // Shift existing rotated files
            for (let i = this.config.maxFiles - 1; i > 0; i--) {
                const oldFile = path.join(dir, `${basename}.${i}${ext}`);
                const newFile = path.join(dir, `${basename}.${i + 1}${ext}`);

                if (fs.existsSync(oldFile)) {
                    if (i === this.config.maxFiles - 1) {
                        fs.unlinkSync(oldFile); // Delete oldest file
                    } else {
                        fs.renameSync(oldFile, newFile);
                    }
                }
            }

            // Move current file to .1
            const rotatedFile = path.join(dir, `${basename}.1${ext}`);
            if (fs.existsSync(filePath)) {
                fs.renameSync(filePath, rotatedFile);
            }

            // Reset size tracking
            this.fileSizes.set(filePath, 0);
            this.metrics.lastRotation = new Date().toISOString();

            this.info('Log file rotated', {
                originalFile: filePath,
                rotatedFile,
                maxFiles: this.config.maxFiles,
            });

        } catch (rotationError) {
            console.error('Log rotation failed:', (rotationError as Error).message);
        }
    }

    /**
     * Gets file size safely
     * @param {string} filePath - Path to file
     * @returns {number} File size in bytes
     * @private
     */
    getFileSize(filePath: string): number {
        try {
            const stats = fs.statSync(filePath);
            return stats.size;
        } catch {
            return 0;
        }
    }

    /**
     * Sets correlation ID for request tracking
     * @param {string} correlationId - Unique correlation identifier
     */
    setCorrelationId(correlationId: string): void {
        this.correlationId = correlationId;
    }

    /**
     * Pushes context onto the logging context stack
     * @param {Object} context - Context object to add
     */
    pushContext(context: Record<string, unknown>): void {
        this.contextStack.push({
            timestamp: new Date().toISOString(),
            ...context,
        });
    }

    /**
     * Pops context from the logging context stack
     * @returns {Object|undefined} Popped context object
     */
    popContext(): Record<string, unknown> | undefined {
        return this.contextStack.pop();
    }

    /**
     * Clears all context from the stack
     */
    clearContext(): void {
        this.contextStack = [];
    }

    /**
     * Creates a child logger with additional context
     * @param {Object} context - Context to add to all logs
     * @returns {Logger} Child logger instance
     */
    child(context: Record<string, unknown>): Logger {
        const child = new Logger(this.config);
        child.correlationId = this.correlationId;
        child.contextStack = [...this.contextStack];
        child.pushContext(context);
        return child;
    }

    /**
     * Logs audit trail events
     * @param {string} action - Action being audited
     * @param {Object} details - Audit details
     * @param {string} [userId] - User performing the action
     */
    audit(action: string, details: Record<string, unknown>, userId: string | null = null): void {
        this.info(`Audit: ${action}`, {
            audit: true,
            action,
            userId,
            details,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Logs performance metrics
     * @param {string} operation - Operation being measured
     * @param {number} duration - Duration in milliseconds
     * @param {Object} [details={}] - Additional performance details
     */
    performance(operation: string, duration: number, details: Record<string, unknown> = {}): void {
        this.info(`Performance: ${operation}`, {
            performance: true,
            operation,
            duration,
            ...details,
        });
    }

    /**
     * Logs security events
     * @param {string} event - Security event type
     * @param {Object} details - Event details
     * @param {string} [severity='info'] - Event severity
     */
    security(event: string, details: Record<string, unknown>, severity: string = 'info'): void {
        (this as unknown as Record<string, (msg: string, meta: Record<string, unknown>) => void>)[severity](`Security: ${event}`, {
            security: true,
            event,
            severity,
            details,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Gets logging statistics
     * @returns {Object} Current logging statistics
     */
    getStats(): Record<string, unknown> {
        return {
            ...this.metrics,
            uptime: Date.now() - this.metrics.startTime,
            config: {
                level: this.config.level,
                outputs: this.config.outputs,
                format: this.config.format,
            },
            files: Object.fromEntries(this.fileSizes),
            contextDepth: this.contextStack.length,
            correlationId: this.correlationId,
        };
    }

    /**
     * Flushes all log buffers and closes file streams
     * @returns {Promise<void>}
     */
    async flush(): Promise<void> {
        return new Promise((resolve) => {
            // For now, we're using synchronous file operations
            // In a full implementation, you'd flush async streams here
            resolve();
        });
    }

    /**
     * Gracefully shuts down the logger
     * @returns {Promise<void>}
     */
    async shutdown(): Promise<void> {
        this.info('Logger shutting down', {
            stats: this.getStats(),
        });

        await this.flush();

        // Close any open file streams
        for (const stream of this.fileStreams.values()) {
            if (stream && typeof stream.end === 'function') {
                stream.end();
            }
        }

        this.fileStreams.clear();
    }
}

export default Logger;
export { Logger };

// CommonJS interop: allow `const Logger = require('...')` to work as a constructor
module.exports = Logger;
module.exports.default = Logger;
module.exports.Logger = Logger;
