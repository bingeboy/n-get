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
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventSink = exports.EVENT = void 0;
const crypto = __importStar(require("node:crypto"));
const promises_1 = require("node:timers/promises");
// ─── Webhook retry defaults ───────────────────────────────────────────────────
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = [0, 500, 1000];
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
    FETCH_START: 'fetch_start',
    FETCH_COMPLETE: 'fetch_complete',
    FETCH_ERROR: 'fetch_error',
    WARNING: 'warning',
    INFO: 'info',
};
class EventSink {
    sessionId;
    humanMode;
    pipeMode;
    ui;
    _out;
    _webhooks;
    _webhookSecret;
    _maxAttempts;
    _backoffMs;
    _inflight = [];
    constructor(options) {
        this.sessionId = options.sessionId;
        this.humanMode = options.humanMode ?? false;
        this.pipeMode = options.pipeMode ?? false;
        this.ui = options.ui ?? null;
        this._webhooks = options.webhooks ?? [];
        this._webhookSecret = options.webhookSecret ?? '';
        this._maxAttempts = options.webhookMaxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        this._backoffMs = options.webhookBackoffMs ?? DEFAULT_BACKOFF_MS;
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
        if (this._webhooks.length > 0) {
            this._fireWebhooks(event);
        }
        return event;
    }
    flush() {
        return Promise.allSettled(this._inflight).then(() => { this._inflight.length = 0; });
    }
    _fireWebhooks(event) {
        for (const wh of this._webhooks) {
            if (wh.events && wh.events.length > 0 && !wh.events.includes(event.event)) {
                continue;
            }
            const body = JSON.stringify(event);
            // HMAC-SHA256 signing — prefer per-webhook secret, fall back to emitter-level secret
            const secret = wh.webhookSecret || this._webhookSecret;
            const sigHeaders = {};
            if (secret) {
                const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
                sigHeaders['X-NGet-Signature'] = sig;
            }
            const headers = {
                'Content-Type': 'application/json',
                ...wh.headers,
                ...sigHeaders,
            };
            const p = (async () => {
                for (let attempt = 0; attempt < this._maxAttempts; attempt++) {
                    if (this._backoffMs[attempt] > 0) {
                        await (0, promises_1.setTimeout)(this._backoffMs[attempt]);
                    }
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 2000);
                    try {
                        const res = await fetch(wh.url, {
                            method: 'POST',
                            headers,
                            body,
                            signal: controller.signal,
                        });
                        clearTimeout(timer);
                        if (res.status >= 400 && res.status < 500) {
                            // 4xx — client error, do not retry
                            process.stderr.write(`[nget] webhook POST to ${wh.url} failed (${res.status}): not retrying\n`);
                            return;
                        }
                        if (res.status >= 500) {
                            // 5xx — server error, retry unless last attempt
                            if (attempt < this._maxAttempts - 1) {
                                continue;
                            }
                            process.stderr.write(`[nget] webhook POST to ${wh.url} failed after ${this._maxAttempts} attempts: HTTP ${res.status}\n`);
                            return;
                        }
                        // 1xx/2xx/3xx — success or redirect, done
                        return;
                    }
                    catch (err) {
                        clearTimeout(timer);
                        // Network error — retry unless last attempt
                        if (attempt < this._maxAttempts - 1) {
                            continue;
                        }
                        const message = err instanceof Error ? err.message : String(err);
                        process.stderr.write(`[nget] webhook POST to ${wh.url} failed after ${this._maxAttempts} attempts: ${message}\n`);
                    }
                }
            })();
            this._inflight.push(p);
        }
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
    fetchStart(url, method, hasBody) {
        return this.emit('fetch_start', { url, method, hasBody });
    }
    fetchComplete(url, method, status, statusText, latencyMs, contentType) {
        return this.emit('fetch_complete', { url, method, status, statusText, latencyMs, contentType });
    }
    fetchError(url, method, error, latencyMs) {
        return this.emit('fetch_error', { url, method, error, latencyMs });
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
exports.EventSink = EventSink;
