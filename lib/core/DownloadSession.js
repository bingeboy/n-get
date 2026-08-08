"use strict";
/**
 * @fileoverview DownloadSession — per-invocation context for n-get.
 *
 * Replaces module-level globals in downloadPipeline.js.
 * Each CLI invocation gets one session that owns its services
 * and writes a status file to ~/.nget/active/ while running.
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
exports.DownloadSession = exports.ACTIVE_DIR = void 0;
exports.readActiveSessions = readActiveSessions;
exports.pruneDeadSessions = pruneDeadSessions;
const os = __importStar(require("node:os"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const crypto = __importStar(require("node:crypto"));
const EventSink_js_1 = require("./EventSink.js");
const SecurityService = require("../services/SecurityService");
const MetadataService = require("../services/MetadataService");
const NGET_VERSION = require('../../package.json').version;
// Logger is still .js — loosely typed until it migrates
const Logger = require('../services/Logger');
exports.ACTIVE_DIR = path.join(os.homedir(), '.nget', 'active');
// ─── DownloadSession ─────────────────────────────────────────────────────────
class DownloadSession {
    id;
    agentId;
    humanMode;
    pipeMode;
    quietMode;
    configManager;
    startTime;
    emitter;
    // logger is still a .js module — loosely typed until it migrates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logger;
    securityService;
    metadataService;
    _statusFile;
    _status;
    _active = false;
    _cancelled = false;
    _writeChain = Promise.resolve();
    constructor(options = {}) {
        this.id = options.sessionId ?? _generateId();
        this.agentId = options.agentId ?? null;
        this.humanMode = options.humanMode ?? false;
        this.pipeMode = options.pipeMode ?? false;
        this.quietMode = options.quietMode ?? false;
        this.configManager = options.configManager ?? null;
        this.startTime = Date.now();
        const configWebhooks = this._parseConfigWebhooks();
        this.emitter = new EventSink_js_1.EventSink({
            sessionId: this.id,
            humanMode: this.humanMode,
            pipeMode: this.pipeMode,
            ui: options.ui ?? null,
            webhooks: [...configWebhooks, ...(options.webhooks ?? [])],
            webhookSecret: this.configManager?.get('webhooks.secret') ?? '',
            webhookMaxAttempts: this.configManager?.get('webhooks.retry.maxAttempts') ?? undefined,
            webhookBackoffMs: this.configManager?.get('webhooks.retry.backoffMs') ?? undefined,
        });
        this.logger = this._buildLogger();
        this.securityService = this._buildSecurity();
        this.metadataService = this._buildMetadata();
        this._statusFile = path.join(exports.ACTIVE_DIR, `${this.id}.json`);
        this._status = {
            sessionId: this.id,
            startTime: new Date(this.startTime).toISOString(),
            agent: this.agentId,
            pid: process.pid,
            version: NGET_VERSION,
            downloads: {},
        };
    }
    // ─── Lifecycle ────────────────────────────────────────────────────────────
    start() {
        fs.mkdirSync(exports.ACTIVE_DIR, { recursive: true });
        this._active = true;
        this._flushStatus();
        this.emitter.sessionStart({
            sessionId: this.id,
            startTime: this._status.startTime,
            agent: this.agentId,
            pid: process.pid,
            version: NGET_VERSION,
        });
        return this;
    }
    async end(summary = {}) {
        this._active = false;
        // Drain any in-flight _flushStatus writes before removing the file.
        await this._writeChain.catch(() => { });
        try {
            fs.unlinkSync(this._statusFile);
        }
        catch { /* already gone */ }
        this.emitter.sessionEnd(summary);
        await this.emitter.flush();
        try {
            await this.logger.shutdown();
        }
        catch { /* non-fatal */ }
    }
    // ─── Download tracking ────────────────────────────────────────────────────
    queueDownload(url) {
        this._status.downloads[url] = {
            status: 'queued',
            updatedAt: new Date().toISOString(),
        };
        this._flushStatus();
        this.emitter.downloadQueued(url);
    }
    updateDownload(url, update) {
        this._status.downloads[url] = {
            ...(this._status.downloads[url] ?? { updatedAt: '' }),
            ...update,
            updatedAt: new Date().toISOString(),
        };
        this._flushStatus();
    }
    completeDownload(url, result) {
        this.updateDownload(url, {
            status: 'complete',
            file: result.path,
            bytes_total: result.size,
            speed_bps: result.speed,
        });
    }
    failDownload(url, error) {
        this.updateDownload(url, {
            status: 'error',
            error: error.message,
            code: error.code ?? null,
        });
    }
    cancel() {
        this._cancelled = true;
        this._flushStatus();
    }
    isCancelled() {
        return this._cancelled;
    }
    /** Resolves when all pending status-file writes have completed. */
    flushStatus() {
        return this._writeChain.catch(() => { });
    }
    // ─── Private ─────────────────────────────────────────────────────────────
    _parseConfigWebhooks() {
        if (!this.configManager) {
            return [];
        }
        const raw = this.configManager.get('webhooks.default');
        if (!Array.isArray(raw) || raw.length === 0) {
            return [];
        }
        return raw.reduce((acc, entry) => {
            if (typeof entry === 'string' && entry) {
                acc.push({ url: entry });
            }
            else if (entry && typeof entry === 'object') {
                const e = entry;
                if (e.url) {
                    acc.push({
                        url: e.url,
                        webhookSecret: e.secret || undefined,
                        headers: e.headers,
                        events: e.events,
                    });
                }
            }
            return acc;
        }, []);
    }
    _flushStatus() {
        if (!this._active) {
            return;
        }
        const payload = JSON.stringify(this._status, null, 2);
        this._writeChain = this._writeChain.then(() => new Promise(resolve => fs.writeFile(this._statusFile, payload, () => resolve())));
    }
    _buildLogger() {
        const cfg = this.configManager
            ? this.configManager.get('logging', {})
            : {};
        return new Logger({
            level: cfg['level'] ?? process.env['LOG_LEVEL'] ?? 'info',
            format: cfg['format'] ?? 'text',
            outputs: this.quietMode ? [] : (cfg['outputs'] ?? ['console']),
            enableColors: !this.quietMode && cfg['enableColors'] !== false,
        });
    }
    _buildSecurity() {
        const cfg = this.configManager
            ? this.configManager.get('security', {})
            : {};
        return new SecurityService({
            config: {
                security: {
                    allowedProtocols: cfg['allowedProtocols'] ?? ['https', 'http', 'sftp'],
                    blockPrivateNetworks: cfg['blockPrivateNetworks'] ?? false,
                    blockLocalhost: cfg['blockLocalhost'] ?? false,
                },
            },
            logger: this.logger,
        });
    }
    _buildMetadata() {
        const fullConfig = this.configManager ? this.configManager.getConfig() : {};
        return new MetadataService({
            logger: this.logger,
            config: fullConfig,
            enableIntegrityChecks: this.configManager
                ? this.configManager.get('security.enableIntegrityChecks', true)
                : true,
            enableTimingMetrics: true,
        });
    }
}
exports.DownloadSession = DownloadSession;
// ─── Static helpers ───────────────────────────────────────────────────────────
/**
 * Read all active session status files.
 * Skips any that are unreadable or unparseable.
 */
function readActiveSessions() {
    try {
        fs.mkdirSync(exports.ACTIVE_DIR, { recursive: true });
        const files = fs.readdirSync(exports.ACTIVE_DIR).filter(f => f.endsWith('.json'));
        return files.reduce((acc, file) => {
            try {
                const raw = fs.readFileSync(path.join(exports.ACTIVE_DIR, file), 'utf8');
                acc.push(JSON.parse(raw));
            }
            catch { /* skip corrupt file */ }
            return acc;
        }, []);
    }
    catch {
        return [];
    }
}
/**
 * Remove status files from processes that no longer exist.
 * Called by `nget jobs` before reading, so stale files from crashes
 * are pruned automatically.
 */
function pruneDeadSessions() {
    try {
        const files = fs.readdirSync(exports.ACTIVE_DIR).filter(f => f.endsWith('.json'));
        for (const file of files) {
            const filePath = path.join(exports.ACTIVE_DIR, file);
            try {
                const status = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (status.pid && !_processExists(status.pid)) {
                    fs.unlinkSync(filePath);
                }
            }
            catch { /* ignore */ }
        }
    }
    catch { /* active dir may not exist yet */ }
}
// ─── Private helpers ─────────────────────────────────────────────────────────
function _generateId() {
    return `sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}
function _processExists(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function _noop() { }
