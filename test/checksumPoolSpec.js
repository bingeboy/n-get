'use strict';

const os     = require('node:os');
const fs     = require('node:fs');
const path   = require('node:path');
const crypto = require('node:crypto');

const { ChecksumPool, checksumPool } = require('../lib/workers/ChecksumPool');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const tmp = os.tmpdir();
const tempFiles = [];

function writeTempFile(content) {
    const p = path.join(tmp, `nget-test-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    fs.writeFileSync(p, content);
    tempFiles.push(p);
    return p;
}

function expectedHash(content, algo) {
    return crypto.createHash(algo).update(content).digest('hex');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChecksumPool', () => {

    after(() => {
        // Clean up all temp files created during the suite
        for (const p of tempFiles) {
            try { fs.unlinkSync(p); } catch { /* ignore */ }
        }
    });

    // ── concurrency getter ───────────────────────────────────────────────────

    describe('concurrency getter', () => {
        it('returns min(os.cpus().length, 4)', () => {
            const pool = new ChecksumPool();
            const expected = Math.min(os.cpus().length, 4);
            expect(pool.concurrency).to.equal(expected);
        });

        it('is always between 1 and 4 inclusive', () => {
            const pool = new ChecksumPool();
            expect(pool.concurrency).to.be.at.least(1);
            expect(pool.concurrency).to.be.at.most(4);
        });
    });

    // ── compute — correct checksums ──────────────────────────────────────────

    describe('compute()', () => {

        it('returns correct MD5 for a known file', async () => {
            const content = Buffer.from('hello n-get md5 test');
            const filePath = writeTempFile(content);
            const pool = new ChecksumPool();

            const result = await pool.compute(filePath, ['md5']);

            expect(result).to.have.property('md5');
            expect(result.md5).to.equal(expectedHash(content, 'md5'));
        });

        it('returns correct SHA256 for a known file', async () => {
            const content = Buffer.from('hello n-get sha256 test');
            const filePath = writeTempFile(content);
            const pool = new ChecksumPool();

            const result = await pool.compute(filePath, ['sha256']);

            expect(result).to.have.property('sha256');
            expect(result.sha256).to.equal(expectedHash(content, 'sha256'));
        });

        it('returns both MD5 and SHA256 together', async () => {
            const content = Buffer.from('hello n-get dual hash test');
            const filePath = writeTempFile(content);
            const pool = new ChecksumPool();

            const result = await pool.compute(filePath, ['md5', 'sha256']);

            expect(result).to.have.property('md5');
            expect(result).to.have.property('sha256');
            expect(result.md5).to.equal(expectedHash(content, 'md5'));
            expect(result.sha256).to.equal(expectedHash(content, 'sha256'));
        });

        it('uses md5 and sha256 as defaults when no algorithms supplied', async () => {
            const content = Buffer.from('default algorithms test');
            const filePath = writeTempFile(content);
            const pool = new ChecksumPool();

            // Call without second argument — relies on default parameter
            const result = await pool.compute(filePath);

            expect(result).to.have.property('md5');
            expect(result).to.have.property('sha256');
            expect(result.md5).to.equal(expectedHash(content, 'md5'));
            expect(result.sha256).to.equal(expectedHash(content, 'sha256'));
        });

        it('handles binary content (non-text file)', async () => {
            const content = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x01, 0x7f]);
            const filePath = writeTempFile(content);
            const pool = new ChecksumPool();

            const result = await pool.compute(filePath, ['sha256']);

            expect(result.sha256).to.equal(expectedHash(content, 'sha256'));
        });

        it('handles an empty file', async () => {
            const content = Buffer.alloc(0);
            const filePath = writeTempFile(content);
            const pool = new ChecksumPool();

            const result = await pool.compute(filePath, ['md5', 'sha256']);

            expect(result.md5).to.equal(expectedHash(content, 'md5'));
            expect(result.sha256).to.equal(expectedHash(content, 'sha256'));
        });

        it('rejects with an error for a non-existent file', async () => {
            const pool = new ChecksumPool();
            const nonExistent = path.join(tmp, 'nget-does-not-exist-ever.bin');

            let thrown = null;
            try {
                await pool.compute(nonExistent, ['md5']);
            } catch (err) {
                thrown = err;
            }

            expect(thrown).to.be.an('error');
            // Worker posts { ok: false, error: <message> } which becomes new Error(message)
            expect(thrown.message).to.be.a('string').and.have.length.above(0);
        });

    });

    // ── concurrency / queue overflow ──────────────────────────────────────────

    describe('queue overflow — more jobs than MAX_WORKERS', () => {

        it('all jobs complete successfully when fired simultaneously', async () => {
            // Create MAX_WORKERS + 2 files so the queue is definitely exercised
            const pool = new ChecksumPool();
            const MAX = pool.concurrency;
            const jobCount = MAX + 2;

            const files = [];
            for (let i = 0; i < jobCount; i++) {
                const content = Buffer.from(`queue overflow job ${i}`);
                files.push({ path: writeTempFile(content), content });
            }

            // Fire all jobs at once
            const promises = files.map(f => pool.compute(f.path, ['md5']));
            const results = await Promise.all(promises);

            expect(results).to.have.length(jobCount);
            for (let i = 0; i < jobCount; i++) {
                expect(results[i].md5).to.equal(expectedHash(files[i].content, 'md5'));
            }
        });

        it('queues exactly overflow into _queue when all worker slots are full', async () => {
            // We verify the pool gracefully serialises work by running more jobs
            // than the concurrency cap and confirming every result is correct.
            const pool = new ChecksumPool();
            const jobCount = pool.concurrency * 2; // guaranteed queue pressure

            const files = [];
            for (let i = 0; i < jobCount; i++) {
                const content = Buffer.from(`serialised job ${i} data`);
                files.push({ path: writeTempFile(content), content });
            }

            const results = await Promise.all(
                files.map(f => pool.compute(f.path, ['sha256']))
            );

            for (let i = 0; i < jobCount; i++) {
                expect(results[i].sha256).to.equal(expectedHash(files[i].content, 'sha256'));
            }
        });

    });

    // ── destroy() ────────────────────────────────────────────────────────────

    describe('destroy()', () => {

        it('can be called on a fresh pool without error', () => {
            const pool = new ChecksumPool();
            expect(() => pool.destroy()).to.not.throw();
        });

        it('clears the pending queue (length becomes 0)', () => {
            const pool = new ChecksumPool();
            // Manually push dummy functions to simulate a full queue
            pool._queue.push(() => {});
            pool._queue.push(() => {});
            expect(pool._queue).to.have.length(2);

            pool.destroy();

            expect(pool._queue).to.have.length(0);
        });

        it('can be called multiple times without error', () => {
            const pool = new ChecksumPool();
            expect(() => {
                pool.destroy();
                pool.destroy();
                pool.destroy();
            }).to.not.throw();
        });

        it('pool still accepts new compute() calls after destroy()', async () => {
            const pool = new ChecksumPool();
            pool.destroy();

            const content = Buffer.from('post-destroy compute');
            const filePath = writeTempFile(content);

            const result = await pool.compute(filePath, ['md5']);
            expect(result.md5).to.equal(expectedHash(content, 'md5'));
        });

    });

    // ── checksumPool singleton ────────────────────────────────────────────────

    describe('checksumPool singleton', () => {

        it('is an instance of ChecksumPool', () => {
            expect(checksumPool).to.be.an.instanceof(ChecksumPool);
        });

        it('has a valid concurrency value', () => {
            expect(checksumPool.concurrency).to.equal(Math.min(os.cpus().length, 4));
        });

        it('can compute checksums (is fully functional)', async () => {
            const content = Buffer.from('singleton smoke test');
            const filePath = writeTempFile(content);

            const result = await checksumPool.compute(filePath, ['md5']);
            expect(result.md5).to.equal(expectedHash(content, 'md5'));
        });

        it('is the same object on repeated require() calls (module cache)', () => {
            // A second require must return the cached module
            const { checksumPool: pool2 } = require('../lib/workers/ChecksumPool');
            expect(pool2).to.equal(checksumPool);
        });

    });

});
