/**
 * @fileoverview DownloadSession — per-invocation context for n-get.
 *
 * Replaces module-level globals in downloadPipeline.js.
 * Each CLI invocation gets one session that owns its services
 * and writes a status file to ~/.nget/active/ while running.
 */

import * as os   from 'node:os';
import * as fs   from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

import type {
    SessionStatus,
    DownloadStatus,
    DownloadStatusValue,
    SessionSummary,
    WebhookConfig,
} from '../../types/index.js';

import { EventSink } from './EventSink.js';
import ConfigManager = require('../config/ConfigManager');
import SecurityService = require('../services/SecurityService');
import MetadataService = require('../services/MetadataService');
import ui = require('../ui');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const NGET_VERSION = require('../../package.json').version as string;

// Logger is still .js — loosely typed until it migrates
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Logger = require('../services/Logger');

export const ACTIVE_DIR = path.join(os.homedir(), '.nget', 'active');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DownloadSessionOptions {
    sessionId?:     string;
    agentId?:       string | null;
    humanMode?:     boolean;
    pipeMode?:      boolean;
    quietMode?:     boolean;
    webhooks?:      WebhookConfig[];
    configManager?: InstanceType<typeof ConfigManager> | null;
    /** The singleton UIManager instance from lib/ui.ts */
    ui?:            typeof ui | null;
}

export interface CompletedDownload {
    path?: string;
    size?: number;
    duration?: number;
    speed?: number;
}

// ─── DownloadSession ─────────────────────────────────────────────────────────

export class DownloadSession {
    public readonly id:          string;
    public readonly agentId:     string | null;
    public readonly humanMode:   boolean;
    public readonly pipeMode:    boolean;
    public readonly quietMode:   boolean;
    public readonly configManager: InstanceType<typeof ConfigManager> | null;
    public readonly startTime:   number;

    public readonly emitter:         EventSink;
    // logger is still a .js module — loosely typed until it migrates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public readonly logger:          any;
    public readonly securityService: InstanceType<typeof SecurityService>;
    public readonly metadataService: InstanceType<typeof MetadataService>;

    private readonly _statusFile: string;
    private          _status:     SessionStatus;
    private          _active:     boolean = false;
    private          _cancelled:  boolean = false;
    private          _writeChain: Promise<void> = Promise.resolve();

    constructor(options: DownloadSessionOptions = {}) {
        this.id            = options.sessionId    ?? _generateId();
        this.agentId       = options.agentId      ?? null;
        this.humanMode     = options.humanMode     ?? false;
        this.pipeMode      = options.pipeMode      ?? false;
        this.quietMode     = options.quietMode     ?? false;
        this.configManager = options.configManager ?? null;
        this.startTime     = Date.now();

        const configWebhooks = this._parseConfigWebhooks();
        this.emitter = new EventSink({
            sessionId:           this.id,
            humanMode:           this.humanMode,
            pipeMode:            this.pipeMode,
            ui:                  options.ui ?? null,
            webhooks:            [...configWebhooks, ...(options.webhooks ?? [])],
            webhookSecret:       (this.configManager?.get('webhooks.secret')             as string)   ?? '',
            webhookMaxAttempts:  (this.configManager?.get('webhooks.retry.maxAttempts') as number)   ?? undefined,
            webhookBackoffMs:    (this.configManager?.get('webhooks.retry.backoffMs')   as number[]) ?? undefined,
        });

        this.logger          = this._buildLogger();
        this.securityService = this._buildSecurity();
        this.metadataService = this._buildMetadata();

        this._statusFile = path.join(ACTIVE_DIR, `${this.id}.json`);
        this._status = {
            sessionId: this.id,
            startTime: new Date(this.startTime).toISOString(),
            agent:     this.agentId,
            pid:       process.pid,
            version:   NGET_VERSION,
            downloads: {},
        };
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    start(): this {
        fs.mkdirSync(ACTIVE_DIR, { recursive: true });
        this._active = true;
        this._flushStatus();
        this.emitter.sessionStart({
            sessionId: this.id,
            startTime: this._status.startTime,
            agent:     this.agentId,
            pid:       process.pid,
            version:   NGET_VERSION,
        });
        return this;
    }

    async end(summary: Partial<SessionSummary> = {}): Promise<void> {
        this._active = false;
        // Drain any in-flight _flushStatus writes before removing the file.
        await this._writeChain.catch(() => { /* ignore write errors */ });
        try { fs.unlinkSync(this._statusFile); } catch { /* already gone */ }
        this.emitter.sessionEnd(summary);
        await this.emitter.flush();
        try { await this.logger.shutdown(); } catch { /* non-fatal */ }
    }

    // ─── Download tracking ────────────────────────────────────────────────────

    queueDownload(url: string): void {
        this._status.downloads[url] = {
            status:    'queued' as DownloadStatusValue,
            updatedAt: new Date().toISOString(),
        };
        this._flushStatus();
        this.emitter.downloadQueued(url);
    }

    updateDownload(url: string, update: Partial<DownloadStatus>): void {
        this._status.downloads[url] = {
            ...(this._status.downloads[url] ?? { updatedAt: '' }),
            ...update,
            updatedAt: new Date().toISOString(),
        };
        this._flushStatus();
    }

    completeDownload(url: string, result: CompletedDownload): void {
        this.updateDownload(url, {
            status:      'complete',
            file:        result.path,
            bytes_total: result.size,
            speed_bps:   result.speed,
        });
    }

    failDownload(url: string, error: Error & { code?: string }): void {
        this.updateDownload(url, {
            status: 'error',
            error:  error.message,
            code:   error.code ?? null,
        });
    }

    cancel(): void {
        this._cancelled = true;
        this._flushStatus();
    }

    isCancelled(): boolean {
        return this._cancelled;
    }

    /** Resolves when all pending status-file writes have completed. */
    flushStatus(): Promise<void> {
        return this._writeChain.catch(() => { /* ignore write errors */ });
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    private _parseConfigWebhooks(): WebhookConfig[] {
        if (!this.configManager) { return []; }
        const raw = this.configManager.get('webhooks.default');
        if (!Array.isArray(raw) || raw.length === 0) { return []; }
        return (raw as unknown[]).reduce<WebhookConfig[]>((acc, entry) => {
            if (typeof entry === 'string' && entry) {
                acc.push({ url: entry });
            } else if (entry && typeof entry === 'object') {
                const e = entry as { url?: string; secret?: string; headers?: Record<string, string>; events?: string[] };
                if (e.url) {
                    acc.push({
                        url:           e.url,
                        webhookSecret: e.secret || undefined,
                        headers:       e.headers,
                        events:        e.events,
                    });
                }
            }
            return acc;
        }, []);
    }

    private _flushStatus(): void {
        if (!this._active) { return; }
        const payload = JSON.stringify(this._status, null, 2);
        this._writeChain = this._writeChain.then(
            () => new Promise<void>(resolve => fs.writeFile(this._statusFile, payload, () => resolve()))
        );
    }

    private _buildLogger() {
        const cfg = this.configManager
            ? this.configManager.get('logging', {}) as Record<string, unknown>
            : {} as Record<string, unknown>;
        return new Logger({
            level:        cfg['level']        ?? process.env['LOG_LEVEL'] ?? 'info',
            format:       cfg['format']       ?? 'text',
            outputs:      this.quietMode ? [] : (cfg['outputs'] ?? ['console']),
            enableColors: !this.quietMode && cfg['enableColors'] !== false,
        });
    }

    private _buildSecurity() {
        const cfg = this.configManager
            ? this.configManager.get('security', {}) as Record<string, unknown>
            : {} as Record<string, unknown>;
        return new SecurityService({
            config: {
                security: {
                    allowedProtocols:     cfg['allowedProtocols']     ?? ['https', 'http', 'sftp'],
                    blockPrivateNetworks: cfg['blockPrivateNetworks']  ?? false,
                    blockLocalhost:       cfg['blockLocalhost']        ?? false,
                },
            },
            logger: this.logger,
        });
    }

    private _buildMetadata() {
        const fullConfig = this.configManager ? this.configManager.getConfig() : {};
        return new MetadataService({
            logger:                this.logger,
            config:                fullConfig,
            enableIntegrityChecks: this.configManager
                ? (this.configManager.get('security.enableIntegrityChecks', true) as boolean)
                : true,
            enableTimingMetrics: true,
        });
    }
}

// ─── Static helpers ───────────────────────────────────────────────────────────

/**
 * Read all active session status files.
 * Skips any that are unreadable or unparseable.
 */
export function readActiveSessions(): SessionStatus[] {
    try {
        fs.mkdirSync(ACTIVE_DIR, { recursive: true });
        const files = fs.readdirSync(ACTIVE_DIR).filter(f => f.endsWith('.json'));
        return files.reduce<SessionStatus[]>((acc, file) => {
            try {
                const raw = fs.readFileSync(path.join(ACTIVE_DIR, file), 'utf8');
                acc.push(JSON.parse(raw) as SessionStatus);
            } catch { /* skip corrupt file */ }
            return acc;
        }, []);
    } catch {
        return [];
    }
}

/**
 * Remove status files from processes that no longer exist.
 * Called by `nget jobs` before reading, so stale files from crashes
 * are pruned automatically.
 */
export function pruneDeadSessions(): void {
    try {
        const files = fs.readdirSync(ACTIVE_DIR).filter(f => f.endsWith('.json'));
        for (const file of files) {
            const filePath = path.join(ACTIVE_DIR, file);
            try {
                const status = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SessionStatus;
                if (status.pid && !_processExists(status.pid)) {
                    fs.unlinkSync(filePath);
                }
            } catch { /* ignore */ }
        }
    } catch { /* active dir may not exist yet */ }
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function _generateId(): string {
    return `sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function _processExists(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function _noop(): void { /* intentional no-op for fire-and-forget writes */ }
