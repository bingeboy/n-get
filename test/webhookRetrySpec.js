'use strict';
/**
 * @fileoverview Unit tests for webhook exponential-backoff retry in EventSink.
 *
 * Uses vi.stubGlobal('fetch', ...) for network-error tests and a real
 * node:http server for the happy-path and HTTP-status-code tests.
 */

const http = require('node:http');
const { EventSink } = require('../lib/core/EventSink');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function captureStream(stream) {
    const state = { output: '' };
    const orig = stream.write.bind(stream);
    stream.write = function (chunk) {
        state.output += chunk;
        return true;
    };
    state.restore = function () {
        stream.write = orig;
    };
    return state;
}

/**
 * Spin up a local HTTP server that responds with the statuses in `statusSeq`
 * in order, then 200 for any additional requests.
 * Returns { port, callCount, close }.
 */
async function startStatusServer(statusSeq) {
    let callCount = 0;
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            const status = statusSeq[callCount] !== undefined ? statusSeq[callCount] : 200;
            callCount++;
            res.writeHead(status);
            res.end();
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
        port,
        get callCount() { return callCount; },
        close: () => new Promise(resolve => server.close(resolve)),
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('webhook exponential-backoff retry', () => {

    // ── 1. Retries on 500 ────────────────────────────────────────────────────

    it('retries on 500: makes 3 total attempts when server returns 500 twice then 200', async () => {
        const srv = await startStatusServer([500, 500, 200]);
        const stdout = captureStream(process.stdout);
        const stderr = captureStream(process.stderr);

        try {
            const emitter = new EventSink({
                sessionId: 'retry-500-test',
                webhooks: [{ url: `http://127.0.0.1:${srv.port}/hook` }],
            });
            emitter.emit('info', { message: 'retry-test' });
            await emitter.flush();
        } finally {
            stdout.restore();
            stderr.restore();
        }

        await srv.close();

        expect(srv.callCount).to.equal(3);
        // No final failure message since the last attempt succeeded
        expect(stderr.output).to.equal('');
    });

    // ── 2. No retry on 4xx ───────────────────────────────────────────────────

    it('does not retry on 4xx: makes exactly 1 attempt when server returns 400', async () => {
        const srv = await startStatusServer([400]);
        const stdout = captureStream(process.stdout);
        const stderr = captureStream(process.stderr);

        try {
            const emitter = new EventSink({
                sessionId: 'no-retry-400-test',
                webhooks: [{ url: `http://127.0.0.1:${srv.port}/hook` }],
            });
            emitter.emit('info', { message: 'should-not-retry' });
            await emitter.flush();
        } finally {
            stdout.restore();
            stderr.restore();
        }

        await srv.close();

        expect(srv.callCount).to.equal(1);
        expect(stderr.output).to.include('not retrying');
    });

    // ── 3. Network error retries ─────────────────────────────────────────────

    it('network error: logs "failed after 3 attempts" when all attempts throw', async () => {
        let fetchCallCount = 0;

        // Stub global fetch to always throw a network error
        vi.stubGlobal('fetch', async () => {
            fetchCallCount++;
            throw new Error('ECONNREFUSED');
        });

        const stdout = captureStream(process.stdout);
        const stderr = captureStream(process.stderr);

        try {
            const emitter = new EventSink({
                sessionId: 'network-error-test',
                webhooks: [{ url: 'http://127.0.0.1:19999/hook' }],
            });
            emitter.emit('info', { message: 'network-fail' });
            await emitter.flush();
        } finally {
            stdout.restore();
            stderr.restore();
            vi.unstubAllGlobals();
        }

        expect(fetchCallCount).to.equal(3);
        expect(stderr.output).to.include('failed after 3 attempts');
    });

    // ── 4. Configurable maxAttempts ──────────────────────────────────────────

    it('respects webhookMaxAttempts: 1 means no retry on 500', async () => {
        const srv = await startStatusServer([500, 500, 500]);
        const stdout = captureStream(process.stdout);
        const stderr = captureStream(process.stderr);

        try {
            const emitter = new EventSink({
                sessionId:          'max-attempts-1-test',
                webhooks:           [{ url: `http://127.0.0.1:${srv.port}/hook` }],
                webhookMaxAttempts: 1,
                webhookBackoffMs:   [0],
            });
            emitter.emit('info', { message: 'no-retry' });
            await emitter.flush();
        } finally {
            stdout.restore();
            stderr.restore();
        }

        await srv.close();
        expect(srv.callCount).to.equal(1);
    });

    it('respects webhookMaxAttempts: 2 makes exactly 2 attempts on repeated 500', async () => {
        const srv = await startStatusServer([500, 500, 500]);
        const stdout = captureStream(process.stdout);
        const stderr = captureStream(process.stderr);

        try {
            const emitter = new EventSink({
                sessionId:          'max-attempts-2-test',
                webhooks:           [{ url: `http://127.0.0.1:${srv.port}/hook` }],
                webhookMaxAttempts: 2,
                webhookBackoffMs:   [0, 0],
            });
            emitter.emit('info', { message: 'two-attempts' });
            await emitter.flush();
        } finally {
            stdout.restore();
            stderr.restore();
        }

        await srv.close();
        expect(srv.callCount).to.equal(2);
    });

    // ── 5. Success on first try ──────────────────────────────────────────────

    it('success on first try: makes exactly 1 call and logs nothing on 200', async () => {
        const srv = await startStatusServer([200]);
        const stdout = captureStream(process.stdout);
        const stderr = captureStream(process.stderr);

        try {
            const emitter = new EventSink({
                sessionId: 'success-first-test',
                webhooks: [{ url: `http://127.0.0.1:${srv.port}/hook` }],
            });
            emitter.emit('info', { message: 'all-good' });
            await emitter.flush();
        } finally {
            stdout.restore();
            stderr.restore();
        }

        await srv.close();

        expect(srv.callCount).to.equal(1);
        expect(stderr.output).to.equal('');
    });

});
