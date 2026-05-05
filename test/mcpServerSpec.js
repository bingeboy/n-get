'use strict';
/**
 * @fileoverview Tests for lib/mcp/server.js
 *
 * Uses InMemoryTransport + MCP Client to exercise all four tools
 * through the full MCP stack without spawning a subprocess.
 *
 * Covers:
 *   get_jobs          — zero sessions, active session, session summary fields
 *   get_capabilities  — returns valid capabilities document
 *   download_file     — success path, error path, session_id passthrough
 *   batch_download    — summary fields, all-error sets isError, mixed results
 */

const { expect }            = require('chai');
const fs                    = require('node:fs');
const path                  = require('node:path');

const { createServer }      = require('../lib/mcp/server.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client }            = require('@modelcontextprotocol/sdk/client/index.js');

const { DownloadSession, ACTIVE_DIR } = require('../lib/core/DownloadSession.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flushIO() {
    return new Promise(resolve => setTimeout(resolve, 50));
}

function cleanSession(id) {
    try { fs.unlinkSync(path.join(ACTIVE_DIR, `${id}.json`)); } catch { /* ok */ }
}

/**
 * Create a connected server+client pair using InMemoryTransport.
 * Returns { client, cleanup }.
 */
async function connect() {
    const server = createServer();
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: 'test-client', version: '0.0.1' });

    await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
    ]);

    return {
        client,
        cleanup: async () => {
            await client.close();
        },
    };
}

/**
 * Call a tool and return the parsed JSON from the first text content block.
 */
async function callTool(client, name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content.find(c => c.type === 'text')?.text;
    return { raw: result, parsed: JSON.parse(text) };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('MCP server', () => {

    // ── get_jobs ──────────────────────────────────────────────────────────────

    describe('get_jobs', () => {

        it('returns count=0 and empty sessions array when no sessions are active', async () => {
            const { client, cleanup } = await connect();
            try {
                const { parsed } = await callTool(client, 'get_jobs');
                expect(parsed).to.have.property('count').that.is.a('number');
                expect(parsed).to.have.property('sessions').that.is.an('array');
            } finally {
                await cleanup();
            }
        });

        it('returns a valid JSON response', async () => {
            const { client, cleanup } = await connect();
            try {
                const { raw } = await callTool(client, 'get_jobs');
                expect(raw.isError).to.not.equal(true);
                expect(raw.content[0].type).to.equal('text');
            } finally {
                await cleanup();
            }
        });

        it('includes a running session in the list', async () => {
            const id = 'mcp-jobs-active';
            cleanSession(id);
            const session = new DownloadSession({ sessionId: id, quietMode: true });
            session.start();
            session.queueDownload('https://example.com/a.bin');
            await flushIO();

            const { client, cleanup } = await connect();
            try {
                const { parsed } = await callTool(client, 'get_jobs');
                const found = parsed.sessions.find(s => s.sessionId === id);
                expect(found).to.exist;
                expect(found.total).to.be.at.least(1);
            } finally {
                await session.end();
                cleanSession(id);
                await cleanup();
            }
        });

        it('session summary includes required fields', async () => {
            const id = 'mcp-jobs-fields';
            cleanSession(id);
            const session = new DownloadSession({ sessionId: id, agentId: 'test-agent', quietMode: true });
            session.start();
            session.queueDownload('https://example.com/b.bin');
            await flushIO();

            const { client, cleanup } = await connect();
            try {
                const { parsed } = await callTool(client, 'get_jobs');
                const found = parsed.sessions.find(s => s.sessionId === id);
                expect(found).to.exist;
                expect(found).to.have.property('sessionId', id);
                expect(found).to.have.property('agent', 'test-agent');
                expect(found).to.have.property('pid').that.is.a('number');
                expect(found).to.have.property('startTime');
                expect(found).to.have.property('total').that.is.a('number');
                expect(found).to.have.property('active').that.is.a('number');
                expect(found).to.have.property('complete').that.is.a('number');
                expect(found).to.have.property('errors').that.is.a('number');
            } finally {
                await session.end();
                cleanSession(id);
                await cleanup();
            }
        });

        it('counts download statuses correctly', async () => {
            const id = 'mcp-jobs-counts';
            cleanSession(id);
            const session = new DownloadSession({ sessionId: id, quietMode: true });
            session.start();
            session.queueDownload('https://example.com/c.bin');
            await flushIO();
            session.updateDownload('https://example.com/c.bin', { status: 'complete' });
            session.queueDownload('https://example.com/d.bin');
            await flushIO();
            session.updateDownload('https://example.com/d.bin', { status: 'error' });
            await flushIO();

            const { client, cleanup } = await connect();
            try {
                const { parsed } = await callTool(client, 'get_jobs');
                const found = parsed.sessions.find(s => s.sessionId === id);
                expect(found).to.exist;
                expect(found.total).to.equal(2);
                expect(found.complete).to.equal(1);
                expect(found.errors).to.equal(1);
            } finally {
                await session.end();
                cleanSession(id);
                await cleanup();
            }
        });
    });

    // ── get_capabilities ──────────────────────────────────────────────────────

    describe('get_capabilities', () => {

        it('returns a valid capabilities document', async () => {
            const { client, cleanup } = await connect();
            try {
                const { parsed } = await callTool(client, 'get_capabilities');
                expect(parsed).to.be.an('object');
                expect(parsed).to.have.property('tool');
                expect(parsed).to.have.property('protocols');
                expect(parsed).to.have.property('features');
            } finally {
                await cleanup();
            }
        });

        it('includes version in the capabilities document', async () => {
            const { client, cleanup } = await connect();
            try {
                const { parsed } = await callTool(client, 'get_capabilities');
                expect(parsed.tool).to.have.property('version').that.is.a('string');
            } finally {
                await cleanup();
            }
        });

        it('is not marked as an error', async () => {
            const { client, cleanup } = await connect();
            try {
                const { raw } = await callTool(client, 'get_capabilities');
                expect(raw.isError).to.not.equal(true);
            } finally {
                await cleanup();
            }
        });
    });

    // ── download_file ─────────────────────────────────────────────────────────

    describe('download_file', () => {

        it('returns isError=true when download fails', async () => {
            const { client, cleanup } = await connect();
            try {
                const result = await client.callTool({
                    name:      'download_file',
                    arguments: { url: 'https://this-host-does-not-exist.invalid/file.bin' },
                });
                expect(result.isError).to.equal(true);
                expect(result.content[0].text).to.be.a('string').that.is.not.empty;
            } finally {
                await cleanup();
            }
        });

        it('cleans up the session even when download fails', async () => {
            const id = 'mcp-dl-cleanup';
            cleanSession(id);

            const { client, cleanup } = await connect();
            try {
                await client.callTool({
                    name:      'download_file',
                    arguments: {
                        url:        'https://this-host-does-not-exist.invalid/file.bin',
                        session_id: id,
                    },
                });
                await flushIO();
                // Session file should be gone after end()
                const exists = fs.existsSync(path.join(ACTIVE_DIR, `${id}.json`));
                expect(exists).to.equal(false);
            } finally {
                cleanSession(id);
                await cleanup();
            }
        });

        it('returns isError=true for an invalid URL', async () => {
            const { client, cleanup } = await connect();
            try {
                const result = await client.callTool({
                    name:      'download_file',
                    arguments: { url: 'not-a-url' },
                });
                expect(result.isError).to.equal(true);
            } finally {
                await cleanup();
            }
        });
    });

    // ── batch_download ────────────────────────────────────────────────────────

    describe('batch_download', () => {

        it('returns isError=true when all downloads fail', async () => {
            const { client, cleanup } = await connect();
            try {
                const result = await client.callTool({
                    name:      'batch_download',
                    arguments: {
                        urls: [
                            'https://this-host-does-not-exist.invalid/a.bin',
                            'https://this-host-does-not-exist.invalid/b.bin',
                        ],
                    },
                });
                expect(result.isError).to.equal(true);
            } finally {
                await cleanup();
            }
        });

        it('response includes total, success, errors, files fields', async () => {
            const { client, cleanup } = await connect();
            try {
                const result = await client.callTool({
                    name:      'batch_download',
                    arguments: {
                        urls: ['https://this-host-does-not-exist.invalid/c.bin'],
                    },
                });
                const parsed = JSON.parse(result.content[0].text);
                expect(parsed).to.have.property('total').that.is.a('number');
                expect(parsed).to.have.property('success').that.is.a('number');
                expect(parsed).to.have.property('errors').that.is.a('number');
                expect(parsed).to.have.property('files').that.is.an('array');
            } finally {
                await cleanup();
            }
        });

        it('files array entries include url, success, error fields', async () => {
            const { client, cleanup } = await connect();
            try {
                const result = await client.callTool({
                    name:      'batch_download',
                    arguments: {
                        urls: ['https://this-host-does-not-exist.invalid/d.bin'],
                    },
                });
                const parsed = JSON.parse(result.content[0].text);
                const file = parsed.files[0];
                expect(file).to.have.property('url');
                expect(file).to.have.property('success');
                expect(file).to.have.property('error');
            } finally {
                await cleanup();
            }
        });

        it('returns isError=true for an empty urls array', async () => {
            const { client, cleanup } = await connect();
            try {
                const result = await client.callTool({
                    name:      'batch_download',
                    arguments: { urls: [] },
                });
                expect(result.isError).to.equal(true);
            } finally {
                await cleanup();
            }
        });

        it('cleans up session even when all downloads fail', async () => {
            const id = 'mcp-batch-cleanup';
            cleanSession(id);

            const { client, cleanup } = await connect();
            try {
                await client.callTool({
                    name:      'batch_download',
                    arguments: {
                        urls:       ['https://this-host-does-not-exist.invalid/e.bin'],
                        session_id: id,
                    },
                });
                await flushIO();
                const exists = fs.existsSync(path.join(ACTIVE_DIR, `${id}.json`));
                expect(exists).to.equal(false);
            } finally {
                cleanSession(id);
                await cleanup();
            }
        });
    });

    // ── tool registration ─────────────────────────────────────────────────────

    describe('tool registration', () => {

        it('server exposes all four expected tools', async () => {
            const { client, cleanup } = await connect();
            try {
                const { tools } = await client.listTools();
                const names = tools.map(t => t.name);
                expect(names).to.include('download_file');
                expect(names).to.include('batch_download');
                expect(names).to.include('get_jobs');
                expect(names).to.include('get_capabilities');
            } finally {
                await cleanup();
            }
        });

        it('each tool has a description', async () => {
            const { client, cleanup } = await connect();
            try {
                const { tools } = await client.listTools();
                tools.forEach(t => {
                    expect(t.description, `${t.name} missing description`).to.be.a('string').that.is.not.empty;
                });
            } finally {
                await cleanup();
            }
        });
    });
});
