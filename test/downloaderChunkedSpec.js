/**
 * Regression test: download result must report actual bytes written
 * even when the server omits Content-Length (chunked transfer encoding).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let server;
let port;
let tmpDir;

const PAYLOAD = Buffer.alloc(50000, 0x61); // 50KB of 'a'

beforeAll(() => new Promise((resolve) => {
    // Must be within CWD — SecurityService rejects paths outside project root
    const tempBase = path.join(__dirname, 'temp');
    fs.mkdirSync(tempBase, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(tempBase, 'chunked-'));
    server = http.createServer((req, res) => {
        // Deliberately omit Content-Length to simulate chunked transfer
        res.writeHead(200, { 'Transfer-Encoding': 'chunked' });
        res.write(PAYLOAD.slice(0, 25000));
        res.end(PAYLOAD.slice(25000));
    });
    server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
    });
}));

afterAll(() => new Promise((resolve) => {
    // Windows may hold a brief lock on the downloaded file; ignore cleanup errors
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    server.close(resolve);
}));

describe('downloader — chunked transfer encoding', () => {
    it('reports actual bytes written when Content-Length is absent', async () => {
        const download = (await import('../lib/downloader.js')).default;

        const results = await download(
            [`http://127.0.0.1:${port}/file.bin`],
            tmpDir,
            { quietMode: true },
        );

        expect(results).toHaveLength(1);
        expect(results[0].success).toBe(true);
        expect(results[0].size).toBe(PAYLOAD.length);
    });
});
