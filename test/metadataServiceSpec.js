'use strict';

const MetadataService = require('../lib/services/MetadataService');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLogger() {
    return { warn: () => {}, error: () => {}, info: () => {}, debug: () => {}, trace: () => {} };
}

function makeService(opts = {}) {
    return new MetadataService({ logger: makeLogger(), ...opts });
}

function makeResponse(headersMap = {}, opts = {}) {
    const normalized = {};
    for (const [k, v] of Object.entries(headersMap)) {normalized[k.toLowerCase()] = v;}
    return {
        status:      opts.status      ?? 200,
        statusText:  opts.statusText  ?? 'OK',
        ok:          opts.ok          !== false,
        redirected:  opts.redirected  || false,
        url:         opts.url         || 'https://example.com/file.zip',
        headers: {
            get:     (key) => normalized[key.toLowerCase()] ?? null,
            forEach: (fn)  => Object.entries(normalized).forEach(([k, v]) => fn(v, k)),
        },
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MetadataService', () => {

    describe('constructor', () => {
        it('uses console as default logger', () => {
            const svc = new MetadataService();
            expect(svc.logger).toBe(console);
        });

        it('accepts a custom logger', () => {
            const logger = makeLogger();
            const svc = makeService({ logger });
            expect(svc.logger).toBe(logger);
        });

        it('enableIntegrityChecks defaults to true', () => {
            const svc = makeService();
            expect(svc.enableIntegrityChecks).toBe(true);
        });

        it('respects enableIntegrityChecks=false', () => {
            const svc = makeService({ enableIntegrityChecks: false });
            expect(svc.enableIntegrityChecks).toBe(false);
        });

        it('enableTimingMetrics defaults to true', () => {
            const svc = makeService();
            expect(svc.enableTimingMetrics).toBe(true);
        });

        it('sets version from package.json', () => {
            const svc = makeService();
            expect(typeof svc.version).toBe('string');
            expect(svc.version.length).toBeGreaterThan(0);
        });
    });

    describe('generateSessionId / generateRequestId', () => {
        it('generateSessionId returns a string starting with "session-"', () => {
            const svc = makeService();
            const id = svc.generateSessionId();
            expect(typeof id).toBe('string');
            expect(id.startsWith('session-')).toBe(true);
        });

        it('generateRequestId returns a string starting with "req-"', () => {
            const svc = makeService();
            const id = svc.generateRequestId();
            expect(id.startsWith('req-')).toBe(true);
        });

        it('generateSessionId produces unique IDs', () => {
            const svc = makeService();
            const a = svc.generateSessionId();
            const b = svc.generateSessionId();
            expect(a).not.toBe(b);
        });
    });

    describe('getToolCapabilities', () => {
        it('returns object with protocols array', () => {
            const caps = makeService().getToolCapabilities();
            expect(Array.isArray(caps.protocols)).toBe(true);
            expect(caps.protocols).toContain('https');
        });

        it('returns object with features array', () => {
            const caps = makeService().getToolCapabilities();
            expect(Array.isArray(caps.features)).toBe(true);
            expect(caps.features).toContain('resume_downloads');
        });

        it('includes outputFormats', () => {
            const caps = makeService().getToolCapabilities();
            expect(caps.outputFormats).toContain('json');
        });
    });

    describe('detectIpVersion', () => {
        it('returns "ipv6" when hostname contains ":"', () => {
            const svc = makeService();
            expect(svc.detectIpVersion('::1')).toBe('ipv6');
            expect(svc.detectIpVersion('fe80::1')).toBe('ipv6');
        });

        it('returns "ipv4" for dotted-decimal IPv4', () => {
            const svc = makeService();
            expect(svc.detectIpVersion('192.168.1.1')).toBe('ipv4');
            expect(svc.detectIpVersion('8.8.8.8')).toBe('ipv4');
        });

        it('returns "domain" for hostnames', () => {
            const svc = makeService();
            expect(svc.detectIpVersion('example.com')).toBe('domain');
            expect(svc.detectIpVersion('localhost')).toBe('domain');
        });
    });

    describe('detectCdn', () => {
        it('detects cloudflare via server header', () => {
            const svc = makeService();
            const resp = makeResponse({ server: 'cloudflare' });
            expect(svc.detectCdn(resp)).toBe('cloudflare');
        });

        it('detects amazonaws via via header', () => {
            const svc = makeService();
            const resp = makeResponse({ via: '1.1 amazonaws.com' });
            expect(svc.detectCdn(resp)).toBe('amazonaws');
        });

        it('detects fastly via x-cache header', () => {
            const svc = makeService();
            const resp = makeResponse({ 'x-cache': 'HIT from fastly' });
            expect(svc.detectCdn(resp)).toBe('fastly');
        });

        it('returns null when no CDN detected', () => {
            const svc = makeService();
            const resp = makeResponse({ server: 'nginx' });
            expect(svc.detectCdn(resp)).toBeNull();
        });

        it('returns null for null response', () => {
            const svc = makeService();
            expect(svc.detectCdn(null)).toBeNull();
        });
    });

    describe('extractMaxAge', () => {
        it('returns null when cacheControl is null/falsy', () => {
            const svc = makeService();
            expect(svc.extractMaxAge(null)).toBeNull();
            expect(svc.extractMaxAge('')).toBeNull();
        });

        it('parses max-age value from cache-control string', () => {
            const svc = makeService();
            expect(svc.extractMaxAge('public, max-age=3600')).toBe(3600);
            expect(svc.extractMaxAge('max-age=86400, must-revalidate')).toBe(86400);
        });

        it('returns null when cache-control has no max-age', () => {
            const svc = makeService();
            expect(svc.extractMaxAge('no-cache, no-store')).toBeNull();
        });
    });

    describe('extractRedirectChain', () => {
        it('returns empty array when response is not redirected', () => {
            const svc = makeService();
            const resp = makeResponse({}, { redirected: false });
            expect(svc.extractRedirectChain(resp)).toEqual([]);
        });

        it('returns redirect entry when response is redirected', () => {
            const svc = makeService();
            const resp = makeResponse({}, { redirected: true, url: 'https://final.example.com/file' });
            const chain = svc.extractRedirectChain(resp);
            expect(chain.length).toBe(1);
            expect(chain[0].to).toBe('https://final.example.com/file');
        });
    });

    describe('sanitizeHeaders', () => {
        it('returns empty object for null/no-forEach headers', () => {
            const svc = makeService();
            expect(svc.sanitizeHeaders(null)).toEqual({});
            expect(svc.sanitizeHeaders({})).toEqual({});
        });

        it('excludes Authorization header', () => {
            const svc = makeService();
            const headers = makeResponse({ authorization: 'Bearer token', 'content-type': 'text/html' }).headers;
            const result = svc.sanitizeHeaders(headers);
            expect(result['content-type']).toBe('text/html');
            expect(result['authorization']).toBeUndefined();
        });

        it('excludes Cookie header', () => {
            const svc = makeService();
            const headers = makeResponse({ cookie: 'session=abc', 'x-custom': 'ok' }).headers;
            const result = svc.sanitizeHeaders(headers);
            expect(result['x-custom']).toBe('ok');
            expect(result['cookie']).toBeUndefined();
        });
    });

    describe('extractMimeType', () => {
        it('returns mime type from Content-Type header', () => {
            const svc = makeService();
            const resp = makeResponse({ 'content-type': 'application/json; charset=utf-8' });
            expect(svc.extractMimeType(resp, '.json')).toBe('application/json');
        });

        it('falls back to extension mapping when no content-type', () => {
            const svc = makeService();
            expect(svc.extractMimeType(null, '.pdf')).toBe('application/pdf');
            expect(svc.extractMimeType(null, '.zip')).toBe('application/zip');
            expect(svc.extractMimeType(null, '.mp4')).toBe('video/mp4');
        });

        it('returns application/octet-stream for unknown extension', () => {
            const svc = makeService();
            expect(svc.extractMimeType(null, '.unknown')).toBe('application/octet-stream');
        });
    });

    describe('extractContentLength', () => {
        it('parses content-length header', () => {
            const svc = makeService();
            const resp = makeResponse({ 'content-length': '102400' });
            expect(svc.extractContentLength(resp)).toBe(102400);
        });

        it('returns null when content-length absent', () => {
            const svc = makeService();
            expect(svc.extractContentLength(null)).toBeNull();
            expect(svc.extractContentLength(makeResponse({}))).toBeNull();
        });
    });

    describe('extractEncoding', () => {
        it('extracts charset from content-type', () => {
            const svc = makeService();
            const resp = makeResponse({ 'content-type': 'text/html; charset=utf-8' });
            expect(svc.extractEncoding(resp)).toBe('utf-8');
        });

        it('returns null when content-type has no charset', () => {
            const svc = makeService();
            const resp = makeResponse({ 'content-type': 'application/json' });
            expect(svc.extractEncoding(resp)).toBeNull();
        });

        it('returns null when no content-type header', () => {
            const svc = makeService();
            expect(svc.extractEncoding(null)).toBeNull();
        });
    });

    describe('isCompressed', () => {
        it('returns true for gzip encoding', () => {
            const svc = makeService();
            const resp = makeResponse({ 'content-encoding': 'gzip' });
            expect(svc.isCompressed(resp)).toBe(true);
        });

        it('returns true for br (brotli) encoding', () => {
            const svc = makeService();
            const resp = makeResponse({ 'content-encoding': 'br' });
            expect(svc.isCompressed(resp)).toBe(true);
        });

        it('returns false when no content-encoding', () => {
            const svc = makeService();
            expect(svc.isCompressed(makeResponse({}))).toBe(false);
            expect(svc.isCompressed(null)).toBe(false);
        });

        it('returns false for non-compression encodings', () => {
            const svc = makeService();
            const resp = makeResponse({ 'content-encoding': 'identity' });
            expect(svc.isCompressed(resp)).toBe(false);
        });
    });

    describe('formatDuration', () => {
        it('returns seconds string for values under 60', () => {
            const svc = makeService();
            expect(svc.formatDuration(30)).toBe('30s');
            expect(svc.formatDuration(0)).toBe('0s');
            expect(svc.formatDuration(59)).toBe('59s');
        });

        it('returns minutes and seconds for 60-3599 second range', () => {
            const svc = makeService();
            expect(svc.formatDuration(60)).toBe('1m 0s');
            expect(svc.formatDuration(90)).toBe('1m 30s');
            expect(svc.formatDuration(3599)).toBe('59m 59s');
        });

        it('returns hours and minutes for 3600+ seconds', () => {
            const svc = makeService();
            expect(svc.formatDuration(3600)).toBe('1h 0m');
            expect(svc.formatDuration(7200)).toBe('2h 0m');
            expect(svc.formatDuration(3661)).toBe('1h 1m');
        });
    });

    describe('extractHttpMetadata', () => {
        it('returns null-populated structure when no response', () => {
            const svc = makeService();
            const result = svc.extractHttpMetadata(null);
            expect(result.status).toBeNull();
            expect(result.headers).toEqual({});
        });

        it('returns status, headers, cache, compression, security from response', () => {
            const svc = makeService();
            const resp = makeResponse({
                'cache-control': 'public, max-age=3600',
                'etag': '"abc123"',
                'content-encoding': 'gzip',
            }, { status: 200 });
            const result = svc.extractHttpMetadata(resp);
            expect(result.status.code).toBe(200);
            expect(result.cache.cacheControl).toBe('public, max-age=3600');
            expect(result.cache.maxAge).toBe(3600);
            expect(result.cache.etag).toBe('"abc123"');
            expect(result.compression.contentEncoding).toBe('gzip');
        });
    });

    describe('extractSourceMetadata', () => {
        it('extracts protocol, hostname, and pathname from URL', async() => {
            const svc = makeService();
            const resp = makeResponse({}, { url: 'https://example.com/file.zip' });
            const meta = await svc.extractSourceMetadata('https://example.com/file.zip', resp);
            expect(meta.protocol).toBe('https');
            expect(meta.hostname).toBe('example.com');
            expect(meta.pathname).toBe('/file.zip');
            expect(meta.isSecure).toBe(true);
        });

        it('marks non-https URLs as not secure', async() => {
            const svc = makeService();
            const resp = makeResponse({}, { url: 'http://example.com/file' });
            const meta = await svc.extractSourceMetadata('http://example.com/file', resp);
            expect(meta.isSecure).toBe(false);
        });

        it('populates redirectChain when response is redirected', async() => {
            const svc = makeService();
            const resp = makeResponse({}, { redirected: true, url: 'https://cdn.example.com/file.zip' });
            const meta = await svc.extractSourceMetadata('https://example.com/file.zip', resp);
            expect(meta.redirectChain.length).toBeGreaterThan(0);
        });

        it('sets empty redirectChain when not redirected', async() => {
            const svc = makeService();
            const resp = makeResponse({}, { redirected: false });
            const meta = await svc.extractSourceMetadata('https://example.com/file', resp);
            expect(meta.redirectChain).toEqual([]);
        });
    });

    describe('extractFileMetadata', () => {
        it('extracts file name, extension, directory', async() => {
            const svc = makeService();
            const meta = await svc.extractFileMetadata('/downloads/report.pdf', makeResponse({}));
            expect(meta.name).toBe('report.pdf');
            expect(meta.extension).toBe('.pdf');
            expect(meta.mimeType).toBe('application/pdf');
        });

        it('reads content-length from response', async() => {
            const svc = makeService();
            const resp = makeResponse({ 'content-length': '2048' });
            const meta = await svc.extractFileMetadata('/downloads/file.bin', resp);
            expect(meta.size.expected).toBe(2048);
        });
    });

    describe('collectDownloadMetadata', () => {
        it('returns metadata object with required top-level keys', async() => {
            const svc = makeService({ enableIntegrityChecks: false });
            const meta = await svc.collectDownloadMetadata({
                url: 'https://example.com/file.zip',
                filePath: '/downloads/file.zip',
                response: makeResponse({ 'content-length': '1024' }),
                options: { sessionId: 'test-sess', requestId: 'test-req' },
            });
            expect(meta.url).toBe('https://example.com/file.zip');
            expect(meta.source).toBeDefined();
            expect(meta.file).toBeDefined();
            expect(meta.http).toBeDefined();
            expect(meta.download.sessionId).toBe('test-sess');
            expect(meta.integrity.method).toBeNull();
        });

        it('sets integrity.method to sha256 when enableIntegrityChecks=true', async() => {
            const svc = makeService({ enableIntegrityChecks: true });
            const meta = await svc.collectDownloadMetadata({
                url: 'https://example.com/file.zip',
                filePath: '/downloads/file.zip',
                response: null,
                options: {},
            });
            expect(meta.integrity.method).toBe('sha256');
        });
    });

    describe('generateAgentSummary', () => {
        it('produces essential fields for agent consumption', async() => {
            const svc = makeService();
            const meta = await svc.collectDownloadMetadata({
                url: 'https://example.com/data.csv',
                filePath: '/tmp/data.csv',
                response: makeResponse({}),
                options: { sessionId: 'sess-1' },
            });
            // Fake out the completion fields that finalizeMetadata would set
            meta.completion = { success: true, error: null, resumed: false, resumeFromByte: 0 };
            meta.file.size.actual = 5120;
            meta.performance.downloadDuration = 2000;
            meta.performance.megabytesPerSecond = 2.5;
            meta.performance.bytesPerSecond = 2621440;

            const summary = svc.generateAgentSummary(meta);
            expect(summary.url).toBe('https://example.com/data.csv');
            expect(summary.fileName).toBe('data.csv');
            expect(summary.fileSize.bytes).toBe(5120);
            expect(summary.duration.seconds).toBe(2);
            expect(summary.success).toBe(true);
        });
    });

    describe('finalizeMetadata (no integrity checks)', () => {
        it('updates performance metrics and completion', async() => {
            const svc = makeService({ enableIntegrityChecks: false });
            const meta = await svc.collectDownloadMetadata({
                url: 'https://example.com/file.zip',
                filePath: '/tmp/file.zip',
                response: makeResponse({}),
                options: {},
            });
            const result = await svc.finalizeMetadata(meta, {
                actualSize: 10240,
                success: true,
                error: null,
                resumed: false,
                resumeFromByte: 0,
            });
            expect(result.completion.success).toBe(true);
            expect(result.file.size.actual).toBe(10240);
            expect(result.performance.downloadDuration).toBeGreaterThanOrEqual(0);
            expect(result.summary).toBeDefined();
        });
    });
});
