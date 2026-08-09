/**
 * Regression test for agent identity in durable history (issue #156):
 * --agent-id / --session-id / --request-id / --conversation-id are accepted,
 * threaded through the session, and emitted in the live NDJSON stream — they
 * must also survive on the persisted history entry so provenance outlives the
 * process.
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

const PAYLOAD = Buffer.alloc(2048, 0x62);

beforeAll(() => new Promise((resolve) => {
    // Must be within CWD — SecurityService rejects paths outside project root
    const tempBase = path.join(__dirname, 'temp');
    fs.mkdirSync(tempBase, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(tempBase, 'hist-id-'));
    server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Length': String(PAYLOAD.length) });
        res.end(PAYLOAD);
    });
    server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
    });
}));

afterAll(() => new Promise((resolve) => {
    // Windows may hold a brief lock on the downloaded file; ignore cleanup errors
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    server.close(resolve);
}));

describe('downloader — agent identity in history', () => {
    it('persists caller-supplied identity on history entries', async () => {
        const download = (await import('../lib/downloader.js')).default;
        const HistoryManager = (await import('../lib/services/HistoryManager.js')).default;

        const results = await download(
            [`http://127.0.0.1:${port}/tracked.bin`],
            tmpDir,
            {
                quietMode: true,
                agentId: 'agent-e2e',
                sessionId: 'sess-e2e',
                requestId: 'req-e2e',
                conversationId: 'conv-e2e',
            },
        );

        expect(results).toHaveLength(1);
        expect(results[0].success).toBe(true);

        const historyManager = new HistoryManager();
        const history = await historyManager.getHistory(tmpDir);
        expect(history).toHaveLength(1);
        expect(history[0].agentId).toBe('agent-e2e');
        expect(history[0].sessionId).toBe('sess-e2e');
        expect(history[0].requestId).toBe('req-e2e');
        expect(history[0].conversationId).toBe('conv-e2e');
        // Internal per-batch correlation id is unchanged and separate
        expect(history[0].correlationId).toMatch(/^batch-/);
    });

    it('records the generated session id when none is supplied', async () => {
        const download = (await import('../lib/downloader.js')).default;
        const HistoryManager = (await import('../lib/services/HistoryManager.js')).default;

        const subDir = path.join(tmpDir, 'gen');
        fs.mkdirSync(subDir, { recursive: true });

        await download(
            [`http://127.0.0.1:${port}/anon.bin`],
            subDir,
            { quietMode: true },
        );

        const historyManager = new HistoryManager();
        const history = await historyManager.getHistory(subDir);
        expect(history).toHaveLength(1);
        // No agent identity supplied — stored as null, never invented
        expect(history[0].agentId).toBeNull();
        expect(history[0].requestId).toBeNull();
        expect(history[0].conversationId).toBeNull();
        // The session id always exists (generated) so history rows can be
        // joined against the live NDJSON stream of the same run
        expect(history[0].sessionId).toMatch(/^sess_/);
    });

    it('persists identity on failed download entries too', async () => {
        const download = (await import('../lib/downloader.js')).default;
        const HistoryManager = (await import('../lib/services/HistoryManager.js')).default;

        // Failed downloads log filePath = destination dir, so the history file
        // lands in the destination's PARENT directory (pre-existing behaviour).
        // Nest one level so that parent is unique to this test.
        const failParent = path.join(tmpDir, 'failhome');
        const failDest = path.join(failParent, 'dest');
        fs.mkdirSync(failDest, { recursive: true });

        // Port 1 on localhost — connection refused, download fails fast
        await download(
            ['http://127.0.0.1:1/unreachable.bin'],
            failDest,
            { quietMode: true, agentId: 'agent-e2e', conversationId: 'conv-fail' },
        );

        const historyManager = new HistoryManager();
        const history = await historyManager.getHistory(failParent, { conversationId: 'conv-fail' });
        expect(history).toHaveLength(1);
        expect(history[0].status).toBe('failed');
        expect(history[0].agentId).toBe('agent-e2e');
        expect(history[0].conversationId).toBe('conv-fail');
    });
});
