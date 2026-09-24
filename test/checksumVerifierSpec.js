'use strict';
/**
 * @fileoverview Tests for download checksum verification.
 *
 * n-get computed checksums and reported them, but never compared one to an
 * expected value — it could answer "what is this file's SHA-256?" and not
 * "is this the file I asked for?". `--expect <algorithm>:<hex>` closes that,
 * which is what makes a download safe to run unattended.
 *
 * The contract: on mismatch the file is discarded, no download_complete is
 * emitted, and the run exits non-zero with a CHECKSUM_MISMATCH error event.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');

const { parseExpectation, verifyFile, SUPPORTED_ALGORITHMS } = require('../lib/checksumVerifier.js');
const { downloadFile } = require('../lib/downloader.js');

const BODY = 'hello n-get';
const SHA256 = crypto.createHash('sha256').update(BODY).digest('hex');
const WRONG = '0'.repeat(64);

let server;
let origin;

before(() => new Promise(resolve => {
    server = http.createServer((req, res) => {
        res.writeHead(200, {'Content-Type': 'text/plain', 'Content-Length': String(BODY.length)});
        res.end(BODY);
    });
    server.listen(0, '127.0.0.1', () => {
        origin = `http://127.0.0.1:${server.address().port}`;
        resolve();
    });
}));

after(() => new Promise(resolve => server.close(resolve)));

let tmpDir;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-verify-'));
});

afterEach(() => {
    try {
        // Windows briefly locks a just-written file; retry rather than fail a
        // passing test in teardown.
        fs.rmSync(tmpDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 50});
    } catch {
        // Best effort — the OS reclaims the temp directory regardless.
    }
});

describe('checksum verification', () => {

    describe('parseExpectation', () => {

        it('accepts a well-formed sha256 expectation', () => {
            const parsed = parseExpectation(`sha256:${SHA256}`);
            expect(parsed.algorithm).to.equal('sha256');
            expect(parsed.digest).to.equal(SHA256);
        });

        it('lower-cases the digest so case is not a false mismatch', () => {
            expect(parseExpectation(`SHA256:${SHA256.toUpperCase()}`).digest).to.equal(SHA256);
        });

        it('supports every algorithm the worker can compute', () => {
            const lengths = {md5: 32, sha1: 40, sha256: 64, sha512: 128};
            for (const algorithm of SUPPORTED_ALGORITHMS) {
                const spec = `${algorithm}:${'a'.repeat(lengths[algorithm])}`;
                expect(parseExpectation(spec).algorithm).to.equal(algorithm);
            }
        });

        it('rejects a bare digest with no algorithm', () => {
            expect(() => parseExpectation(SHA256)).to.throw(/Expected <algorithm>:<hex>/);
        });

        it('rejects an unsupported algorithm', () => {
            expect(() => parseExpectation(`crc32:${'a'.repeat(8)}`)).to.throw(/Unsupported checksum algorithm/);
        });

        it('rejects non-hex characters', () => {
            expect(() => parseExpectation(`sha256:${'z'.repeat(64)}`)).to.throw(/hex characters only/);
        });

        it('rejects a truncated digest', () => {
            // A silently-passing typo would be worse than no verification, since
            // the caller would believe the file had been checked.
            expect(() => parseExpectation('sha256:abc123')).to.throw(/expected 64 hex characters/);
        });
    });

    describe('verifyFile', () => {

        it('reports ok for a matching file', async() => {
            const target = path.join(tmpDir, 'f.txt');
            fs.writeFileSync(target, BODY);

            const result = await verifyFile(target, parseExpectation(`sha256:${SHA256}`));
            expect(result.ok).to.be.true;
            expect(result.actual).to.equal(SHA256);
        });

        it('reports the actual digest on mismatch, for the error message', async() => {
            const target = path.join(tmpDir, 'f.txt');
            fs.writeFileSync(target, BODY);

            const result = await verifyFile(target, parseExpectation(`sha256:${WRONG}`));
            expect(result.ok).to.be.false;
            expect(result.expected).to.equal(WRONG);
            expect(result.actual).to.equal(SHA256);
        });
    });

    describe('download integration', () => {

        it('keeps the file when the checksum matches', async() => {
            await downloadFile(`${origin}/f.txt`, tmpDir, 1, 1, true, {
                quietMode: true,
                expectChecksum: `sha256:${SHA256}`,
            });

            expect(fs.readFileSync(path.join(tmpDir, 'f.txt'), 'utf8')).to.equal(BODY);
        });

        it('throws CHECKSUM_MISMATCH when it does not match', async() => {
            let error = null;
            try {
                await downloadFile(`${origin}/f.txt`, tmpDir, 1, 1, true, {
                    quietMode: true,
                    expectChecksum: `sha256:${WRONG}`,
                });
            } catch (caught) {
                error = caught;
            }

            expect(error, 'expected the download to reject').to.not.equal(null);
            expect(error.code).to.equal('CHECKSUM_MISMATCH');
            expect(error.isRetryable, 'a retry re-fetches the same bytes').to.be.false;
        });

        it('discards the file on mismatch rather than leaving a booby trap', async() => {
            // A later step reading the expected path must not find bad content.
            try {
                await downloadFile(`${origin}/f.txt`, tmpDir, 1, 1, true, {
                    quietMode: true,
                    expectChecksum: `sha256:${WRONG}`,
                });
            } catch {
                // expected
            }

            expect(fs.existsSync(path.join(tmpDir, 'f.txt'))).to.be.false;
        });

        it('names both digests in the error, so the caller can diagnose', async() => {
            let message = '';
            try {
                await downloadFile(`${origin}/f.txt`, tmpDir, 1, 1, true, {
                    quietMode: true,
                    expectChecksum: `sha256:${WRONG}`,
                });
            } catch (error) {
                message = error.message;
            }

            expect(message).to.include(WRONG);
            expect(message).to.include(SHA256);
        });

        it('downloads normally when no expectation is given', async() => {
            await downloadFile(`${origin}/f.txt`, tmpDir, 1, 1, true, {quietMode: true});
            expect(fs.existsSync(path.join(tmpDir, 'f.txt'))).to.be.true;
        });
    });
});
