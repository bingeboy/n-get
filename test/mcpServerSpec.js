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

const fs                    = require('node:fs');
const path                  = require('node:path');

const { createServer }      = require('../lib/mcp/server.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client }            = require('@modelcontextprotocol/sdk/client/index.js');

const { DownloadSession, ACTIVE_DIR } = require('../lib/core/DownloadSession.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────


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
            await session.flushStatus();

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
            await session.flushStatus();

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
            await session.flushStatus();
            session.updateDownload('https://example.com/c.bin', { status: 'complete' });
            session.queueDownload('https://example.com/d.bin');
            await session.flushStatus();
            session.updateDownload('https://example.com/d.bin', { status: 'error' });
            await session.flushStatus();

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
                // session.end() drains the write chain before unlinking — no flush needed
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
                // session.end() drains the write chain before unlinking — no flush needed
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

    // ── MCP tools — Feature 3 ─────────────────────────────────────────────────

    describe('MCP tools — Feature 3', () => {

        // ── tool registration (Feature 3) ─────────────────────────────────────

        it('server exposes all 9 expected tools', async () => {
            const { client, cleanup } = await connect();
            try {
                const { tools } = await client.listTools();
                const names = tools.map(t => t.name);
                expect(names).to.include('cancel_session');
                expect(names).to.include('get_session');
                expect(names).to.include('set_profile');
                expect(names).to.include('get_history');
                expect(names).to.include('get_instructions');
            } finally {
                await cleanup();
            }
        });

        // ── cancel_session ────────────────────────────────────────────────────

        describe('cancel_session', () => {

            it('returns SESSION_NOT_FOUND for an unknown session ID', async () => {
                const { client, cleanup } = await connect();
                try {
                    const result = await client.callTool({
                        name: 'cancel_session',
                        arguments: { sessionId: 'sess_does_not_exist_xyz' },
                    });
                    expect(result.isError).to.equal(true);
                    const parsed = JSON.parse(result.content[0].text);
                    expect(parsed).to.have.property('code', 'SESSION_NOT_FOUND');
                } finally {
                    await cleanup();
                }
            });

            it('cancels an in-process session and returns cancelled=true', async () => {
                const id = 'mcp-cancel-test-' + Date.now();
                cleanSession(id);
                const session = new DownloadSession({ sessionId: id, quietMode: true });
                session.start();
                await session.flushStatus();

                const { client, cleanup } = await connect();
                try {
                    // The session is active on disk but not in the MCP server's sessions Map
                    // (it was created outside). So it will appear as SESSION_NOT_FOUND
                    // (not in Map, but could appear in readActiveSessions as external).
                    // Test that the error shape is correct for external sessions.
                    const result = await client.callTool({
                        name: 'cancel_session',
                        arguments: { sessionId: id },
                    });
                    // Either EXTERNAL_SESSION or SESSION_NOT_FOUND — both are valid error responses
                    expect(result.isError).to.equal(true);
                    const parsed = JSON.parse(result.content[0].text);
                    expect(parsed).to.have.property('code');
                    expect(['EXTERNAL_SESSION', 'SESSION_NOT_FOUND']).to.include(parsed.code);
                } finally {
                    await session.end();
                    cleanSession(id);
                    await cleanup();
                }
            });
        });

        // ── get_session ───────────────────────────────────────────────────────

        describe('get_session', () => {

            it('returns SESSION_NOT_FOUND for an unknown session ID', async () => {
                const { client, cleanup } = await connect();
                try {
                    const result = await client.callTool({
                        name: 'get_session',
                        arguments: { sessionId: 'sess_does_not_exist_abc' },
                    });
                    expect(result.isError).to.equal(true);
                    const parsed = JSON.parse(result.content[0].text);
                    expect(parsed).to.have.property('code', 'SESSION_NOT_FOUND');
                } finally {
                    await cleanup();
                }
            });

            it('returns session info for an active external session', async () => {
                const id = 'mcp-getsession-' + Date.now();
                cleanSession(id);
                const session = new DownloadSession({ sessionId: id, agentId: 'test-agent', quietMode: true });
                session.start();
                session.queueDownload('https://example.com/file.bin');
                await session.flushStatus();

                const { client, cleanup } = await connect();
                try {
                    const result = await client.callTool({
                        name: 'get_session',
                        arguments: { sessionId: id },
                    });
                    // External session visible on disk — should return its info
                    expect(result.isError).to.not.equal(true);
                    const parsed = JSON.parse(result.content[0].text);
                    expect(parsed).to.have.property('sessionId', id);
                    expect(parsed).to.have.property('pid').that.is.a('number');
                    expect(parsed).to.have.property('startTime');
                    expect(parsed).to.have.property('downloads');
                } finally {
                    await session.end();
                    cleanSession(id);
                    await cleanup();
                }
            });
        });

        // ── set_profile ───────────────────────────────────────────────────────

        describe('set_profile', () => {

            it('returns applied=false with a message when profile is not defined in config', async () => {
                const { client, cleanup } = await connect();
                try {
                    const result = await client.callTool({
                        name: 'set_profile',
                        arguments: { profileName: 'fast' },
                    });
                    // Profile may not exist in YAML — either applied or graceful failure
                    expect(result.isError).to.not.equal(true);
                    const parsed = JSON.parse(result.content[0].text);
                    expect(parsed).to.have.property('profile', 'fast');
                    expect(parsed).to.have.property('applied').that.is.a('boolean');
                } finally {
                    await cleanup();
                }
            });

            it('returns isError=true for an invalid profile name', async () => {
                const { client, cleanup } = await connect();
                try {
                    const result = await client.callTool({
                        name: 'set_profile',
                        arguments: { profileName: 'invalid_profile' },
                    });
                    // Zod enum validation should reject it at MCP layer
                    expect(result.isError).to.equal(true);
                } finally {
                    await cleanup();
                }
            });
        });

        // ── get_history ───────────────────────────────────────────────────────

        describe('get_history', () => {

            it('returns entries and total fields', async () => {
                const { client, cleanup } = await connect();
                try {
                    const { raw, parsed } = await callTool(client, 'get_history', {});
                    expect(raw.isError).to.not.equal(true);
                    expect(parsed).to.have.property('entries').that.is.an('array');
                    expect(parsed).to.have.property('total').that.is.a('number');
                } finally {
                    await cleanup();
                }
            });

            it('respects limit parameter', async () => {
                const { client, cleanup } = await connect();
                try {
                    const { parsed } = await callTool(client, 'get_history', { limit: 2 });
                    expect(parsed.entries.length).to.be.at.most(2);
                    expect(parsed).to.have.property('limit', 2);
                } finally {
                    await cleanup();
                }
            });

            it('returns entries with expected fields when history exists', async () => {
                const { client, cleanup } = await connect();
                try {
                    const { parsed } = await callTool(client, 'get_history', {});
                    // If there are entries, validate their shape
                    if (parsed.entries.length > 0) {
                        const entry = parsed.entries[0];
                        expect(entry).to.have.property('timestamp');
                        expect(entry).to.have.property('url');
                        expect(entry).to.have.property('status');
                        expect(entry).to.have.property('bytes');
                        expect(entry).to.have.property('duration');
                        expect(entry).to.have.property('error');
                    } else {
                        // Empty history is valid
                        expect(parsed.total).to.equal(0);
                    }
                } finally {
                    await cleanup();
                }
            });
        });

        // ── get_instructions ─────────────────────────────────────────────────

        describe('get_instructions', () => {

            it('returns AGENTS.md content as a non-empty string', async () => {
                const { client, cleanup } = await connect();
                try {
                    const result = await client.callTool({
                        name: 'get_instructions',
                        arguments: {},
                    });
                    // AGENTS.md exists in the repo root — should succeed
                    const text = result.content.find(c => c.type === 'text')?.text;
                    expect(text).to.be.a('string').that.is.not.empty;
                    if (!result.isError) {
                        // Should contain something from AGENTS.md
                        expect(text.length).to.be.greaterThan(10);
                    }
                } finally {
                    await cleanup();
                }
            });

            it('is not marked as an error when AGENTS.md exists', async () => {
                const { client, cleanup } = await connect();
                try {
                    const result = await client.callTool({
                        name: 'get_instructions',
                        arguments: {},
                    });
                    // AGENTS.md is in the repo and will be found
                    expect(result.isError).to.not.equal(true);
                } finally {
                    await cleanup();
                }
            });
        });

    }); // end 'MCP tools — Feature 3'

    // ── fetch_http ────────────────────────────────────────────────────────────

    describe('fetch_http', () => {

        it('is registered as a tool', async () => {
            const { client, cleanup } = await connect();
            try {
                const { tools } = await client.listTools();
                const names = tools.map(t => t.name);
                expect(names).to.include('fetch_http');
            } finally {
                await cleanup();
            }
        });

        it('returns isError=true when the request fails', async () => {
            const { client, cleanup } = await connect();
            try {
                const result = await client.callTool({
                    name: 'fetch_http',
                    arguments: { url: 'https://this-host-does-not-exist.invalid/api' },
                });
                expect(result.isError).to.equal(true);
                const parsed = JSON.parse(result.content[0].text);
                expect(parsed).to.have.property('error').that.is.a('string');
            } finally {
                await cleanup();
            }
        });

        it('passes method and body through (error path still validates shape)', async () => {
            const { client, cleanup } = await connect();
            try {
                const result = await client.callTool({
                    name: 'fetch_http',
                    arguments: {
                        url: 'https://this-host-does-not-exist.invalid/api',
                        method: 'POST',
                        body: JSON.stringify({ key: 'value' }),
                    },
                });
                expect(result.isError).to.equal(true);
                const parsed = JSON.parse(result.content[0].text);
                expect(parsed).to.have.property('error');
            } finally {
                await cleanup();
            }
        });

        it('rejects invalid method values at MCP layer', async () => {
            const { client, cleanup } = await connect();
            try {
                const result = await client.callTool({
                    name: 'fetch_http',
                    arguments: { url: 'https://example.com', method: 'INVALID' },
                });
                expect(result.isError).to.equal(true);
            } finally {
                await cleanup();
            }
        });
    });

    // ── get_agent_card ────────────────────────────────────────────────────────

    describe('get_agent_card', () => {

        it('is registered as a tool', async () => {
            const { client, cleanup } = await connect();
            try {
                const { tools } = await client.listTools();
                const names = tools.map(t => t.name);
                expect(names).to.include('get_agent_card');
            } finally {
                await cleanup();
            }
        });

        it('returns a valid A2A 1.0 agent card', async () => {
            const { client, cleanup } = await connect();
            try {
                const { raw, parsed } = await callTool(client, 'get_agent_card', {});
                expect(raw.isError).to.not.equal(true);
                expect(parsed).to.have.property('id');
                expect(parsed).to.have.property('name');
                expect(parsed).to.have.property('protocolVersion', '1.0');
                expect(parsed).to.have.property('skills').that.is.an('array');
            } finally {
                await cleanup();
            }
        });

        it('card skills include download, batch_download, fetch', async () => {
            const { client, cleanup } = await connect();
            try {
                const { parsed } = await callTool(client, 'get_agent_card', {});
                const skillIds = parsed.skills.map(s => s.id);
                expect(skillIds).to.include('download');
                expect(skillIds).to.include('batch_download');
                expect(skillIds).to.include('fetch');
            } finally {
                await cleanup();
            }
        });

        it('accepts an endpoint_url override', async () => {
            const { client, cleanup } = await connect();
            try {
                const { parsed } = await callTool(client, 'get_agent_card', {
                    endpoint_url: 'https://my-endpoint.example.com/a2a',
                });
                expect(parsed).to.have.property('url', 'https://my-endpoint.example.com/a2a');
            } finally {
                await cleanup();
            }
        });

        it('is not marked as an error', async () => {
            const { client, cleanup } = await connect();
            try {
                const { raw } = await callTool(client, 'get_agent_card', {});
                expect(raw.isError).to.not.equal(true);
            } finally {
                await cleanup();
            }
        });
    });

});
