/**
 * Core type definitions for n-get.
 *
 * These types are the ground truth for the public API surface.
 * As .js files are migrated to .ts, they import from here rather
 * than re-defining their own ad-hoc shapes.
 *
 * Strictness note: types here use explicit optionals and unions.
 * When a migrated file enables strict mode, these types carry the
 * full guarantees. Until then they document intent.
 */

// ─── Output & Format ──────────────────────────────────────────────────────────

export type OutputFormat = 'json' | 'yaml' | 'csv' | 'text';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export type LogFormat = 'json' | 'csv' | 'text';

// ─── Download ─────────────────────────────────────────────────────────────────

export interface SshOptions {
    keyPath?: string;
    password?: string;
    passphrase?: string;
}

/**
 * Options accepted by download() and downloadFile().
 * Typed here so callers (including agents) can construct valid calls.
 */
export interface DownloadOptions {
    enableResume?: boolean;
    sshOptions?: SshOptions;
    outputToStdout?: boolean;
    outputFilename?: string | null;
    quietMode?: boolean;
    /** Render progress bars and banners instead of NDJSON events */
    humanMode?: boolean;
    /** File content is going to stdout; events go to stderr */
    pipeMode?: boolean;
    maxConcurrent?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configManager?: any; // typed when ConfigManager is migrated
    sessionId?: string;
    agentId?: string;
    requestId?: string;
    conversationId?: string;
    enableMetadata?: boolean;
    enableChecksums?: boolean;
    outputFormat?: OutputFormat;
    logFormat?: LogFormat;
    requestedBy?: string;
    metadata?: Record<string, unknown>;
    webhooks?: WebhookConfig[];
    /** Internal: shared session injected by the batch download() call */
    _session?: unknown;
}

export interface DownloadResult {
    url: string;
    filePath?: string;
    size?: number;
    duration?: number;
    speed?: number;
    resumed?: boolean;
    resumeFrom?: number;
    success: boolean;
    error?: string;
    alreadyComplete?: boolean;
    metadata?: unknown;
    fullMetadata?: unknown;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export type NgetEventType =
    | 'session_start'
    | 'session_end'
    | 'download_queued'
    | 'download_start'
    | 'progress'
    | 'checksum_start'
    | 'checksum_complete'
    | 'download_complete'
    | 'download_error'
    | 'fetch_start'
    | 'fetch_complete'
    | 'fetch_error'
    | 'warning'
    | 'info';

/** Base fields present on every emitted event */
export interface NgetEventBase {
    event: NgetEventType;
    ts: number;
    session: string;
}

export interface SessionStartEvent extends NgetEventBase {
    event: 'session_start';
    sessionId: string;
    startTime: string;
    agent: string | null;
    pid: number;
    version?: string;
}

export interface SessionEndEvent extends NgetEventBase {
    event: 'session_end';
    stats?: SessionStats;
}

export interface DownloadQueuedEvent extends NgetEventBase {
    event: 'download_queued';
    url: string;
}

export interface DownloadStartEvent extends NgetEventBase {
    event: 'download_start';
    url: string;
    filename: string;
    bytes_total: number;
    index: number;
    total: number;
    resumed: boolean;
    resume_from?: number;
}

export interface ProgressEvent extends NgetEventBase {
    event: 'progress';
    url: string;
    bytes_received: number;
    bytes_total: number;
    speed_bps: number;
    pct: number | null;
}

export interface ChecksumStartEvent extends NgetEventBase {
    event: 'checksum_start';
    file: string;
    algorithms: string[];
}

export interface ChecksumCompleteEvent extends NgetEventBase {
    event: 'checksum_complete';
    file: string;
    checksums: ChecksumResult;
}

export interface DownloadCompleteEvent extends NgetEventBase {
    event: 'download_complete';
    url: string;
    filename: string;
    file: string;
    size: number;
    duration_ms: number;
    speed_bps: number;
    resumed: boolean;
}

export interface DownloadErrorEvent extends NgetEventBase {
    event: 'download_error';
    url: string;
    error: string;
    code: string | null;
    retryable: boolean;
}

export interface FetchStartEvent extends NgetEventBase {
    event: 'fetch_start';
    url: string;
    method: string;
    hasBody: boolean;
}

export interface FetchCompleteEvent extends NgetEventBase {
    event: 'fetch_complete';
    url: string;
    method: string;
    status: number;
    statusText: string;
    latencyMs: number;
    contentType: string | null;
}

export interface FetchErrorEvent extends NgetEventBase {
    event: 'fetch_error';
    url: string;
    method: string;
    error: string;
    latencyMs: number | null;
}

export interface WarningEvent extends NgetEventBase {
    event: 'warning';
    message: string;
    url?: string;
    code?: string;
}

export interface InfoEvent extends NgetEventBase {
    event: 'info';
    message: string;
}

/** Discriminated union of all event shapes */
export type NgetEvent =
    | SessionStartEvent
    | SessionEndEvent
    | DownloadQueuedEvent
    | DownloadStartEvent
    | ProgressEvent
    | ChecksumStartEvent
    | ChecksumCompleteEvent
    | DownloadCompleteEvent
    | DownloadErrorEvent
    | FetchStartEvent
    | FetchCompleteEvent
    | FetchErrorEvent
    | WarningEvent
    | InfoEvent;

// ─── Session state ────────────────────────────────────────────────────────────

export type DownloadStatusValue = 'queued' | 'active' | 'complete' | 'error';

export interface DownloadStatus {
    status?: DownloadStatusValue;
    file?: string;
    bytes_received?: number;
    bytes_total?: number;
    speed_bps?: number;
    error?: string;
    code?: string | null;
    index?: number;
    total?: number;
    updatedAt: string;
}

/** Shape of ~/.nget/active/{sessionId}.json */
export interface SessionStatus {
    sessionId: string;
    startTime: string;
    agent: string | null;
    pid: number;
    version?: string;
    downloads: Record<string, DownloadStatus>;
    endTime?: string;
    summary?: SessionSummary;
}

export interface SessionStats {
    total: number;
    success: number;
    errors: number;
    resumed: number;
    bytes: number;
    duration: number;
    avg_speed: number;
    file_paths: string[];
}

export interface SessionSummary {
    stats: SessionStats;
}

// ─── Checksums ────────────────────────────────────────────────────────────────

export type ChecksumAlgorithm = 'md5' | 'sha256' | 'sha512' | 'sha1';

export interface ChecksumResult {
    [algorithm: string]: string;
}

// ─── Logger ───────────────────────────────────────────────────────────────────

export interface LoggerConfig {
    level?: LogLevel;
    format?: LogFormat;
    outputs?: string[];
    enableColors?: boolean;
    logDir?: string;
}

export interface WebhookConfig {
    url: string;
    headers?: Record<string, string>;
    events?: string[];
    /** HMAC-SHA256 secret for signing webhook payloads. When set, a `X-NGet-Signature: sha256=<hex>` header is added to every POST. */
    webhookSecret?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Top-level config shape matching config/default.yaml.
 * Used as the return type of ConfigManager.getConfig() once migrated.
 */
export interface NgetConfig {
    version?: string;
    http: {
        timeout: number;
        maxRetries: number;
        userAgent: string;
    };
    downloads: {
        maxConcurrent: number;
        enableResume: boolean;
        progressReporting: boolean;
        chunkUpdateFrequency: number;
        chunkSize: number;
        defaultDirectory: string;
    };
    security: {
        maxFileSize: number;
        allowedProtocols: string[];
        blockPrivateNetworks: boolean;
        blockLocalhost: boolean;
        certificateValidation: boolean;
        sanitizeFilenames: boolean;
        enableIntegrityChecks: boolean;
        ipv6: {
            blockPrivateRanges: boolean;
            blockDocumentation: boolean;
            blockMulticast: boolean;
            allowIPv4Mapped: boolean;
            strictValidation: boolean;
        };
    };
    logging: {
        level: LogLevel;
        format: LogFormat;
        outputs: string[];
        enableColors: boolean;
    };
    ssh: {
        timeout: number;
    };
    ai: {
        enabled: boolean;
        mcp: {
            enabled: boolean;
            port: number;
            host: string;
        };
        profiles: {
            enabled: boolean;
            learningEnabled: boolean;
        };
    };
    monitoring: {
        enabled: boolean;
        metricsPort: number;
        performanceTracking: boolean;
    };
}
