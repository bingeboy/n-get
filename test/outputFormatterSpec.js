'use strict';

const OutputFormatterService = require('../lib/services/OutputFormatterService');

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const successResult = {
    url: 'https://example.com/file.bin',
    success: true,
    path: '/tmp/file.bin',
    size: 1048576,   // 1 MB
    duration: 2000,  // 2s
    speed: 524288,   // 0.5 MB/s
};

const failResult = {
    url: 'https://example.com/fail.bin',
    success: false,
    error: 'network timeout',
};

const historyEntry = {
    timestamp: '2026-01-01T00:00:00.000Z',
    url: 'https://example.com/file.bin',
    filePath: '/tmp/file.bin',
    status: 'success',
    size: 1024,
    duration: 500,
    error: null,
};

// ─── Constructor ──────────────────────────────────────────────────────────────

describe('OutputFormatterService', () => {

    describe('constructor', () => {
        it('defaults to text format', () => {
            const f = new OutputFormatterService();
            expect(f.defaultFormat).toBe('text');
        });

        it('accepts a custom defaultFormat', () => {
            const f = new OutputFormatterService({ defaultFormat: 'json' });
            expect(f.defaultFormat).toBe('json');
        });

        it('sets version from package.json', () => {
            const f = new OutputFormatterService();
            expect(f.version).toMatch(/^\d+\.\d+\.\d+/);
        });
    });

    // ─── formatOutput ─────────────────────────────────────────────────────────

    describe('formatOutput', () => {
        const f = new OutputFormatterService();
        const data = { operation: 'config', timestamp: '2026-01-01T00:00:00.000Z', version: '1.0.0', data: { key: 'val' } };

        it('returns valid JSON string for json format', () => {
            const out = f.formatOutput(data, 'json');
            expect(() => JSON.parse(out)).not.toThrow();
            expect(JSON.parse(out).operation).toBe('config');
        });

        it('returns compact JSON when compact=true', () => {
            const out = f.formatOutput(data, 'json', true);
            expect(out).not.toContain('\n');
        });

        it('returns YAML string for yaml format', () => {
            const out = f.formatOutput(data, 'yaml');
            expect(out).toContain('operation:');
            expect(out).toContain('config');
        });

        it('returns text for default/unknown format', () => {
            const out = f.formatOutput(data, 'text');
            expect(typeof out).toBe('string');
        });

        it('falls through to text for unknown format', () => {
            const out = f.formatOutput(data, 'unknown');
            expect(typeof out).toBe('string');
        });

        it('returns CSV for csv format on download data', () => {
            const f2 = new OutputFormatterService({ defaultFormat: 'json' });
            const dlData = f2.formatDownloadResults([successResult], { format: 'json' });
            const parsed = JSON.parse(dlData);
            // Rebuild a download-shaped data object for CSV
            const csvOut = f.formatOutput({ ...parsed, operation: 'download' }, 'csv');
            expect(csvOut).toContain('url');
        });
    });

    // ─── formatFileSize ───────────────────────────────────────────────────────

    describe('formatFileSize', () => {
        const f = new OutputFormatterService();

        it('returns "0 B" for 0 bytes', () => {
            expect(f.formatFileSize(0)).toBe('0 B');
        });

        it('formats bytes under 1 KB', () => {
            expect(f.formatFileSize(512)).toMatch(/B$/);
        });

        it('formats KB', () => {
            expect(f.formatFileSize(2048)).toMatch(/KB$/);
        });

        it('formats MB', () => {
            expect(f.formatFileSize(1048576)).toMatch(/MB$/);
        });

        it('formats GB', () => {
            expect(f.formatFileSize(1073741824)).toMatch(/GB$/);
        });
    });

    // ─── formatDuration ───────────────────────────────────────────────────────

    describe('formatDuration', () => {
        const f = new OutputFormatterService();

        it('formats seconds under 60s', () => {
            expect(f.formatDuration(5.5)).toBe('5.5s');
        });

        it('formats minutes and seconds', () => {
            expect(f.formatDuration(90)).toBe('1m 30s');
        });

        it('formats hours and minutes', () => {
            expect(f.formatDuration(3700)).toBe('1h 1m');
        });
    });

    // ─── formatSpeed ──────────────────────────────────────────────────────────

    describe('formatSpeed', () => {
        const f = new OutputFormatterService();

        it('appends /s to file size', () => {
            expect(f.formatSpeed(1024)).toMatch(/\/s$/);
        });
    });

    // ─── generateDownloadSummary ──────────────────────────────────────────────

    describe('generateDownloadSummary', () => {
        const f = new OutputFormatterService();

        it('counts successful and failed results', () => {
            const summary = f.generateDownloadSummary([successResult, failResult]);
            expect(summary.total).toBe(2);
            expect(summary.successful).toBe(1);
            expect(summary.failed).toBe(1);
        });

        it('sums total size from successful results', () => {
            const summary = f.generateDownloadSummary([successResult]);
            expect(summary.totalSizeBytes).toBe(1048576);
            expect(summary.totalSizeMB).toBeCloseTo(1, 1);
        });

        it('counts resumed results', () => {
            const resumed = { ...successResult, resumed: true };
            const summary = f.generateDownloadSummary([resumed]);
            expect(summary.resumed).toBe(1);
        });

        it('computes averageSpeedBytesPerSecond', () => {
            const summary = f.generateDownloadSummary([successResult]);
            expect(summary.averageSpeedBytesPerSecond).toBeGreaterThan(0);
        });

        it('returns 0 speed when no successful results', () => {
            const summary = f.generateDownloadSummary([failResult]);
            expect(summary.averageSpeedBytesPerSecond).toBe(0);
        });
    });

    // ─── normalizeDownloadResult ──────────────────────────────────────────────

    describe('normalizeDownloadResult', () => {
        const f = new OutputFormatterService();

        it('includes url, success, filePath, fileName', () => {
            const n = f.normalizeDownloadResult(successResult);
            expect(n.url).toBe(successResult.url);
            expect(n.success).toBe(true);
            expect(n.filePath).toBe('/tmp/file.bin');
            expect(n.fileName).toBe('file.bin');
        });

        it('includes nested size object', () => {
            const n = f.normalizeDownloadResult(successResult);
            expect(n.size.bytes).toBe(1048576);
            expect(n.size.megabytes).toBeCloseTo(1, 1);
            expect(n.size.human).toMatch(/MB/);
        });

        it('includes nested duration object', () => {
            const n = f.normalizeDownloadResult(successResult);
            expect(n.duration.milliseconds).toBe(2000);
            expect(n.duration.seconds).toBe(2);
        });

        it('includes nested speed object', () => {
            const n = f.normalizeDownloadResult(successResult);
            expect(n.speed.bytesPerSecond).toBe(524288);
        });

        it('sets error=null for successful result', () => {
            const n = f.normalizeDownloadResult(successResult);
            expect(n.error).toBeNull();
        });

        it('sets error message for failed result', () => {
            const n = f.normalizeDownloadResult(failResult);
            expect(n.error).toBe('network timeout');
        });

        it('attaches metadata when includeMetadata=true and metadata present', () => {
            const withMeta = { ...successResult, metadata: { foo: 'bar' } };
            const n = f.normalizeDownloadResult(withMeta, true);
            expect(n.metadata).toEqual({ foo: 'bar' });
        });

        it('attaches integrity when checksums present in metadata', () => {
            const withChecksums = {
                ...successResult,
                metadata: { checksums: { md5: 'abc', sha256: 'def' } },
            };
            const n = f.normalizeDownloadResult(withChecksums);
            expect(n.integrity.checksums.md5).toBe('abc');
        });
    });

    // ─── normalizeError ───────────────────────────────────────────────────────

    describe('normalizeError', () => {
        const f = new OutputFormatterService();

        it('handles DownloadError-shaped objects (code+severity+category)', () => {
            const err = {
                code: 'HTTP_404', message: 'not found', userMessage: 'File not found',
                severity: 'medium', category: 'http', isRetryable: false,
                recoveryActions: [], timestamp: '2026-01-01T00:00:00.000Z',
                helpUrl: 'https://x', correlationId: 'c1',
                context: { url: 'https://x.com', operation: 'download', attempt: 1 },
            };
            const n = f.normalizeError(err);
            expect(n.code).toBe('HTTP_404');
            expect(n.severity).toBe('medium');
            expect(n.context.url).toBe('https://x.com');
        });

        it('handles plain Error instances', () => {
            const err = new Error('something broke');
            const n = f.normalizeError(err);
            expect(n.message).toBe('something broke');
            expect(n.code).toBe('UNKNOWN_ERROR');
            expect(n.isRetryable).toBe(true);
        });

        it('handles plain objects with partial fields', () => {
            const n = f.normalizeError({ message: 'oops' });
            expect(n.code).toBe('UNKNOWN_ERROR');
            expect(n.message).toBe('oops');
        });
    });

    // ─── formatDownloadResults ────────────────────────────────────────────────

    describe('formatDownloadResults', () => {
        const f = new OutputFormatterService({ defaultFormat: 'json' });

        it('returns JSON string by default (json formatter)', () => {
            const out = f.formatDownloadResults([successResult]);
            const parsed = JSON.parse(out);
            expect(parsed.operation).toBe('download');
            expect(parsed.results).toHaveLength(1);
            expect(parsed.summary).toBeDefined();
        });

        it('accepts a single result (not array)', () => {
            const out = f.formatDownloadResults(successResult);
            const parsed = JSON.parse(out);
            expect(parsed.results).toHaveLength(1);
        });

        it('includes recommendations array', () => {
            const out = f.formatDownloadResults([successResult]);
            const parsed = JSON.parse(out);
            expect(Array.isArray(parsed.recommendations)).toBe(true);
        });

        it('includes agentContext', () => {
            const out = f.formatDownloadResults([successResult], { sessionId: 'sess-1' });
            const parsed = JSON.parse(out);
            expect(parsed.agentContext.sessionId).toBe('sess-1');
        });

        it('produces text format', () => {
            const f2 = new OutputFormatterService({ defaultFormat: 'text' });
            const out = f2.formatDownloadResults([successResult]);
            expect(out).toContain('Download Summary');
        });

        it('produces CSV format', () => {
            const out = f.formatDownloadResults([successResult], { format: 'csv' });
            expect(out).toContain('url');
            expect(out).toContain('success');
        });
    });

    // ─── formatHistoryOutput ──────────────────────────────────────────────────

    describe('formatHistoryOutput', () => {
        const f = new OutputFormatterService({ defaultFormat: 'json' });

        it('returns structured history JSON', () => {
            const out = f.formatHistoryOutput([historyEntry]);
            const parsed = JSON.parse(out);
            expect(parsed.operation).toBe('history');
            expect(parsed.summary.totalEntries).toBe(1);
            expect(parsed.summary.successfulDownloads).toBe(1);
            expect(parsed.entries).toHaveLength(1);
        });

        it('counts failed entries', () => {
            const failed = { ...historyEntry, status: 'failed' };
            const out = f.formatHistoryOutput([historyEntry, failed]);
            const parsed = JSON.parse(out);
            expect(parsed.summary.failedDownloads).toBe(1);
        });

        it('formats history as text', () => {
            const f2 = new OutputFormatterService({ defaultFormat: 'text' });
            const out = f2.formatHistoryOutput([historyEntry]);
            expect(out).toContain('Download History');
        });

        it('formats history as CSV', () => {
            const out = f.formatHistoryOutput([historyEntry], { format: 'csv' });
            expect(out).toContain('timestamp');
            expect(out).toContain('url');
        });
    });

    // ─── formatConfigOutput ───────────────────────────────────────────────────

    describe('formatConfigOutput', () => {
        const f = new OutputFormatterService({ defaultFormat: 'json' });

        it('wraps config data in operation envelope', () => {
            const out = f.formatConfigOutput({ http: { timeout: 30000 } });
            const parsed = JSON.parse(out);
            expect(parsed.operation).toBe('config');
            expect(parsed.data.http.timeout).toBe(30000);
        });

        it('formats config as text', () => {
            const f2 = new OutputFormatterService({ defaultFormat: 'text' });
            const out = f2.formatConfigOutput({ key: 'value' });
            expect(out).toContain('value');
        });
    });

    // ─── formatErrorOutput ────────────────────────────────────────────────────

    describe('formatErrorOutput', () => {
        const f = new OutputFormatterService({ defaultFormat: 'json' });

        it('wraps normalized error in operation envelope', () => {
            const err = new Error('broken');
            const out = f.formatErrorOutput(err);
            const parsed = JSON.parse(out);
            expect(parsed.operation).toBe('error');
            expect(parsed.error.message).toBe('broken');
        });

        it('formats error as text', () => {
            const f2 = new OutputFormatterService({ defaultFormat: 'text' });
            const out = f2.formatErrorOutput(new Error('oops'));
            expect(out).toContain('Error');
        });
    });

    // ─── formatProgressOutput ─────────────────────────────────────────────────

    describe('formatProgressOutput', () => {
        const f = new OutputFormatterService({ defaultFormat: 'json' });

        it('wraps progress data in operation envelope', () => {
            const out = f.formatProgressOutput({ percent: 50, bytes: 512 });
            const parsed = JSON.parse(out);
            expect(parsed.operation).toBe('progress');
            expect(parsed.progress.percent).toBe(50);
        });
    });

    // ─── generateRecommendations ──────────────────────────────────────────────

    describe('generateRecommendations', () => {
        const f = new OutputFormatterService();

        it('returns array', () => {
            expect(Array.isArray(f.generateRecommendations([successResult]))).toBe(true);
        });

        it('recommends concurrency for slow downloads', () => {
            const slow = { ...successResult, speed: 100, size: 1048576, duration: 10000 };
            const recs = f.generateRecommendations([slow]);
            expect(recs.some(r => r.action === 'increase_concurrency')).toBe(true);
        });

        it('recommends https for http URLs', () => {
            const http = { ...successResult, url: 'http://example.com/file.bin' };
            const recs = f.generateRecommendations([http]);
            expect(recs.some(r => r.action === 'prefer_https')).toBe(true);
        });

        it('recommends retry for network errors', () => {
            const netFail = { ...failResult, error: 'network error' };
            const recs = f.generateRecommendations([netFail]);
            expect(recs.some(r => r.action === 'adjust_retry_settings')).toBe(true);
        });

        it('recommends bulk profile for >10 results', () => {
            const many = Array.from({ length: 11 }, () => successResult);
            const recs = f.generateRecommendations(many);
            expect(recs.some(r => r.action === 'apply_bulk_profile')).toBe(true);
        });

        it('recommends resume monitoring for large files', () => {
            const big = { ...successResult, size: 200 * 1024 * 1024, duration: 1000 };
            const recs = f.generateRecommendations([big]);
            expect(recs.some(r => r.action === 'enable_resume_monitoring')).toBe(true);
        });
    });

    // ─── getSupportedFormats / isValidFormat ──────────────────────────────────

    describe('getSupportedFormats / isValidFormat', () => {
        const f = new OutputFormatterService();

        it('returns all four formats', () => {
            expect(f.getSupportedFormats()).toEqual(['json', 'yaml', 'csv', 'text']);
        });

        it('validates known formats', () => {
            expect(f.isValidFormat('json')).toBe(true);
            expect(f.isValidFormat('YAML')).toBe(true);
        });

        it('rejects unknown formats', () => {
            expect(f.isValidFormat('xml')).toBe(false);
        });
    });

    // ─── generateOperationSummary ─────────────────────────────────────────────

    describe('generateOperationSummary', () => {
        const f = new OutputFormatterService();

        it('returns summary with operation, success, resourcesAffected, nextActions', () => {
            const data = { results: [successResult] };
            const s = f.generateOperationSummary('download', data);
            expect(s.operation).toBe('download');
            expect(s.success).toBe(true);
            expect(s.resourcesAffected).toBe(1);
            expect(Array.isArray(s.nextActions)).toBe(true);
        });

        it('counts entries for history data', () => {
            const data = { entries: [historyEntry, historyEntry] };
            const s = f.generateOperationSummary('history', data);
            expect(s.resourcesAffected).toBe(2);
        });

        it('suggests retry action when downloads fail', () => {
            const data = { results: [failResult] };
            const s = f.generateOperationSummary('download', data);
            expect(s.nextActions.some(a => a.action === 'retry_failed_downloads')).toBe(true);
        });

        it('suggests integrity check when downloads succeed', () => {
            const data = { results: [successResult] };
            const s = f.generateOperationSummary('download', data);
            expect(s.nextActions.some(a => a.action === 'verify_integrity')).toBe(true);
        });
    });

    // ─── extractAgentContext ──────────────────────────────────────────────────

    describe('extractAgentContext', () => {
        const f = new OutputFormatterService();

        it('returns sessionId, requestId, conversationId from options', () => {
            const ctx = f.extractAgentContext({ sessionId: 's1', requestId: 'r1', conversationId: 'c1' });
            expect(ctx.sessionId).toBe('s1');
            expect(ctx.requestId).toBe('r1');
            expect(ctx.conversationId).toBe('c1');
        });

        it('defaults requestedBy to cli', () => {
            expect(f.extractAgentContext().requestedBy).toBe('cli');
        });

        it('includes userAgent with version', () => {
            expect(f.extractAgentContext().userAgent).toMatch(/n-get\//);
        });
    });
});
