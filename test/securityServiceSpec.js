'use strict';

const path = require('node:path');

const SecurityService = require('../lib/services/SecurityService');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLogger() {
    return { warn: () => {}, error: () => {}, info: () => {}, debug: () => {}, trace: () => {} };
}

function makeService(securityOverrides = {}) {
    return new SecurityService({
        config: { security: securityOverrides },
        logger: makeLogger(),
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SecurityService', () => {

    describe('constructor', () => {
        it('uses documented defaults when no security config provided', () => {
            const svc = new SecurityService({ config: {}, logger: makeLogger() });
            const cfg = svc.getSecurityConfig();
            expect(cfg.allowedProtocols).toContain('https');
            expect(cfg.maxFileSize).toBe(10 * 1024 * 1024 * 1024);
            // Default-allow: matches config/default.yaml and the Joi schema.
            // Operators opt in to blocking (secure profile / production config).
            expect(cfg.blockPrivateNetworks).toBe(false);
            expect(cfg.blockLocalhost).toBe(false);
            expect(cfg.sanitizeFilenames).toBe(true);
            expect(cfg.enablePathTraversalProtection).toBe(true);
        });

        it('defaults ipv6 policy to nothing-blocked, IPv4-mapped allowed', () => {
            const svc = new SecurityService({ config: {}, logger: makeLogger() });
            const cfg = svc.getSecurityConfig();
            expect(cfg.ipv6).toEqual({
                blockPrivateRanges: false,
                blockDocumentation: false,
                blockMulticast: false,
                allowIPv4Mapped: true,
                strictValidation: false,
            });
        });

        it('regression: blockPrivateNetworks default stays aligned with the Joi schema default (false)', () => {
            // Three places declare this default: the Joi schema
            // (ConfigManager), DownloadSession._buildSecurity, and this
            // constructor. They must all agree on false. See issue #148 follow-up.
            const svc = new SecurityService({ config: {}, logger: makeLogger() });
            const result = svc.validateUrl('https://192.168.1.10/file.zip');
            expect(result.errors.some(e => e.code === 'PRIVATE_NETWORK_ACCESS_DENIED')).toBe(false);
            const localhost = svc.validateUrl('https://localhost/file.zip');
            expect(localhost.errors.some(e => e.code === 'LOCAL_ACCESS_DENIED')).toBe(false);
        });

        it('accepts custom allowedProtocols', () => {
            const svc = makeService({ allowedProtocols: ['https'] });
            expect(svc.getSecurityConfig().allowedProtocols).toEqual(['https']);
        });

        it('respects blockPrivateNetworks=false', () => {
            const svc = makeService({ blockPrivateNetworks: false });
            expect(svc.getSecurityConfig().blockPrivateNetworks).toBe(false);
        });

        it('initializes empty rate limiter', () => {
            const svc = makeService();
            expect(svc.getRateLimitStats().totalClients).toBe(0);
        });
    });

    describe('validateUrl', () => {
        it('rejects null URL', () => {
            const svc = makeService();
            const result = svc.validateUrl(null);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'INVALID_URL')).toBe(true);
        });

        it('rejects undefined URL', () => {
            const svc = makeService();
            const result = svc.validateUrl(undefined);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'INVALID_URL')).toBe(true);
        });

        it('rejects non-string URL', () => {
            const svc = makeService();
            const result = svc.validateUrl(12345);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'INVALID_URL')).toBe(true);
        });

        it('rejects URL exceeding maxUrlLength', () => {
            const svc = makeService({ maxUrlLength: 30 });
            const result = svc.validateUrl('https://example.com/very-long-path-that-exceeds-limit.zip');
            expect(result.errors.some(e => e.code === 'URL_TOO_LONG')).toBe(true);
        });

        it('rejects disallowed protocol (ftp)', () => {
            const svc = makeService({ allowedProtocols: ['https'] });
            const result = svc.validateUrl('ftp://example.com/file.zip');
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'INVALID_PROTOCOL')).toBe(true);
        });

        it('rejects file:// protocol', () => {
            const svc = makeService({ allowedProtocols: ['https', 'http'] });
            const result = svc.validateUrl('file:///etc/passwd');
            expect(result.errors.some(e => e.code === 'INVALID_PROTOCOL')).toBe(true);
        });

        it('accepts valid https URL to public domain', () => {
            const svc = makeService({ blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateUrl('https://example.com/file.zip');
            expect(result.isValid).toBe(true);
        });

        it('rejects blocked domain', () => {
            const svc = makeService({ blockedDomains: ['evil.com'], blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateUrl('https://evil.com/malware.exe');
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'BLOCKED_DOMAIN')).toBe(true);
        });

        it('rejects subdomain of blocked domain', () => {
            const svc = makeService({ blockedDomains: ['evil.com'], blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateUrl('https://sub.evil.com/file');
            expect(result.errors.some(e => e.code === 'BLOCKED_DOMAIN')).toBe(true);
        });

        it('rejects domain not in allowedDomains whitelist', () => {
            const svc = makeService({ allowedDomains: ['good.com'], blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateUrl('https://other.com/file');
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'DOMAIN_NOT_ALLOWED')).toBe(true);
        });

        it('accepts domain in allowedDomains whitelist', () => {
            const svc = makeService({ allowedDomains: ['good.com'], blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateUrl('https://good.com/file');
            expect(result.isValid).toBe(true);
        });

        it('accepts subdomain of allowed domain', () => {
            const svc = makeService({ allowedDomains: ['good.com'], blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateUrl('https://cdn.good.com/file');
            expect(result.isValid).toBe(true);
        });

        it('rejects localhost when blockLocalhost=true', () => {
            const svc = makeService({ blockLocalhost: true });
            const result = svc.validateUrl('https://localhost/file');
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'LOCAL_ACCESS_DENIED')).toBe(true);
        });

        it('allows localhost when blockLocalhost=false', () => {
            const svc = makeService({ blockLocalhost: false, blockPrivateNetworks: false });
            const result = svc.validateUrl('https://localhost/file');
            expect(result.errors.some(e => e.code === 'LOCAL_ACCESS_DENIED')).toBe(false);
        });

        it('rejects private network IP when blockPrivateNetworks=true', () => {
            const svc = makeService({ blockPrivateNetworks: true, blockLocalhost: false });
            const result = svc.validateUrl('https://192.168.1.1/file');
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'PRIVATE_NETWORK_ACCESS_DENIED')).toBe(true);
        });

        it('rejects 10.x private IP', () => {
            const svc = makeService({ blockPrivateNetworks: true, blockLocalhost: false });
            const result = svc.validateUrl('https://10.0.0.1/internal');
            expect(result.errors.some(e => e.code === 'PRIVATE_NETWORK_ACCESS_DENIED')).toBe(true);
        });

        it('warns about HTTP for public domain', () => {
            const svc = makeService({ blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateUrl('http://example.com/file');
            expect(result.warnings.some(w => w.code === 'INSECURE_PROTOCOL')).toBe(true);
            expect(result.isValid).toBe(true);
        });

        it('does not warn INSECURE_PROTOCOL for HTTPS', () => {
            const svc = makeService({ blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateUrl('https://example.com/file');
            expect(result.warnings.some(w => w.code === 'INSECURE_PROTOCOL')).toBe(false);
        });

        it('rejects URL with .. path traversal pattern', () => {
            const svc = makeService({ blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateUrl('https://example.com/../../etc/passwd');
            expect(result.errors.some(e => e.code === 'SUSPICIOUS_URL_PATTERN')).toBe(true);
        });

        it('rejects URL with %2e%2e (encoded path traversal)', () => {
            const svc = makeService({ blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateUrl('https://example.com/%2e%2e/etc');
            expect(result.errors.some(e => e.code === 'SUSPICIOUS_URL_PATTERN')).toBe(true);
        });

        it('rejects URL with null byte injection (%00)', () => {
            const svc = makeService({ blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateUrl('https://example.com/file%00.txt');
            expect(result.errors.some(e => e.code === 'SUSPICIOUS_URL_PATTERN')).toBe(true);
        });

        it('rejects malformed (non-parseable) URL', () => {
            const svc = makeService();
            const result = svc.validateUrl('not-a-valid-url-at-all');
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'MALFORMED_URL')).toBe(true);
        });

        it('returns warnings array even when valid', () => {
            const svc = makeService({ blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateUrl('https://example.com/file');
            expect(Array.isArray(result.warnings)).toBe(true);
        });
    });

    describe('IPv6 policy (security.ipv6)', () => {
        function makeIPv6Service(ipv6Overrides = {}) {
            return makeService({ ipv6: ipv6Overrides });
        }

        describe('defaults (no policy enabled)', () => {
            it('allows IPv6 private-range URLs by default', () => {
                const result = makeIPv6Service().validateUrl('http://[fd00::1]/file');
                expect(result.errors.some(e => e.code === 'IPV6_PRIVATE_RANGE_BLOCKED')).toBe(false);
            });

            it('allows documentation-range URLs by default', () => {
                const result = makeIPv6Service().validateUrl('http://[2001:db8::1]/file');
                expect(result.errors.some(e => e.code === 'IPV6_DOCUMENTATION_RANGE_BLOCKED')).toBe(false);
            });

            it('allows multicast URLs by default', () => {
                const result = makeIPv6Service().validateUrl('http://[ff02::1]/file');
                expect(result.errors.some(e => e.code === 'IPV6_MULTICAST_BLOCKED')).toBe(false);
            });

            it('allows IPv4-mapped addresses by default', () => {
                const result = makeIPv6Service().validateUrl('http://[::ffff:8.8.8.8]/file');
                expect(result.errors.some(e => e.code === 'IPV6_IPV4_MAPPED_BLOCKED')).toBe(false);
            });
        });

        describe('blockPrivateRanges', () => {
            it('rejects unique-local addresses (fd00::/8)', () => {
                const result = makeIPv6Service({ blockPrivateRanges: true }).validateUrl('http://[fd00::1]/file');
                expect(result.isValid).toBe(false);
                expect(result.errors.some(e => e.code === 'IPV6_PRIVATE_RANGE_BLOCKED')).toBe(true);
            });

            it('rejects unique-local addresses (fc00::/8)', () => {
                const result = makeIPv6Service({ blockPrivateRanges: true }).validateUrl('http://[fc00::1]/file');
                expect(result.errors.some(e => e.code === 'IPV6_PRIVATE_RANGE_BLOCKED')).toBe(true);
            });

            it('rejects link-local addresses (fe80::/10)', () => {
                const result = makeIPv6Service({ blockPrivateRanges: true }).validateUrl('http://[fe80::1]/file');
                expect(result.errors.some(e => e.code === 'IPV6_PRIVATE_RANGE_BLOCKED')).toBe(true);
            });

            it('rejects the IPv6 loopback (::1)', () => {
                const result = makeIPv6Service({ blockPrivateRanges: true }).validateUrl('http://[::1]:8080/file');
                expect(result.errors.some(e => e.code === 'IPV6_PRIVATE_RANGE_BLOCKED')).toBe(true);
            });

            it('does not reject global unicast addresses', () => {
                const result = makeIPv6Service({ blockPrivateRanges: true }).validateUrl('http://[2606:4700::1111]/file');
                expect(result.errors.some(e => e.code === 'IPV6_PRIVATE_RANGE_BLOCKED')).toBe(false);
            });

            it('does not affect IPv4 or hostname URLs', () => {
                const svc = makeIPv6Service({ blockPrivateRanges: true });
                expect(svc.validateUrl('https://example.com/file').errors.some(e => e.code.startsWith('IPV6_'))).toBe(false);
                expect(svc.validateUrl('https://8.8.8.8/file').errors.some(e => e.code.startsWith('IPV6_'))).toBe(false);
            });
        });

        describe('blockDocumentation', () => {
            it('rejects 2001:db8::/32 addresses', () => {
                const result = makeIPv6Service({ blockDocumentation: true }).validateUrl('http://[2001:db8::1]/file');
                expect(result.isValid).toBe(false);
                expect(result.errors.some(e => e.code === 'IPV6_DOCUMENTATION_RANGE_BLOCKED')).toBe(true);
            });

            it('does not reject non-documentation 2001:: addresses', () => {
                const result = makeIPv6Service({ blockDocumentation: true }).validateUrl('http://[2001:4860:4860::8888]/file');
                expect(result.errors.some(e => e.code === 'IPV6_DOCUMENTATION_RANGE_BLOCKED')).toBe(false);
            });
        });

        describe('blockMulticast', () => {
            it('rejects ff00::/8 addresses', () => {
                const result = makeIPv6Service({ blockMulticast: true }).validateUrl('http://[ff02::1]/file');
                expect(result.isValid).toBe(false);
                expect(result.errors.some(e => e.code === 'IPV6_MULTICAST_BLOCKED')).toBe(true);
            });

            it('does not reject unicast addresses', () => {
                const result = makeIPv6Service({ blockMulticast: true }).validateUrl('http://[2606:4700::1111]/file');
                expect(result.errors.some(e => e.code === 'IPV6_MULTICAST_BLOCKED')).toBe(false);
            });
        });

        describe('allowIPv4Mapped', () => {
            it('rejects IPv4-mapped addresses when allowIPv4Mapped=false', () => {
                const result = makeIPv6Service({ allowIPv4Mapped: false }).validateUrl('http://[::ffff:8.8.8.8]/file');
                expect(result.isValid).toBe(false);
                expect(result.errors.some(e => e.code === 'IPV6_IPV4_MAPPED_BLOCKED')).toBe(true);
            });

            it('allows plain IPv6 addresses when allowIPv4Mapped=false', () => {
                const result = makeIPv6Service({ allowIPv4Mapped: false }).validateUrl('http://[2606:4700::1111]/file');
                expect(result.errors.some(e => e.code === 'IPV6_IPV4_MAPPED_BLOCKED')).toBe(false);
            });
        });

        describe('strictValidation', () => {
            // WHATWG URL parsing rejects malformed bracketed hosts before the
            // policy check runs, so the strict check is exercised directly as
            // defense-in-depth for host strings from other sources.
            it('flags a bracketed host that is not a valid IPv6 address', () => {
                const svc = makeIPv6Service({ strictValidation: true });
                const errors = svc.checkIPv6Policies('[not-an-address]');
                expect(errors.some(e => e.code === 'IPV6_STRICT_VALIDATION_FAILED')).toBe(true);
            });

            it('does not flag invalid bracketed hosts when strictValidation=false', () => {
                const svc = makeIPv6Service({ strictValidation: false });
                const errors = svc.checkIPv6Policies('[not-an-address]');
                expect(errors.length).toBe(0);
            });

            it('does not flag valid IPv6 literals', () => {
                const svc = makeIPv6Service({ strictValidation: true });
                expect(svc.checkIPv6Policies('[::1]').length).toBe(0);
                expect(svc.checkIPv6Policies('2001:db8::1').length).toBe(0);
            });
        });

        describe('policy pass-through from session config shape', () => {
            it('honours policy provided under config.security.ipv6', () => {
                const svc = new SecurityService({
                    config: { security: { ipv6: { blockPrivateRanges: true } } },
                    logger: makeLogger(),
                });
                const result = svc.validateUrl('http://[fe80::1]/file');
                expect(result.isValid).toBe(false);
                expect(result.errors.some(e => e.code === 'IPV6_PRIVATE_RANGE_BLOCKED')).toBe(true);
            });
        });
    });

    describe('validateDestinationPath', () => {
        it('rejects null path', () => {
            const svc = makeService();
            const result = svc.validateDestinationPath(null);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'INVALID_PATH')).toBe(true);
        });

        it('rejects non-string path', () => {
            const svc = makeService();
            const result = svc.validateDestinationPath(42);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'INVALID_PATH')).toBe(true);
        });

        it('rejects path exceeding maxPathLength', () => {
            const svc = makeService({ maxPathLength: 10 });
            const result = svc.validateDestinationPath('this-is-a-very-long-path.txt');
            expect(result.errors.some(e => e.code === 'PATH_TOO_LONG')).toBe(true);
        });

        it('detects path traversal with .. segments', () => {
            const svc = makeService();
            const result = svc.validateDestinationPath('../../../etc/passwd');
            expect(result.isValid).toBe(false);
            const codes = result.errors.map(e => e.code);
            expect(codes.some(c => c === 'PATH_TRAVERSAL_ATTEMPT' || c === 'DANGEROUS_PATH_PATTERN')).toBe(true);
        });

        it('detects null byte injection in path', () => {
            const svc = makeService();
            const result = svc.validateDestinationPath('file\x00.txt');
            expect(result.errors.some(e => e.code === 'DANGEROUS_PATH_PATTERN')).toBe(true);
        });

        it('detects URL-encoded path traversal (%2e%2e)', () => {
            const svc = makeService();
            const result = svc.validateDestinationPath('dir/%2e%2e/secret');
            expect(result.errors.some(e => e.code === 'DANGEROUS_PATH_PATTERN')).toBe(true);
        });

        it('warns about absolute paths', () => {
            const svc = makeService();
            const absPath = path.join(process.cwd(), 'safe-file.txt');
            const result = svc.validateDestinationPath(absPath);
            expect(result.warnings.some(w => w.code === 'ABSOLUTE_PATH_WARNING')).toBe(true);
        });

        it('warns when parent directory does not exist', () => {
            const svc = makeService();
            const absPath = path.join(process.cwd(), 'nonexistent-dir-xyz-abc', 'file.txt');
            const result = svc.validateDestinationPath(absPath);
            expect(result.warnings.some(w => w.code === 'PARENT_DIRECTORY_MISSING')).toBe(true);
        });

        it('does not flag traversal for cwd-rooted absolute path', () => {
            const svc = makeService();
            const absPath = path.join(process.cwd(), 'safe-download.txt');
            const result = svc.validateDestinationPath(absPath);
            expect(result.errors.some(e => e.code === 'PATH_TRAVERSAL_ATTEMPT')).toBe(false);
        });

        it('skips traversal checks when enablePathTraversalProtection=false', () => {
            const svc = makeService({ enablePathTraversalProtection: false });
            const result = svc.validateDestinationPath('../etc/passwd');
            expect(result.errors.some(e => e.code === 'PATH_TRAVERSAL_ATTEMPT')).toBe(false);
            expect(result.errors.some(e => e.code === 'DANGEROUS_PATH_PATTERN')).toBe(false);
        });
    });

    describe('validateHeaders', () => {
        it('rejects null headers', () => {
            const svc = makeService();
            const result = svc.validateHeaders(null);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'INVALID_HEADERS')).toBe(true);
        });

        it('rejects string (non-object) headers', () => {
            const svc = makeService();
            const result = svc.validateHeaders('not-an-object');
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'INVALID_HEADERS')).toBe(true);
        });

        it('accepts clean, safe headers', () => {
            const svc = makeService();
            const result = svc.validateHeaders({ 'Content-Type': 'application/json', 'Accept': 'text/html' });
            expect(result.isValid).toBe(true);
            expect(result.errors.length).toBe(0);
        });

        it('warns about Authorization header', () => {
            const svc = makeService();
            const result = svc.validateHeaders({ 'Authorization': 'Bearer token123' });
            expect(result.warnings.some(w => w.code === 'POTENTIALLY_DANGEROUS_HEADER')).toBe(true);
        });

        it('warns about Cookie header', () => {
            const svc = makeService();
            const result = svc.validateHeaders({ 'Cookie': 'session=abc' });
            expect(result.warnings.some(w => w.code === 'POTENTIALLY_DANGEROUS_HEADER')).toBe(true);
        });

        it('warns about X-Forwarded-For header', () => {
            const svc = makeService();
            const result = svc.validateHeaders({ 'X-Forwarded-For': '1.2.3.4' });
            expect(result.warnings.some(w => w.code === 'POTENTIALLY_DANGEROUS_HEADER')).toBe(true);
        });

        it('detects header injection via \\r\\n in value', () => {
            const svc = makeService();
            const result = svc.validateHeaders({ 'X-Custom': 'value\r\nX-Injected: evil' });
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'HEADER_INJECTION_ATTEMPT')).toBe(true);
        });

        it('detects header injection via \\r\\n in key', () => {
            const svc = makeService();
            const result = svc.validateHeaders({ 'X-Bad\r\nKey': 'value' });
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'HEADER_INJECTION_ATTEMPT')).toBe(true);
        });

        it('rejects header value exceeding 8 KB', () => {
            const svc = makeService();
            const result = svc.validateHeaders({ 'X-Big': 'x'.repeat(8193) });
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'HEADER_VALUE_TOO_LONG')).toBe(true);
        });

        it('rejects non-string header value', () => {
            const svc = makeService();
            const result = svc.validateHeaders({ 'Content-Length': 1024 });
            expect(result.errors.some(e => e.code === 'INVALID_HEADER_FORMAT')).toBe(true);
        });
    });

    describe('checkRateLimit', () => {
        it('allows the first request and records it', () => {
            const svc = makeService();
            const result = svc.checkRateLimit('1.2.3.4');
            expect(result.isValid).toBe(true);
            expect(result.requestCount).toBe(1);
        });

        it('increments count on subsequent requests from same IP', () => {
            const svc = makeService();
            svc.checkRateLimit('1.2.3.4');
            const result = svc.checkRateLimit('1.2.3.4');
            expect(result.requestCount).toBe(2);
        });

        it('blocks when rate limit is exceeded', () => {
            const svc = makeService({ rateLimitRequests: 2 });
            svc.checkRateLimit('5.6.7.8');
            svc.checkRateLimit('5.6.7.8');
            const result = svc.checkRateLimit('5.6.7.8');
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'RATE_LIMIT_EXCEEDED')).toBe(true);
        });

        it('tracks different IPs independently', () => {
            const svc = makeService({ rateLimitRequests: 1 });
            svc.checkRateLimit('1.1.1.1');
            const result = svc.checkRateLimit('2.2.2.2');
            expect(result.isValid).toBe(true);
        });

        it('includes resetTime in result', () => {
            const svc = makeService();
            const before = Date.now();
            const result = svc.checkRateLimit('9.9.9.9');
            expect(result.resetTime).toBeGreaterThanOrEqual(before);
        });
    });

    describe('validateFileSize', () => {
        it('does not throw when size is within limit', () => {
            const svc = makeService({ maxFileSize: 1000 });
            expect(() => svc.validateFileSize(500, 'https://example.com/file')).not.toThrow();
        });

        it('does not throw when size equals limit', () => {
            const svc = makeService({ maxFileSize: 1000 });
            expect(() => svc.validateFileSize(1000, 'https://example.com/file')).not.toThrow();
        });

        it('throws when file size exceeds limit', () => {
            const svc = makeService({ maxFileSize: 1000 });
            expect(() => svc.validateFileSize(2000, 'https://example.com/big.zip')).toThrow();
        });

        it('thrown error message mentions the size', () => {
            const svc = makeService({ maxFileSize: 100 });
            try {
                svc.validateFileSize(200, 'https://example.com/big.zip');
                throw new Error('should have thrown');
            } catch (err) {
                expect(err.message).toContain('200');
            }
        });
    });

    describe('sanitizeRequest', () => {
        it('returns a shallow copy of the request', () => {
            const svc = makeService();
            const req = { url: 'https://example.com/file' };
            const result = svc.sanitizeRequest(req);
            expect(result).not.toBe(req);
            expect(result.url).toBe(req.url);
        });

        it('sanitizes destination when present', () => {
            const svc = makeService();
            const req = { url: 'https://example.com/file', destination: 'safe.txt' };
            const result = svc.sanitizeRequest(req);
            expect(result.destination).toBeDefined();
        });

        it('removes headers with \\r\\n injection characters', () => {
            const svc = makeService();
            const req = {
                url: 'https://example.com/file',
                headers: {
                    'Good-Header': 'clean-value',
                    'Bad\r\nHeader': 'evil',
                },
            };
            const result = svc.sanitizeRequest(req);
            expect(result.headers['Good-Header']).toBe('clean-value');
            expect(Object.keys(result.headers)).not.toContain('Bad\r\nHeader');
        });

        it('passes through request without destination or headers unchanged', () => {
            const svc = makeService();
            const req = { url: 'https://example.com/file', method: 'GET' };
            const result = svc.sanitizeRequest(req);
            expect(result.method).toBe('GET');
        });
    });

    describe('sanitizePath', () => {
        it('returns falsy input unchanged', () => {
            const svc = makeService();
            expect(svc.sanitizePath('')).toBe('');
            expect(svc.sanitizePath(null)).toBeNull();
        });

        it('resolves relative path to absolute within cwd', () => {
            const svc = makeService();
            const result = svc.sanitizePath('subdir/file.txt');
            expect(path.isAbsolute(result)).toBe(true);
            expect(result.startsWith(process.cwd())).toBe(true);
        });

        it('prevents path traversal above cwd', () => {
            const svc = makeService();
            const result = svc.sanitizePath('../../../../etc/passwd');
            expect(result.startsWith(process.cwd())).toBe(true);
        });

        it('keeps cwd-rooted absolute path unchanged', () => {
            const svc = makeService();
            const safePath = path.join(process.cwd(), 'safe.txt');
            expect(svc.sanitizePath(safePath)).toBe(safePath);
        });
    });

    describe('sanitizeFilename', () => {
        it('returns falsy input unchanged', () => {
            const svc = makeService();
            expect(svc.sanitizeFilename('')).toBe('');
            expect(svc.sanitizeFilename(null)).toBeNull();
        });

        it('replaces dangerous characters with underscore', () => {
            const svc = makeService();
            const result = path.basename(svc.sanitizeFilename('evil<file>:name.txt'));
            expect(result).not.toContain('<');
            expect(result).not.toContain('>');
            expect(result).not.toContain(':');
        });

        it('replaces leading dots', () => {
            const svc = makeService();
            const result = path.basename(svc.sanitizeFilename('...hidden-file'));
            expect(result.charAt(0)).not.toBe('.');
        });

        it('replaces spaces with underscores', () => {
            const svc = makeService();
            const result = path.basename(svc.sanitizeFilename('my file name.txt'));
            expect(result).not.toContain(' ');
        });

        it('truncates basename to 255 characters', () => {
            const svc = makeService();
            const longName = 'a'.repeat(300) + '.txt';
            const result = path.basename(svc.sanitizeFilename(longName));
            expect(result.length).toBeLessThanOrEqual(255);
        });

        it('preserves directory component', () => {
            const svc = makeService();
            const result = svc.sanitizeFilename('/some/dir/my file.txt');
            expect(result).toContain(path.sep + 'some' + path.sep + 'dir');
        });
    });

    describe('isPrivateNetwork', () => {
        it('identifies 10.x.x.x as private', () => {
            expect(makeService().isPrivateNetwork('10.0.0.1')).toBe(true);
        });

        it('identifies 172.16.x.x as private', () => {
            expect(makeService().isPrivateNetwork('172.16.0.1')).toBe(true);
        });

        it('identifies 172.31.x.x as private', () => {
            expect(makeService().isPrivateNetwork('172.31.255.255')).toBe(true);
        });

        it('does NOT flag 172.15.x.x as private', () => {
            expect(makeService().isPrivateNetwork('172.15.0.1')).toBe(false);
        });

        it('identifies 192.168.x.x as private', () => {
            expect(makeService().isPrivateNetwork('192.168.1.1')).toBe(true);
        });

        it('identifies 169.254.x.x as private (link-local)', () => {
            expect(makeService().isPrivateNetwork('169.254.1.1')).toBe(true);
        });

        it('identifies 127.0.0.1 as private', () => {
            expect(makeService().isPrivateNetwork('127.0.0.1')).toBe(true);
        });

        it('identifies ::1 as private (IPv6 loopback)', () => {
            expect(makeService().isPrivateNetwork('::1')).toBe(true);
        });

        it('identifies fe80:: as private (IPv6 link-local)', () => {
            expect(makeService().isPrivateNetwork('fe80::1')).toBe(true);
        });

        it('identifies fc00:: as private (IPv6 unique local)', () => {
            expect(makeService().isPrivateNetwork('fc00::1')).toBe(true);
        });

        it('identifies fd00:: as private (IPv6 unique local)', () => {
            expect(makeService().isPrivateNetwork('fd00::1')).toBe(true);
        });

        it('identifies ::ffff: prefix as private (IPv4-mapped IPv6)', () => {
            expect(makeService().isPrivateNetwork('::ffff:192.168.1.1')).toBe(true);
        });

        it('does NOT flag 8.8.8.8 as private', () => {
            expect(makeService().isPrivateNetwork('8.8.8.8')).toBe(false);
        });

        it('does NOT flag 1.1.1.1 as private', () => {
            expect(makeService().isPrivateNetwork('1.1.1.1')).toBe(false);
        });

        it('does NOT flag example.com as private', () => {
            expect(makeService().isPrivateNetwork('example.com')).toBe(false);
        });
    });

    describe('isLocalhost', () => {
        it('identifies 127.0.0.1', () => {
            expect(makeService().isLocalhost('127.0.0.1')).toBe(true);
        });

        it('identifies "localhost"', () => {
            expect(makeService().isLocalhost('localhost')).toBe(true);
        });

        it('identifies ::1 (IPv6 loopback)', () => {
            expect(makeService().isLocalhost('::1')).toBe(true);
        });

        it('identifies localhost.localdomain', () => {
            expect(makeService().isLocalhost('localhost.localdomain')).toBe(true);
        });

        it('identifies ip6-localhost', () => {
            expect(makeService().isLocalhost('ip6-localhost')).toBe(true);
        });

        it('does NOT identify example.com as localhost', () => {
            expect(makeService().isLocalhost('example.com')).toBe(false);
        });

        it('does NOT identify 192.168.1.1 as localhost', () => {
            expect(makeService().isLocalhost('192.168.1.1')).toBe(false);
        });
    });

    describe('getSecurityConfig', () => {
        it('returns the security config object', () => {
            const svc = makeService();
            const cfg = svc.getSecurityConfig();
            expect(cfg).toBeDefined();
            expect(cfg.allowedProtocols).toBeDefined();
            expect(cfg.maxFileSize).toBeDefined();
        });

        it('returns a copy — mutations do not affect instance', () => {
            const svc = makeService();
            const cfg = svc.getSecurityConfig();
            cfg.allowedProtocols = [];
            expect(svc.getSecurityConfig().allowedProtocols.length).toBeGreaterThan(0);
        });
    });

    describe('getRateLimitStats', () => {
        it('returns zero stats when no requests recorded', () => {
            const svc = makeService();
            const stats = svc.getRateLimitStats();
            expect(stats.totalClients).toBe(0);
            expect(stats.activeRequests).toBe(0);
            expect(stats.limitPerMinute).toBeGreaterThan(0);
        });

        it('counts active requests across multiple clients', () => {
            const svc = makeService();
            svc.checkRateLimit('a.b.c.d');
            svc.checkRateLimit('a.b.c.d');
            svc.checkRateLimit('e.f.g.h');
            const stats = svc.getRateLimitStats();
            expect(stats.totalClients).toBe(2);
            expect(stats.activeRequests).toBe(3);
        });
    });

    describe('validateDownloadRequest', () => {
        it('accepts a clean request with valid URL', () => {
            const svc = makeService({ blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateDownloadRequest({ url: 'https://example.com/file.zip' });
            expect(result.isValid).toBe(true);
            expect(result.sanitizedRequest).toBeDefined();
        });

        it('propagates URL validation errors', () => {
            const svc = makeService();
            const result = svc.validateDownloadRequest({ url: 'not-a-url' });
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'MALFORMED_URL')).toBe(true);
        });

        it('propagates destination path errors', () => {
            const svc = makeService({ blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateDownloadRequest({
                url: 'https://example.com/file',
                destination: '../../../etc/passwd',
            });
            expect(result.isValid).toBe(false);
        });

        it('validates headers when provided', () => {
            const svc = makeService({ blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateDownloadRequest({
                url: 'https://example.com/file',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(result.isValid).toBe(true);
        });

        it('rejects request with header injection', () => {
            const svc = makeService({ blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateDownloadRequest({
                url: 'https://example.com/file',
                headers: { 'X-Header': 'value\r\nevil: payload' },
            });
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'HEADER_INJECTION_ATTEMPT')).toBe(true);
        });

        it('applies rate limiting when clientIp is provided', () => {
            const svc = makeService({ rateLimitRequests: 1, blockPrivateNetworks: false, blockLocalhost: false });
            svc.validateDownloadRequest({ url: 'https://example.com/file', clientIp: '3.3.3.3' });
            const result = svc.validateDownloadRequest({ url: 'https://example.com/file', clientIp: '3.3.3.3' });
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.code === 'RATE_LIMIT_EXCEEDED')).toBe(true);
        });

        it('skips rate limiting when no clientIp provided', () => {
            const svc = makeService({ blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateDownloadRequest({ url: 'https://example.com/file' });
            expect(result.errors.some(e => e.code === 'RATE_LIMIT_EXCEEDED')).toBe(false);
        });

        it('returns warnings array in result', () => {
            const svc = makeService({ blockPrivateNetworks: false, blockLocalhost: false });
            const result = svc.validateDownloadRequest({ url: 'https://example.com/file' });
            expect(Array.isArray(result.warnings)).toBe(true);
        });

        it('handles null/undefined URL gracefully', () => {
            const svc = makeService();
            const result = svc.validateDownloadRequest({ url: undefined });
            expect(result.isValid).toBe(false);
        });
    });
});
