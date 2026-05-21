'use strict';

const { DownloadError } = require('../lib/errors/DownloadError');

describe('DownloadError', () => {
    describe('constructor', () => {
        it('sets name, code, message, and details', () => {
            const err = new DownloadError('HTTP_404', 'not found', { url: 'https://x.com/f' });
            expect(err.name).toBe('DownloadError');
            expect(err.code).toBe('HTTP_404');
            expect(err.message).toBe('not found');
            expect(err.details.url).toBe('https://x.com/f');
        });

        it('is an instance of Error', () => {
            expect(new DownloadError('X', 'msg')).toBeInstanceOf(Error);
        });

        it('sets timestamp as ISO string', () => {
            const err = new DownloadError('X', 'msg');
            expect(() => new Date(err.timestamp)).not.toThrow();
        });

        it('uses provided userMessage over generated one', () => {
            const err = new DownloadError('HTTP_404', 'msg', {}, 'Custom message');
            expect(err.userMessage).toBe('Custom message');
        });

        it('falls back to generated userMessage when not provided', () => {
            const err = new DownloadError('HTTP_404', 'msg');
            expect(err.userMessage).toBe('The requested file was not found on the server (404 error).');
        });

        it('falls back to generic userMessage for unknown code', () => {
            const err = new DownloadError('UNKNOWN_CODE', 'msg');
            expect(err.userMessage).toMatch(/unexpected error/i);
        });

        it('stores correlationId from details', () => {
            const err = new DownloadError('X', 'msg', { correlationId: 'abc-123' });
            expect(err.correlationId).toBe('abc-123');
        });

        it('sets correlationId to null when not in details', () => {
            const err = new DownloadError('X', 'msg');
            expect(err.correlationId).toBeNull();
        });
    });

    describe('determineSeverity', () => {
        it('returns critical for SYSTEM_ERROR', () => {
            expect(new DownloadError('SYSTEM_ERROR', 'msg').severity).toBe('critical');
        });

        it('returns critical for SECURITY_VIOLATION', () => {
            expect(new DownloadError('SECURITY_VIOLATION', 'msg').severity).toBe('critical');
        });

        it('returns high for AUTHENTICATION_FAILED', () => {
            expect(new DownloadError('AUTHENTICATION_FAILED', 'msg').severity).toBe('high');
        });

        it('returns high for CHECKSUM_MISMATCH', () => {
            expect(new DownloadError('CHECKSUM_MISMATCH', 'msg').severity).toBe('high');
        });

        it('returns medium for NETWORK_TIMEOUT', () => {
            expect(new DownloadError('NETWORK_TIMEOUT', 'msg').severity).toBe('medium');
        });

        it('returns medium for HTTP_404', () => {
            expect(new DownloadError('HTTP_404', 'msg').severity).toBe('medium');
        });

        it('returns low for unknown code', () => {
            expect(new DownloadError('SOME_RANDOM_CODE', 'msg').severity).toBe('low');
        });
    });

    describe('determineCategory', () => {
        it('returns network for NETWORK_ prefix', () => {
            expect(new DownloadError('NETWORK_TIMEOUT', 'msg').category).toBe('network');
        });

        it('returns network for DNS_ prefix', () => {
            expect(new DownloadError('DNS_RESOLUTION_FAILED', 'msg').category).toBe('network');
        });

        it('returns network for CONNECTION_ prefix', () => {
            expect(new DownloadError('CONNECTION_REFUSED', 'msg').category).toBe('network');
        });

        it('returns http for HTTP_ prefix', () => {
            expect(new DownloadError('HTTP_500', 'msg').category).toBe('http');
        });

        it('returns sftp for SFTP_ prefix', () => {
            expect(new DownloadError('SFTP_AUTH_FAILED', 'msg').category).toBe('sftp');
        });

        it('returns sftp for SSH_ prefix', () => {
            expect(new DownloadError('SSH_CONNECTION_FAILED', 'msg').category).toBe('sftp');
        });

        it('returns authentication for AUTH codes', () => {
            expect(new DownloadError('AUTHENTICATION_FAILED', 'msg').category).toBe('authentication');
        });

        it('returns filesystem for FILE codes', () => {
            expect(new DownloadError('FILE_TOO_LARGE', 'msg').category).toBe('filesystem');
        });

        it('returns validation for INVALID codes', () => {
            expect(new DownloadError('INVALID_URL', 'msg').category).toBe('validation');
        });

        it('returns resume for RESUME codes', () => {
            expect(new DownloadError('RESUME_FAILED', 'msg').category).toBe('resume');
        });

        it('returns integrity for CHECKSUM codes', () => {
            expect(new DownloadError('CHECKSUM_MISMATCH', 'msg').category).toBe('integrity');
        });

        it('returns concurrency for RATE codes', () => {
            expect(new DownloadError('RATE_LIMITED', 'msg').category).toBe('concurrency');
        });

        it('returns general for unrecognized code', () => {
            expect(new DownloadError('FOO_BAR', 'msg').category).toBe('general');
        });
    });

    describe('determineRetryability', () => {
        it('marks NETWORK_TIMEOUT as retryable', () => {
            expect(new DownloadError('NETWORK_TIMEOUT', 'msg').isRetryable).toBe(true);
        });

        it('marks HTTP_500 as retryable', () => {
            expect(new DownloadError('HTTP_500', 'msg').isRetryable).toBe(true);
        });

        it('marks INVALID_URL as not retryable', () => {
            expect(new DownloadError('INVALID_URL', 'msg').isRetryable).toBe(false);
        });

        it('marks HTTP_404 as not retryable', () => {
            expect(new DownloadError('HTTP_404', 'msg').isRetryable).toBe(false);
        });

        it('marks AUTHENTICATION_FAILED as not retryable', () => {
            expect(new DownloadError('AUTHENTICATION_FAILED', 'msg').isRetryable).toBe(false);
        });

        it('marks CHECKSUM_MISMATCH as not retryable', () => {
            expect(new DownloadError('CHECKSUM_MISMATCH', 'msg').isRetryable).toBe(false);
        });
    });

    describe('generateRecoveryActions', () => {
        it('returns retry actions for NETWORK_TIMEOUT', () => {
            const err = new DownloadError('NETWORK_TIMEOUT', 'msg');
            const actions = err.recoveryActions.map(a => a.action);
            expect(actions).toContain('retry_with_delay');
            expect(actions).toContain('increase_timeout');
        });

        it('returns backoff actions for HTTP_429', () => {
            const err = new DownloadError('HTTP_429', 'msg');
            const actions = err.recoveryActions.map(a => a.action);
            expect(actions).toContain('retry_with_backoff');
            expect(actions).toContain('reduce_concurrency');
        });

        it('returns space actions for INSUFFICIENT_SPACE', () => {
            const err = new DownloadError('INSUFFICIENT_SPACE', 'msg');
            const actions = err.recoveryActions.map(a => a.action);
            expect(actions).toContain('check_disk_space');
        });

        it('returns restart for RESUME_FAILED', () => {
            const err = new DownloadError('RESUME_FAILED', 'msg');
            const actions = err.recoveryActions.map(a => a.action);
            expect(actions).toContain('delete_partial_file');
            expect(actions).toContain('restart_download');
        });

        it('returns delete for CHECKSUM_MISMATCH', () => {
            const err = new DownloadError('CHECKSUM_MISMATCH', 'msg');
            const actions = err.recoveryActions.map(a => a.action);
            expect(actions).toContain('delete_corrupted_file');
        });

        it('returns check_logs for non-retryable unknown code', () => {
            const err = new DownloadError('INVALID_URL', 'msg');
            const actions = err.recoveryActions.map(a => a.action);
            expect(actions).toContain('check_logs');
        });

        it('returns retry_download for retryable unknown code', () => {
            const err = new DownloadError('SOME_RETRYABLE', 'msg');
            const actions = err.recoveryActions.map(a => a.action);
            expect(actions).toContain('retry_download');
        });
    });

    describe('static factories', () => {
        describe('networkError', () => {
            it('maps ETIMEDOUT to NETWORK_TIMEOUT', () => {
                const err = DownloadError.networkError('ETIMEDOUT occurred', 'https://x.com');
                expect(err.code).toBe('NETWORK_TIMEOUT');
            });

            it('maps ENOTFOUND to DNS_RESOLUTION_FAILED', () => {
                const err = DownloadError.networkError('getaddrinfo ENOTFOUND x.com', 'https://x.com');
                expect(err.code).toBe('DNS_RESOLUTION_FAILED');
            });

            it('maps ECONNREFUSED to CONNECTION_REFUSED', () => {
                const err = DownloadError.networkError('ECONNREFUSED 127.0.0.1:80', 'https://x.com');
                expect(err.code).toBe('CONNECTION_REFUSED');
            });

            it('maps ECONNRESET to NETWORK_UNREACHABLE', () => {
                const err = DownloadError.networkError('ECONNRESET', 'https://x.com');
                expect(err.code).toBe('NETWORK_UNREACHABLE');
            });

            it('defaults to NETWORK_ERROR for unknown message', () => {
                const err = DownloadError.networkError('something weird', 'https://x.com');
                expect(err.code).toBe('NETWORK_ERROR');
            });

            it('stores url in details', () => {
                const err = DownloadError.networkError('timeout', 'https://x.com/f');
                expect(err.details.url).toBe('https://x.com/f');
            });
        });

        describe('httpError', () => {
            it('sets code to HTTP_<statusCode>', () => {
                const err = DownloadError.httpError(404, 'Not Found', 'https://x.com');
                expect(err.code).toBe('HTTP_404');
            });

            it('stores statusCode and statusText in details', () => {
                const err = DownloadError.httpError(503, 'Service Unavailable', 'https://x.com');
                expect(err.details.statusCode).toBe(503);
                expect(err.details.statusText).toBe('Service Unavailable');
            });
        });

        describe('fileSystemError', () => {
            it('maps ENOSPC to INSUFFICIENT_SPACE', () => {
                const err = DownloadError.fileSystemError('write', '/tmp/f', 'ENOSPC: no space');
                expect(err.code).toBe('INSUFFICIENT_SPACE');
            });

            it('maps EACCES to PERMISSION_DENIED', () => {
                const err = DownloadError.fileSystemError('open', '/etc/f', 'EACCES denied');
                expect(err.code).toBe('PERMISSION_DENIED');
            });

            it('maps ENOENT to PATH_NOT_FOUND', () => {
                const err = DownloadError.fileSystemError('stat', '/missing', 'ENOENT');
                expect(err.code).toBe('PATH_NOT_FOUND');
            });

            it('maps EEXIST to FILE_ALREADY_EXISTS', () => {
                const err = DownloadError.fileSystemError('create', '/f', 'EEXIST');
                expect(err.code).toBe('FILE_ALREADY_EXISTS');
            });

            it('defaults to FILE_SYSTEM_ERROR for unknown', () => {
                const err = DownloadError.fileSystemError('read', '/f', 'EIO');
                expect(err.code).toBe('FILE_SYSTEM_ERROR');
            });
        });

        describe('validationError', () => {
            it('maps url + protocol reason to INVALID_PROTOCOL', () => {
                const err = DownloadError.validationError('url', 'ftp://x', 'unsupported protocol');
                expect(err.code).toBe('INVALID_PROTOCOL');
            });

            it('maps url + format reason to MALFORMED_URL', () => {
                const err = DownloadError.validationError('url', 'not-a-url', 'bad format');
                expect(err.code).toBe('MALFORMED_URL');
            });

            it('maps url + other reason to INVALID_URL', () => {
                const err = DownloadError.validationError('url', '', 'empty');
                expect(err.code).toBe('INVALID_URL');
            });

            it('maps path + traversal reason to PATH_TRAVERSAL_ATTEMPT', () => {
                const err = DownloadError.validationError('path', '../etc', 'path traversal detected');
                expect(err.code).toBe('PATH_TRAVERSAL_ATTEMPT');
            });

            it('defaults to VALIDATION_ERROR for other fields', () => {
                const err = DownloadError.validationError('size', '-1', 'negative');
                expect(err.code).toBe('VALIDATION_ERROR');
            });
        });

        describe('sftpError', () => {
            it('maps auth string to SFTP_AUTH_FAILED', () => {
                const err = DownloadError.sftpError('connect', 'Authentication failed');
                expect(err.code).toBe('SFTP_AUTH_FAILED');
            });

            it('maps ECONNREFUSED to SFTP_CONNECTION_FAILED', () => {
                const err = DownloadError.sftpError('connect', 'ECONNREFUSED');
                expect(err.code).toBe('SFTP_CONNECTION_FAILED');
            });

            it('maps No such file to SFTP_FILE_NOT_FOUND', () => {
                const err = DownloadError.sftpError('get', 'No such file');
                expect(err.code).toBe('SFTP_FILE_NOT_FOUND');
            });

            it('maps Permission denied to SFTP_PERMISSION_DENIED', () => {
                const err = DownloadError.sftpError('get', 'Permission denied');
                expect(err.code).toBe('SFTP_PERMISSION_DENIED');
            });

            it('maps Host key to SFTP_HOST_KEY_ERROR', () => {
                const err = DownloadError.sftpError('connect', 'Host key mismatch');
                expect(err.code).toBe('SFTP_HOST_KEY_ERROR');
            });

            it('defaults to SFTP_ERROR for unknown', () => {
                const err = DownloadError.sftpError('put', 'weird error');
                expect(err.code).toBe('SFTP_ERROR');
            });
        });
    });

    describe('toJSON', () => {
        it('returns structured error object', () => {
            const err = new DownloadError('HTTP_404', 'not found');
            const json = err.toJSON();
            expect(json.error.code).toBe('HTTP_404');
            expect(json.error.severity).toBeDefined();
            expect(json.error.category).toBeDefined();
            expect(json.error.isRetryable).toBeDefined();
            expect(json.error.recoveryActions).toBeInstanceOf(Array);
        });

        it('excludes stack by default', () => {
            const json = new DownloadError('X', 'msg').toJSON();
            expect(json.error.stack).toBeUndefined();
        });

        it('includes stack when requested', () => {
            const json = new DownloadError('X', 'msg').toJSON(true);
            expect(json.error.stack).toBeDefined();
        });

        it('excludes context when includeContext=false', () => {
            const json = new DownloadError('X', 'msg').toJSON(false, false);
            expect(json.error.context).toBeUndefined();
        });
    });

    describe('toCompactJSON', () => {
        it('returns compact shape for agents', () => {
            const err = new DownloadError('NETWORK_TIMEOUT', 'timeout', { url: 'https://x.com' });
            const compact = err.toCompactJSON();
            expect(compact.code).toBe('NETWORK_TIMEOUT');
            expect(compact.retryable).toBe(true);
            expect(compact.actions).toBeInstanceOf(Array);
            expect(compact.severity).toBeDefined();
            expect(compact.category).toBeDefined();
        });
    });

    describe('toFormattedString', () => {
        it('includes severity, code, and userMessage', () => {
            const err = new DownloadError('HTTP_404', 'not found');
            const str = err.toFormattedString(false);
            expect(str).toMatch(/HTTP_404/);
            expect(str).toMatch(/not found on the server/i);
        });

        it('includes URL when present in context', () => {
            const err = new DownloadError('HTTP_404', 'msg', { url: 'https://x.com/f' });
            expect(err.toFormattedString(false)).toMatch('https://x.com/f');
        });

        it('includes correlationId when present', () => {
            const err = new DownloadError('X', 'msg', { correlationId: 'corr-42' });
            expect(err.toFormattedString(false)).toMatch('corr-42');
        });

        it('produces output without ANSI codes when useColors=false', () => {
            const str = new DownloadError('SYSTEM_ERROR', 'msg').toFormattedString(false);
            expect(str).not.toMatch('\x1b[');
        });
    });
});
