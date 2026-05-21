'use strict';

const fs     = require('node:fs');
const path   = require('node:path');
const crypto = require('node:crypto');
const os     = require('node:os');
const { Worker } = require('node:worker_threads');

const { ChecksumPool }      = require('../lib/workers/ChecksumPool');
const { computeChecksums }  = require('../lib/workers/ChecksumWorker');

const WORKER_PATH = path.join(__dirname, '../lib/workers/ChecksumWorker.js');
const TEMP_DIR    = path.join(__dirname, 'temp');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeTempFile(content) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const filePath = path.join(TEMP_DIR, `checksum-test-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    fs.writeFileSync(filePath, content);
    return filePath;
}

function expectedHash(algo, content) {
    return crypto.createHash(algo).update(content).digest('hex');
}

function spawnWorker(workerData) {
    return new Promise((resolve, reject) => {
        const w = new Worker(WORKER_PATH, { workerData });
        w.once('message', resolve);
        w.once('error', reject);
    });
}

// ─── computeChecksums (core logic, no worker thread) ─────────────────────────

describe('computeChecksums', () => {

    it('returns correct md5 for known content', () => {
        const content = Buffer.from('hello world');
        const filePath = writeTempFile(content);
        try {
            const result = computeChecksums(filePath, ['md5']);
            expect(result.md5).toBe(expectedHash('md5', content));
        } finally {
            fs.unlinkSync(filePath);
        }
    });

    it('returns correct sha256 for known content', () => {
        const content = Buffer.from('sha256 test');
        const filePath = writeTempFile(content);
        try {
            const result = computeChecksums(filePath, ['sha256']);
            expect(result.sha256).toBe(expectedHash('sha256', content));
        } finally {
            fs.unlinkSync(filePath);
        }
    });

    it('computes multiple algorithms in one call', () => {
        const content = Buffer.from('multi');
        const filePath = writeTempFile(content);
        try {
            const result = computeChecksums(filePath, ['md5', 'sha256', 'sha1']);
            expect(result.md5).toBe(expectedHash('md5', content));
            expect(result.sha256).toBe(expectedHash('sha256', content));
            expect(result.sha1).toBe(expectedHash('sha1', content));
        } finally {
            fs.unlinkSync(filePath);
        }
    });

    it('handles empty file', () => {
        const filePath = writeTempFile(Buffer.alloc(0));
        try {
            const result = computeChecksums(filePath, ['md5']);
            expect(result.md5).toBe(expectedHash('md5', Buffer.alloc(0)));
        } finally {
            fs.unlinkSync(filePath);
        }
    });

    it('handles binary content', () => {
        const content = crypto.randomBytes(512);
        const filePath = writeTempFile(content);
        try {
            const result = computeChecksums(filePath, ['sha256']);
            expect(result.sha256).toBe(expectedHash('sha256', content));
        } finally {
            fs.unlinkSync(filePath);
        }
    });

    it('throws when file does not exist', () => {
        expect(() => computeChecksums('/no/such/file.bin', ['md5'])).toThrow();
    });
});

// ─── ChecksumWorker (via worker thread) ──────────────────────────────────────

describe('ChecksumWorker', () => {

    it('computes md5 for a known file', async () => {
        const content = Buffer.from('hello world');
        const filePath = writeTempFile(content);
        try {
            const msg = await spawnWorker({ filePath, algorithms: ['md5'] });
            expect(msg.ok).toBe(true);
            expect(msg.checksums.md5).toBe(expectedHash('md5', content));
        } finally {
            fs.unlinkSync(filePath);
        }
    });

    it('computes sha256 for a known file', async () => {
        const content = Buffer.from('n-get checksum test');
        const filePath = writeTempFile(content);
        try {
            const msg = await spawnWorker({ filePath, algorithms: ['sha256'] });
            expect(msg.ok).toBe(true);
            expect(msg.checksums.sha256).toBe(expectedHash('sha256', content));
        } finally {
            fs.unlinkSync(filePath);
        }
    });

    it('computes multiple algorithms in one pass', async () => {
        const content = Buffer.from('multi-algo test content');
        const filePath = writeTempFile(content);
        try {
            const msg = await spawnWorker({ filePath, algorithms: ['md5', 'sha256', 'sha1'] });
            expect(msg.ok).toBe(true);
            expect(msg.checksums.md5).toBe(expectedHash('md5', content));
            expect(msg.checksums.sha256).toBe(expectedHash('sha256', content));
            expect(msg.checksums.sha1).toBe(expectedHash('sha1', content));
        } finally {
            fs.unlinkSync(filePath);
        }
    });

    it('returns ok=false when file does not exist', async () => {
        const msg = await spawnWorker({
            filePath: '/this/file/does/not/exist/ever.bin',
            algorithms: ['md5'],
        });
        expect(msg.ok).toBe(false);
        expect(msg.error).toBeTypeOf('string');
        expect(msg.error.length).toBeGreaterThan(0);
    });

    it('handles empty file correctly', async () => {
        const filePath = writeTempFile(Buffer.alloc(0));
        try {
            const msg = await spawnWorker({ filePath, algorithms: ['md5'] });
            expect(msg.ok).toBe(true);
            expect(msg.checksums.md5).toBe(expectedHash('md5', Buffer.alloc(0)));
        } finally {
            fs.unlinkSync(filePath);
        }
    });

    it('handles binary content correctly', async () => {
        const content = crypto.randomBytes(1024);
        const filePath = writeTempFile(content);
        try {
            const msg = await spawnWorker({ filePath, algorithms: ['sha256'] });
            expect(msg.ok).toBe(true);
            expect(msg.checksums.sha256).toBe(expectedHash('sha256', content));
        } finally {
            fs.unlinkSync(filePath);
        }
    });
});

// ─── ChecksumPool ─────────────────────────────────────────────────────────────

describe('ChecksumPool', () => {

    it('computes checksums via pool.compute()', async () => {
        const content = Buffer.from('pool test');
        const filePath = writeTempFile(content);
        const pool = new ChecksumPool();
        try {
            const result = await pool.compute(filePath, ['md5', 'sha256']);
            expect(result.md5).toBe(expectedHash('md5', content));
            expect(result.sha256).toBe(expectedHash('sha256', content));
        } finally {
            fs.unlinkSync(filePath);
            pool.destroy();
        }
    });

    it('defaults to md5+sha256 when no algorithms specified', async () => {
        const content = Buffer.from('defaults test');
        const filePath = writeTempFile(content);
        const pool = new ChecksumPool();
        try {
            const result = await pool.compute(filePath);
            expect(result).toHaveProperty('md5');
            expect(result).toHaveProperty('sha256');
        } finally {
            fs.unlinkSync(filePath);
            pool.destroy();
        }
    });

    it('rejects when file does not exist', async () => {
        const pool = new ChecksumPool();
        try {
            await expect(pool.compute('/no/such/file.bin', ['md5'])).rejects.toThrow();
        } finally {
            pool.destroy();
        }
    });

    it('runs multiple jobs concurrently without corrupting results', async () => {
        const files = Array.from({ length: 4 }, (_, i) => {
            const content = Buffer.from(`concurrent-${i}`);
            return { content, filePath: writeTempFile(content) };
        });
        const pool = new ChecksumPool();
        try {
            const results = await Promise.all(
                files.map(({ filePath, content }) =>
                    pool.compute(filePath, ['sha256']).then(r => ({ r, content }))
                )
            );
            for (const { r, content } of results) {
                expect(r.sha256).toBe(expectedHash('sha256', content));
            }
        } finally {
            files.forEach(({ filePath }) => fs.unlinkSync(filePath));
            pool.destroy();
        }
    });

    it('queues jobs when all worker slots are full', async () => {
        const pool = new ChecksumPool();
        const count = pool.concurrency + 2;
        const files = Array.from({ length: count }, () => {
            const content = crypto.randomBytes(512);
            return { content, filePath: writeTempFile(content) };
        });
        try {
            const results = await Promise.all(
                files.map(({ filePath, content }) =>
                    pool.compute(filePath, ['md5']).then(r => ({ r, content }))
                )
            );
            for (const { r, content } of results) {
                expect(r.md5).toBe(expectedHash('md5', content));
            }
        } finally {
            files.forEach(({ filePath }) => fs.unlinkSync(filePath));
            pool.destroy();
        }
    });

    it('concurrency is capped at min(cpus, 4)', () => {
        const pool = new ChecksumPool();
        expect(pool.concurrency).toBe(Math.min(os.cpus().length, 4));
        pool.destroy();
    });

    it('destroy() clears the queue without throwing', () => {
        const pool = new ChecksumPool();
        expect(() => pool.destroy()).not.toThrow();
    });
});
