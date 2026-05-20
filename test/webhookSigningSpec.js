'use strict';
/**
 * @fileoverview Tests for HMAC-SHA256 webhook signing (Feature 1).
 *
 * Covers:
 *   1. Signature header is present and correct when a secret is configured
 *   2. No signature header when secret is absent/empty
 *   3. --capabilities stdout includes signing info in the agentIntegration section
 */

const http   = require('node:http');
const crypto = require('node:crypto');
const { NgetEmitter } = require('../lib/core/NgetEmitter');
const CapabilitiesService = require('../lib/services/CapabilitiesService');

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
 * Spin up a local HTTP server that captures request headers + body.
 * Returns { port, received, close }.
 */
async function startCapturingServer() {
    const received = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            received.push({
                headers: Object.assign({}, req.headers),
                body,
            });
            res.writeHead(200);
            res.end();
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
        port,
        received,
        close: () => new Promise(resolve => server.close(resolve)),
    };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Webhook HMAC signing', () => {

    // ── 1. Signature header present and correct when secret configured ─────────

    it('adds X-NGet-Signature header with correct HMAC-SHA256 when secret is set', async () => {
        const srv = await startCapturingServer();
        const stdout = captureStream(process.stdout);

        const secret = 'my-super-secret';
        try {
            const emitter = new NgetEmitter({
                sessionId: 'sign-test',
                webhooks: [{ url: `http://127.0.0.1:${srv.port}/hook`, webhookSecret: secret }],
            });

            emitter.emit('info', { message: 'signed event' });
            await new Promise(r => setTimeout(r, 300));
        } finally {
            stdout.restore();
        }
        await srv.close();

        expect(srv.received.length).to.be.greaterThanOrEqual(1);
        const req = srv.received[0];
        expect(req.headers).to.have.property('x-nget-signature');

        const sig = req.headers['x-nget-signature'];
        expect(sig).to.match(/^sha256=[0-9a-f]{64}$/);

        // Verify the signature matches the body
        const expectedHex = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
        expect(sig).to.equal('sha256=' + expectedHex);
    });

    it('adds X-NGet-Signature when secret is set at emitter level (webhookSecret option)', async () => {
        const srv = await startCapturingServer();
        const stdout = captureStream(process.stdout);

        const secret = 'emitter-level-secret';
        try {
            const emitter = new NgetEmitter({
                sessionId: 'sign-emitter-level',
                webhookSecret: secret,
                webhooks: [{ url: `http://127.0.0.1:${srv.port}/hook` }],
            });

            emitter.emit('download_complete', { url: 'http://example.com/file.zip' });
            await new Promise(r => setTimeout(r, 300));
        } finally {
            stdout.restore();
        }
        await srv.close();

        expect(srv.received.length).to.be.greaterThanOrEqual(1);
        const req = srv.received[0];
        expect(req.headers).to.have.property('x-nget-signature');

        const sig = req.headers['x-nget-signature'];
        const expectedHex = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
        expect(sig).to.equal('sha256=' + expectedHex);
    });

    // ── 2. No signature header when secret is empty/absent ────────────────────

    it('does NOT add X-NGet-Signature when no secret is configured', async () => {
        const srv = await startCapturingServer();
        const stdout = captureStream(process.stdout);

        try {
            const emitter = new NgetEmitter({
                sessionId: 'no-sign-test',
                webhooks: [{ url: `http://127.0.0.1:${srv.port}/hook` }],
            });

            emitter.emit('info', { message: 'unsigned event' });
            await new Promise(r => setTimeout(r, 300));
        } finally {
            stdout.restore();
        }
        await srv.close();

        expect(srv.received.length).to.be.greaterThanOrEqual(1);
        const req = srv.received[0];
        expect(req.headers).to.not.have.property('x-nget-signature');
    });

    it('does NOT add X-NGet-Signature when secret is an empty string', async () => {
        const srv = await startCapturingServer();
        const stdout = captureStream(process.stdout);

        try {
            const emitter = new NgetEmitter({
                sessionId: 'empty-secret-test',
                webhookSecret: '',
                webhooks: [{ url: `http://127.0.0.1:${srv.port}/hook` }],
            });

            emitter.emit('info', { message: 'also unsigned' });
            await new Promise(r => setTimeout(r, 300));
        } finally {
            stdout.restore();
        }
        await srv.close();

        expect(srv.received.length).to.be.greaterThanOrEqual(1);
        const req = srv.received[0];
        expect(req.headers).to.not.have.property('x-nget-signature');
    });

    // ── 3. CapabilitiesService reports signing info ────────────────────────────

    it('agentIntegration.eventDriven.webhooks.signing equals "hmac-sha256"', () => {
        const svc  = new CapabilitiesService();
        const caps = svc.getCapabilities();
        const webhooks = caps.agentIntegration.eventDriven.webhooks;
        expect(webhooks).to.have.property('signing', 'hmac-sha256');
    });

    it('discovery.webhooks.signing equals "hmac-sha256"', () => {
        const svc = new CapabilitiesService();
        const disc = svc.getDiscoveryInfo();
        expect(disc.webhooks).to.have.property('signing', 'hmac-sha256');
    });

    it('discovery.webhooks.signatureHeader equals "X-NGet-Signature"', () => {
        const svc = new CapabilitiesService();
        const disc = svc.getDiscoveryInfo();
        expect(disc.webhooks).to.have.property('signatureHeader', 'X-NGet-Signature');
    });

});
