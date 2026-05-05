"use strict";
/**
 * @fileoverview Structured event emitter for n-get.
 *
 * Default (agent) mode: writes NDJSON lines to stdout.
 * Human mode (--human or TTY): writes formatted text to stderr via UIManager.
 * Pipe mode (-o -): events go to stderr so stdout is clean for file content.
 *
 * All callers emit through this class. Direct process.stdout.write calls
 * for event output are banned outside this file.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NgetEmitter = exports.EVENT = void 0;
exports.EVENT = {
    SESSION_START: 'session_start',
    SESSION_END: 'session_end',
    DOWNLOAD_QUEUED: 'download_queued',
    DOWNLOAD_START: 'download_start',
    PROGRESS: 'progress',
    CHECKSUM_START: 'checksum_start',
    CHECKSUM_COMPLETE: 'checksum_complete',
    DOWNLOAD_COMPLETE: 'download_complete',
    DOWNLOAD_ERROR: 'download_error',
    WARNING: 'warning',
    INFO: 'info',
};
class NgetEmitter {
    sessionId;
    humanMode;
    pipeMode;
    ui;
    _out;
    constructor(options) {
        this.sessionId = options.sessionId;
        this.humanMode = options.humanMode ?? false;
        this.pipeMode = options.pipeMode ?? false;
        this.ui = options.ui ?? null;
        // Route events to the right stream
        this._out = (this.humanMode || this.pipeMode)
            ? process.stderr
            : process.stdout;
    }
    // ─── Core emit ────────────────────────────────────────────────────────────
    emit(type, payload = {}) {
        const event = {
            event: type,
            ts: Date.now(),
            session: this.sessionId,
            ...payload,
        };
        if (this.humanMode) {
            this._renderHuman(event);
        }
        else {
            this._out.write(JSON.stringify(event) + '\n');
        }
        return event;
    }
    // ─── Typed event helpers ──────────────────────────────────────────────────
    sessionStart(data = {}) {
        return this.emit(exports.EVENT.SESSION_START, data);
    }
    sessionEnd(summary = {}) {
        return this.emit(exports.EVENT.SESSION_END, summary);
    }
    downloadQueued(url, data = {}) {
        return this.emit(exports.EVENT.DOWNLOAD_QUEUED, { url, ...data });
    }
    downloadStart(url, data = {}) {
        return this.emit(exports.EVENT.DOWNLOAD_START, { url, ...data });
    }
    progress(url, bytesReceived, bytesTotal, speed) {
        return this.emit(exports.EVENT.PROGRESS, {
            url,
            bytes_received: bytesReceived,
            bytes_total: bytesTotal,
            speed_bps: speed,
            pct: bytesTotal > 0 ? Math.floor((bytesReceived / bytesTotal) * 100) : null,
        });
    }
    checksumStart(filePath, algorithms) {
        return this.emit(exports.EVENT.CHECKSUM_START, { file: filePath, algorithms });
    }
    checksumComplete(filePath, checksums) {
        return this.emit(exports.EVENT.CHECKSUM_COMPLETE, { file: filePath, checksums });
    }
    downloadComplete(url, data = {}) {
        return this.emit(exports.EVENT.DOWNLOAD_COMPLETE, { url, ...data });
    }
    downloadError(url, error) {
        return this.emit(exports.EVENT.DOWNLOAD_ERROR, {
            url,
            error: error.message,
            code: error.code ?? null,
            retryable: error.retryable ?? false,
        });
    }
    warn(message, data = {}) {
        return this.emit(exports.EVENT.WARNING, { message, ...data });
    }
    info(message, data = {}) {
        return this.emit(exports.EVENT.INFO, { message, ...data });
    }
    // ─── Human rendering ─────────────────────────────────────────────────────
    // Delegates to UIManager when present; falls back to plain text.
    _renderHuman(event) {
        if (!this._out.writable) {
            return;
        }
        const ui = this.ui;
        switch (event.event) {
            case 'session_start':
                if (ui) {
                    ui.displayBanner();
                }
                break;
            case 'download_start': {
                const e = event;
                if (ui) {
                    ui.displayDownloadStart(e.filename ?? e.url, e.bytes_total ?? 0, e.index ?? 1, e.total ?? 1, e.resumed ?? false, e.resume_from ?? 0);
                }
                else {
                    this._out.write(`>> starting  ${event.url}\n`);
                }
                break;
            }
            case 'download_complete': {
                const e = event;
                if (ui) {
                    ui.displayDownloadComplete(e.filename ?? e.url, e.bytes_total ?? e.size ?? 0, (e.duration_ms ?? 0) / 1000, e.speed_bps ?? 0);
                }
                else {
                    this._out.write(`[OK] ${event.url}  (${e.size ?? 0} bytes)\n`);
                }
                break;
            }
            case 'download_error': {
                const e = event;
                if (ui) {
                    ui.displayError(e.error, e.url);
                }
                else {
                    this._out.write(`[ERR] ${e.url}: ${e.error}\n`);
                }
                break;
            }
            case 'warning': {
                const e = event;
                if (ui) {
                    ui.displayWarning(e.message);
                }
                else {
                    this._out.write(`[WARN] ${e.message}\n`);
                }
                break;
            }
            case 'info': {
                const e = event;
                if (ui) {
                    ui.displayInfo(e.message);
                }
                else {
                    this._out.write(`[INFO] ${e.message}\n`);
                }
                break;
            }
            case 'session_end': {
                const e = event;
                if (ui && e.stats) {
                    ui.displaySummary({
                        totalFiles: e.stats.total,
                        successCount: e.stats.success,
                        errorCount: e.stats.errors,
                        resumedCount: e.stats.resumed,
                        totalBytes: e.stats.bytes,
                        totalTime: e.stats.duration,
                        averageSpeed: e.stats.avg_speed,
                        filePaths: e.stats.file_paths,
                    });
                }
                break;
            }
            default:
                // progress, checksum events: silent in human mode
                // (progress bar handles its own rendering via UIManager)
                break;
        }
    }
}
exports.NgetEmitter = NgetEmitter;
