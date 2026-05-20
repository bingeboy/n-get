'use strict';
/**
 * fetch_http MCP tool — integration spec.
 *
 * Uses a local echo server that reflects method, headers, and body back
 * so tests can freely vary inputs without pre-baked routes.
 *
 * Covers:
 *   - All five HTTP methods (GET POST PUT DELETE PATCH)
 *   - JSON body round-trip
 *   - Custom header passthrough
 *   - Error response passthrough (4xx / 5xx still resolve, not throw)
 *   - Network failure (unreachable host) returns error shape
 *   - Response shape contract: status, statusText, latencyMs, headers, data
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';

const { createServer }      = await import('../lib/mcp/server.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { Client }            = await import('@modelcontextprotocol/sdk/client/index.js');

// ─── Echo server ──────────────────────────────────────────────────────────────
// Reflects method, headers, body, and query back as JSON.
// Status is controlled via ?status=NNN (default 200).

let server;
let base;

beforeAll(() => new Promise((resolve) => {
    server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            const url    = new URL(req.url, 'http://localhost');
            const status = parseInt(url.searchParams.get('status') ?? '200', 10);
            let body;
            try { body = raw ? JSON.parse(raw) : null; } catch { body = raw || null; }
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                method:  req.method,
                headers: req.headers,
                body,
            }));
        });
    });
    server.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${server.address().port}`;
        resolve();
    });
}));

afterAll(() => new Promise(resolve => server.close(resolve)));

// ─── MCP helpers ──────────────────────────────────────────────────────────────

async function connect() {
    const mcpServer = createServer();
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    await Promise.all([
        mcpServer.connect(serverTransport),
        client.connect(clientTransport),
    ]);
    return { client, cleanup: async () => { await client.close(); } };
}

async function fetch_http(client, args) {
    const result = await client.callTool({ name: 'fetch_http', arguments: args });
    const text   = result.content.find(c => c.type === 'text')?.text ?? '{}';
    return JSON.parse(text);
}

// ─── Response shape ───────────────────────────────────────────────────────────

describe('fetch_http — response shape', () => {
    it('always returns status, statusText, latencyMs, headers, data', async () => {
        const { client, cleanup } = await connect();
        try {
            const res = await fetch_http(client, { url: `${base}/` });
            expect(res).toHaveProperty('status');
            expect(res).toHaveProperty('statusText');
            expect(res).toHaveProperty('latencyMs');
            expect(res).toHaveProperty('headers');
            expect(res).toHaveProperty('data');
            expect(typeof res.latencyMs).toBe('number');
            expect(res.latencyMs).toBeGreaterThanOrEqual(0);
        } finally { await cleanup(); }
    });
});

// ─── HTTP methods ─────────────────────────────────────────────────────────────

describe('fetch_http — HTTP methods', () => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
        it(`${method} request is sent with correct method`, async () => {
            const { client, cleanup } = await connect();
            try {
                const res = await fetch_http(client, { url: `${base}/`, method });
                expect(res.status).toBe(200);
                expect(res.data.method).toBe(method);
            } finally { await cleanup(); }
        });
    }
});

// ─── JSON body round-trip ─────────────────────────────────────────────────────

describe('fetch_http — request body', () => {
    it('POST JSON body is received and echoed back', async () => {
        const { client, cleanup } = await connect();
        try {
            const payload = { agent: 'n-get-test', action: 'download', count: 3 };
            const res = await fetch_http(client, {
                url:    `${base}/`,
                method: 'POST',
                body:   JSON.stringify(payload),
            });
            expect(res.status).toBe(200);
            expect(res.data.body).toEqual(payload);
        } finally { await cleanup(); }
    });

    it('PUT with nested JSON body round-trips correctly', async () => {
        const { client, cleanup } = await connect();
        try {
            const payload = { config: { retries: 3, timeout: 5000 } };
            const res = await fetch_http(client, {
                url:    `${base}/`,
                method: 'PUT',
                body:   JSON.stringify(payload),
            });
            expect(res.data.body).toEqual(payload);
        } finally { await cleanup(); }
    });
});

// ─── Custom headers ───────────────────────────────────────────────────────────

describe('fetch_http — headers', () => {
    it('custom headers are forwarded to the server', async () => {
        const { client, cleanup } = await connect();
        try {
            const res = await fetch_http(client, {
                url:     `${base}/`,
                headers: { 'X-Agent-Id': 'my-agent', 'X-Session-Id': 'sess-123' },
            });
            expect(res.data.headers['x-agent-id']).toBe('my-agent');
            expect(res.data.headers['x-session-id']).toBe('sess-123');
        } finally { await cleanup(); }
    });
});

// ─── Status code passthrough ──────────────────────────────────────────────────

describe('fetch_http — status passthrough', () => {
    for (const status of [400, 401, 403, 404, 422, 500, 502, 503]) {
        it(`${status} response resolves (not throws) with correct status`, async () => {
            const { client, cleanup } = await connect();
            try {
                const res = await fetch_http(client, { url: `${base}/?status=${status}` });
                expect(res.status).toBe(status);
            } finally { await cleanup(); }
        });
    }
});

// ─── Network error ────────────────────────────────────────────────────────────

describe('fetch_http — network error', () => {
    it('unreachable host returns error shape with error field', async () => {
        const { client, cleanup } = await connect();
        try {
            const res = await fetch_http(client, {
                url:     'http://127.0.0.1:1',  // nothing listening on port 1
                timeout: 2000,
            });
            expect(res).toHaveProperty('error');
            expect(typeof res.error).toBe('string');
        } finally { await cleanup(); }
    });
});
