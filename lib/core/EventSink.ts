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

import * as crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import type {
    NgetEventType,
    NgetEvent,
    ChecksumResult,
    SessionSummary,
    WebhookConfig,
} from '../../types/index.js';

// UIManager is still .js — typed loosely until it migrates
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UIManager = any;

// ─── Webhook retry constants ──────────────────────────────────────────────────
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 500, 1000];

export const EVENT: Record<string, NgetEventType> = {
    SESSION_START:      'session_start',
    SESSION_END:        'session_end',
    DOWNLOAD_QUEUED:    'download_queued',
    DOWNLOAD_START:     'download_start',
    PROGRESS:           'progress',
    CHECKSUM_START:     'checksum_start',
    CHECKSUM_COMPLETE:  'checksum_complete',
    DOWNLOAD_COMPLETE:  'download_complete',
    DOWNLOAD_ERROR:     'download_error',
    FETCH_START:        'fetch_start',
    FETCH_COMPLETE:     'fetch_complete',
    FETCH_ERROR:        'fetch_error',
    WARNING:            'warning',
    INFO:               'info',
} as const;

export interface NgetEmitterOptions {
    sessionId: string;
    humanMode?: boolean;
    pipeMode?: boolean;
    ui?: UIManager;
    webhooks?: WebhookConfig[];
    /** HMAC-SHA256 secret. When set, all webhook POSTs include `X-NGet-Signature: sha256=<hex>`. */
    webhookSecret?: string;
}

export class EventSink {
    public readonly sessionId: string;
    public readonly humanMode: boolean;
    public readonly pipeMode: boolean;

    private readonly ui: UIManager;
    private readonly _out: NodeJS.WriteStream;
    private readonly _webhooks: WebhookConfig[];
    private readonly _webhookSecret: string;
    private readonly _inflight: Promise<void>[] = [];

    constructor(options: NgetEmitterOptions) {
        this.sessionId     = options.sessionId;
        this.humanMode     = options.humanMode     ?? false;
        this.pipeMode      = options.pipeMode      ?? false;
        this.ui            = options.ui            ?? null;
        this._webhooks     = options.webhooks      ?? [];
        this._webhookSecret = options.webhookSecret ?? '';

        // Route events to the right stream
        this._out = (this.humanMode || this.pipeMode)
            ? process.stderr
            : process.stdout;
    }

    // ─── Core emit ────────────────────────────────────────────────────────────

    emit(type: NgetEventType, payload: Record<string, unknown> = {}): NgetEvent {
        const event = {
            event:   type,
            ts:      Date.now(),
            session: this.sessionId,
            ...payload,
        } as NgetEvent;

        if (this.humanMode) {
            this._renderHuman(event);
        } else {
            this._out.write(JSON.stringify(event) + '\n');
        }

        if (this._webhooks.length > 0) {
            this._fireWebhooks(event);
        }

        return event;
    }

    flush(): Promise<void> {
        return Promise.allSettled(this._inflight).then(() => { this._inflight.length = 0; });
    }

    private _fireWebhooks(event: NgetEvent): void {
        for (const wh of this._webhooks) {
            if (wh.events && wh.events.length > 0 && !wh.events.includes(event.event)) {
                continue;
            }
            const body = JSON.stringify(event);

            // HMAC-SHA256 signing — prefer per-webhook secret, fall back to emitter-level secret
            const secret = wh.webhookSecret || this._webhookSecret;
            const sigHeaders: Record<string, string> = {};
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
                for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                    if (BACKOFF_MS[attempt] > 0) {
                        await sleep(BACKOFF_MS[attempt]);
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
                            if (attempt < MAX_ATTEMPTS - 1) { continue; }
                            process.stderr.write(`[nget] webhook POST to ${wh.url} failed after ${MAX_ATTEMPTS} attempts: HTTP ${res.status}\n`);
                            return;
                        }
                        // 1xx/2xx/3xx — success or redirect, done
                        return;
                    } catch (err: unknown) {
                        clearTimeout(timer);
                        // Network error — retry unless last attempt
                        if (attempt < MAX_ATTEMPTS - 1) { continue; }
                        const message = err instanceof Error ? err.message : String(err);
                        process.stderr.write(`[nget] webhook POST to ${wh.url} failed after ${MAX_ATTEMPTS} attempts: ${message}\n`);
                    }
                }
            })();

            this._inflight.push(p);
        }
    }

    // ─── Typed event helpers ──────────────────────────────────────────────────

    sessionStart(data: Record<string, unknown> = {}): NgetEvent {
        return this.emit(EVENT.SESSION_START, data);
    }

    sessionEnd(summary: Partial<SessionSummary> = {}): NgetEvent {
        return this.emit(EVENT.SESSION_END, summary as Record<string, unknown>);
    }

    downloadQueued(url: string, data: Record<string, unknown> = {}): NgetEvent {
        return this.emit(EVENT.DOWNLOAD_QUEUED, { url, ...data });
    }

    downloadStart(url: string, data: Record<string, unknown> = {}): NgetEvent {
        return this.emit(EVENT.DOWNLOAD_START, { url, ...data });
    }

    progress(url: string, bytesReceived: number, bytesTotal: number, speed: number): NgetEvent {
        return this.emit(EVENT.PROGRESS, {
            url,
            bytes_received: bytesReceived,
            bytes_total:    bytesTotal,
            speed_bps:      speed,
            pct:            bytesTotal > 0 ? Math.floor((bytesReceived / bytesTotal) * 100) : null,
        });
    }

    checksumStart(filePath: string, algorithms: string[]): NgetEvent {
        return this.emit(EVENT.CHECKSUM_START, { file: filePath, algorithms });
    }

    checksumComplete(filePath: string, checksums: ChecksumResult): NgetEvent {
        return this.emit(EVENT.CHECKSUM_COMPLETE, { file: filePath, checksums });
    }

    downloadComplete(url: string, data: Record<string, unknown> = {}): NgetEvent {
        return this.emit(EVENT.DOWNLOAD_COMPLETE, { url, ...data });
    }

    downloadError(url: string, error: Error & { code?: string; retryable?: boolean }): NgetEvent {
        return this.emit(EVENT.DOWNLOAD_ERROR, {
            url,
            error:     error.message,
            code:      error.code      ?? null,
            retryable: error.retryable ?? false,
        });
    }

    fetchStart(url: string, method: string, hasBody: boolean): NgetEvent {
        return this.emit('fetch_start', { url, method, hasBody });
    }

    fetchComplete(url: string, method: string, status: number, statusText: string, latencyMs: number, contentType: string | null): NgetEvent {
        return this.emit('fetch_complete', { url, method, status, statusText, latencyMs, contentType });
    }

    fetchError(url: string, method: string, error: string, latencyMs: number | null): NgetEvent {
        return this.emit('fetch_error', { url, method, error, latencyMs });
    }

    warn(message: string, data: Record<string, unknown> = {}): NgetEvent {
        return this.emit(EVENT.WARNING, { message, ...data });
    }

    info(message: string, data: Record<string, unknown> = {}): NgetEvent {
        return this.emit(EVENT.INFO, { message, ...data });
    }

    // ─── Human rendering ─────────────────────────────────────────────────────
    // Delegates to UIManager when present; falls back to plain text.

    private _renderHuman(event: NgetEvent): void {
        if (!this._out.writable) { return; }
        const ui = this.ui;

        switch (event.event) {
            case 'session_start':
                if (ui) { ui.displayBanner(); }
                break;

            case 'download_start': {
                const e = event as { filename?: string; url?: string; bytes_total?: number; index?: number; total?: number; resumed?: boolean; resume_from?: number };
                if (ui) {
                    ui.displayDownloadStart(
                        e.filename ?? e.url,
                        e.bytes_total ?? 0,
                        e.index ?? 1,
                        e.total ?? 1,
                        e.resumed ?? false,
                        e.resume_from ?? 0,
                    );
                } else {
                    this._out.write(`>> starting  ${(event as { url: string }).url}\n`);
                }
                break;
            }

            case 'download_complete': {
                const e = event as { filename?: string; url?: string; size?: number; bytes_total?: number; duration_ms?: number; speed_bps?: number };
                if (ui) {
                    ui.displayDownloadComplete(
                        e.filename ?? e.url,
                        e.bytes_total ?? e.size ?? 0,
                        (e.duration_ms ?? 0) / 1000,
                        e.speed_bps ?? 0,
                    );
                } else {
                    this._out.write(`[OK] ${(event as { url: string }).url}  (${e.size ?? 0} bytes)\n`);
                }
                break;
            }

            case 'download_error': {
                const e = event as { url: string; error: string };
                if (ui) {
                    ui.displayError(e.error, e.url);
                } else {
                    this._out.write(`[ERR] ${e.url}: ${e.error}\n`);
                }
                break;
            }

            case 'warning': {
                const e = event as { message: string };
                if (ui) { ui.displayWarning(e.message); }
                else     { this._out.write(`[WARN] ${e.message}\n`); }
                break;
            }

            case 'info': {
                const e = event as { message: string };
                if (ui) { ui.displayInfo(e.message); }
                else     { this._out.write(`[INFO] ${e.message}\n`); }
                break;
            }

            case 'session_end': {
                const e = event as { stats?: SessionSummary['stats'] };
                if (ui && e.stats) {
                    ui.displaySummary({
                        totalFiles:   e.stats.total,
                        successCount: e.stats.success,
                        errorCount:   e.stats.errors,
                        resumedCount: e.stats.resumed,
                        totalBytes:   e.stats.bytes,
                        totalTime:    e.stats.duration,
                        averageSpeed: e.stats.avg_speed,
                        filePaths:    e.stats.file_paths,
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
