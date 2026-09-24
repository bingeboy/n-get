'use strict';
/**
 * @fileoverview Tests for the --webhook event-forwarding feature.
 *
 * Spins up a local HTTP server, runs nget against a fixture URL with
 * --webhook pointing at the local server, and asserts events arrive.
 *
 * These tests make actual network calls. They belong in test:integration only.
 */

const http    = require('node:http');
const { execFile } = require('node:child_process');
const path    = require('node:path');

// Local fixture server (test/fixtures/), started by globalSetup. Replaces
// httpbin.org so the suite does not fail when a third-party host is down.
const ORIGIN = require('./fixtures/origin').readOrigin();


const NGET = path.join(__dirname, '..', 'index.js');
const FIXTURE_URL = `${ORIGIN}/get`;  // public, reliable, small response

function startReceiver(onEvent) {
    return new Promise((resolve) => {
        const events = [];
        const server = http.createServer((req, res) => {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    events.push(parsed);
                    onEvent && onEvent(parsed);
                } catch { /* ignore malformed */ }
                res.writeHead(200);
                res.end();
            });
        });
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, events, port });
        });
    });
}

function runNget(args, timeout = 15000) {
    return new Promise((resolve) => {
        execFile(process.execPath, [NGET, ...args], { timeout }, (err, stdout, stderr) => {
            resolve({ exitCode: err ? err.code : 0, stdout, stderr, err });
        });
    });
}

/**
 * Wait until `predicate` holds, polling rather than sleeping a fixed duration.
 *
 * Webhook POSTs are fire-and-forget from a separate process, so they can still
 * be in flight after the CLI exits. A fixed wait is a bet that the machine is
 * fast enough — the exact shape of flake that #153 removed from three unit
 * specs. This waits as long as needed up to a bound, and returns immediately
 * once the condition is met.
 *
 * @param {() => boolean} predicate - condition to wait for
 * @param {string} description - included in the timeout message
 * @param {number} [timeoutMs=5000] - upper bound before failing
 */
async function waitFor(predicate, description, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) { return; }
        await new Promise(r => setTimeout(r, 25));
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${description}`);
}

describe('--webhook event forwarding', () => {

    it('POSTs all events to the webhook URL and completes the download', async () => {
        const { server, events, port } = await startReceiver();

        try {
            const result = await runNget([
                FIXTURE_URL,
                '--webhook', `http://127.0.0.1:${port}/events`,
            ], 20000);

            await waitFor(
                () => events.some(e => e.event === 'session_end'),
                'session_end to reach the receiver',
            );

            expect(result.exitCode).to.equal(0);
            expect(events.length).to.be.greaterThan(0);

            const eventTypes = events.map(e => e.event);
            expect(eventTypes).to.include('session_start');
            expect(eventTypes).to.include('session_end');

            // All events have required base fields
            for (const ev of events) {
                expect(ev).to.have.property('event');
                expect(ev).to.have.property('ts');
                expect(ev).to.have.property('session');
            }
        } finally {
            server.close();
        }
    });

    it('sends only filtered events when --webhook-events is set', async () => {
        const { server, events, port } = await startReceiver();

        try {
            await runNget([
                FIXTURE_URL,
                '--webhook', `http://127.0.0.1:${port}/events`,
                '--webhook-events', 'download_complete,session_end',
            ], 20000);

            await waitFor(
                () => events.some(e => e.event === 'download_complete' || e.event === 'session_end'),
                'a filtered event to reach the receiver',
            );

            const eventTypes = events.map(e => e.event);
            expect(eventTypes).to.not.include('session_start');
            expect(eventTypes).to.not.include('progress');
            // should contain download_complete and/or session_end
            expect(
                eventTypes.includes('download_complete') || eventTypes.includes('session_end')
            ).to.equal(true);
        } finally {
            server.close();
        }
    });

    it('completes the download even when the webhook receiver returns 500', async () => {
        const server = http.createServer((req, res) => {
            res.writeHead(500);
            res.end();
        });
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        const { port } = server.address();

        try {
            const result = await runNget([
                FIXTURE_URL,
                '--webhook', `http://127.0.0.1:${port}/events`,
            ], 20000);

            // Download should still succeed (best-effort guarantee)
            expect(result.exitCode).to.equal(0);
        } finally {
            server.close();
        }
    });

});

describe('nget fetch --webhook event emission', () => {

    it('emits fetch_start, fetch_complete events to webhook', async () => {
        const { server, events, port } = await startReceiver();

        try {
            const result = await runNget([
                'fetch', FIXTURE_URL,
                '--webhook', `http://127.0.0.1:${port}/events`,
            ], 15000);

            await waitFor(
                () => events.some(e => e.event === 'fetch_complete' || e.event === 'fetch_error'),
                'a terminal fetch event to reach the receiver',
            );

            expect(result.exitCode).to.equal(0);
            const eventTypes = events.map(e => e.event);
            expect(eventTypes).to.include('fetch_start');
            expect(eventTypes).to.include('fetch_complete');

            const fetchStart = events.find(e => e.event === 'fetch_start');
            expect(fetchStart).to.have.property('url', FIXTURE_URL);
            expect(fetchStart).to.have.property('method', 'GET');

            const fetchComplete = events.find(e => e.event === 'fetch_complete');
            expect(fetchComplete).to.have.property('status', 200);
            expect(fetchComplete).to.have.property('latencyMs');
        } finally {
            server.close();
        }
    });

    it('emits fetch_error on network failure', async () => {
        const { server, events, port } = await startReceiver();

        try {
            // Use a URL that will definitely fail (nothing listening on port 1)
            await runNget([
                'fetch', 'http://127.0.0.1:1',
                '--webhook', `http://127.0.0.1:${port}/events`,
            ], 15000);

            await waitFor(
                () => events.some(e => e.event === 'fetch_error'),
                'fetch_error to reach the receiver',
            );

            const eventTypes = events.map(e => e.event);
            expect(eventTypes).to.include('fetch_start');
            expect(eventTypes).to.include('fetch_error');
        } finally {
            server.close();
        }
    });

});
