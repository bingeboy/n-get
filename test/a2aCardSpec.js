'use strict';
/**
 * @fileoverview Tests for Feature 2 — A2A Agent Card.
 *
 * Covers:
 *   1. toA2ACard() returns valid JSON with protocolVersion: '0.3.0'
 *   2. Required top-level fields: name, description, url, preferredTransport, skills
 *   3. All 3 skills present (download, batch_download, fetch) with id, name, description, tags
 *   4. get_agent_card MCP tool returns same structure
 *   5. --capabilities discovery section includes the a2a key
 */

const { createServer }      = require('../lib/mcp/server.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client }            = require('@modelcontextprotocol/sdk/client/index.js');
const CapabilitiesService   = require('../lib/services/CapabilitiesService');

// ─── MCP helpers ──────────────────────────────────────────────────────────────

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
        cleanup: async () => { await client.close(); },
    };
}

async function callTool(client, name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content.find(c => c.type === 'text')?.text ?? '{}';
    return JSON.parse(text);
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('A2A Agent Card', () => {

    // ── 1. protocolVersion ────────────────────────────────────────────────────

    it('toA2ACard() returns an object with protocolVersion "0.3.0"', () => {
        const svc  = new CapabilitiesService();
        const card = svc.toA2ACard();
        expect(card).to.have.property('protocolVersion', '0.3.0');
    });

    // ── 2. Required top-level fields ──────────────────────────────────────────

    it('toA2ACard() includes all required top-level fields', () => {
        const svc  = new CapabilitiesService();
        const card = svc.toA2ACard();
        const required = ['name', 'description', 'url', 'preferredTransport', 'skills'];
        for (const field of required) {
            expect(card, `missing field: ${field}`).to.have.property(field);
        }
    });

    it('toA2ACard() name is "n-get"', () => {
        const svc  = new CapabilitiesService();
        const card = svc.toA2ACard();
        expect(card.name).to.equal('n-get');
    });

    it('toA2ACard() preferredTransport is "JSONRPC"', () => {
        const svc  = new CapabilitiesService();
        const card = svc.toA2ACard();
        expect(card.preferredTransport).to.equal('JSONRPC');
    });

    it('toA2ACard() version comes from package.json', () => {
        const svc  = new CapabilitiesService();
        const card = svc.toA2ACard();
        const pkg  = require('../package.json');
        expect(card.version).to.equal(pkg.version);
    });

    it('toA2ACard() accepts an endpointUrl override', () => {
        const svc  = new CapabilitiesService();
        const card = svc.toA2ACard('https://api.example.com/a2a');
        expect(card.url).to.equal('https://api.example.com/a2a');
    });

    it('toA2ACard() uses placeholder URL when no endpointUrl supplied', () => {
        const svc  = new CapabilitiesService();
        const card = svc.toA2ACard();
        expect(card.url).to.be.a('string');
        expect(card.url.length).to.be.greaterThan(0);
    });

    it('toA2ACard() capabilities object includes streaming: true', () => {
        const svc  = new CapabilitiesService();
        const card = svc.toA2ACard();
        expect(card.capabilities).to.deep.include({ streaming: true });
    });

    // ── 3. Skills ─────────────────────────────────────────────────────────────

    it('toA2ACard() skills array has exactly 3 entries', () => {
        const svc  = new CapabilitiesService();
        const card = svc.toA2ACard();
        expect(card.skills).to.be.an('array').with.length(3);
    });

    it('toA2ACard() includes "download" skill with required fields', () => {
        const svc    = new CapabilitiesService();
        const card   = svc.toA2ACard();
        const skill  = card.skills.find(s => s.id === 'download');
        expect(skill, 'download skill not found').to.exist;
        expect(skill).to.have.property('id', 'download');
        expect(skill).to.have.property('name').that.is.a('string');
        expect(skill).to.have.property('description').that.is.a('string');
        expect(skill).to.have.property('tags').that.is.an('array').with.length.greaterThan(0);
    });

    it('toA2ACard() includes "batch_download" skill with required fields', () => {
        const svc   = new CapabilitiesService();
        const card  = svc.toA2ACard();
        const skill = card.skills.find(s => s.id === 'batch_download');
        expect(skill, 'batch_download skill not found').to.exist;
        expect(skill).to.have.property('id', 'batch_download');
        expect(skill).to.have.property('name').that.is.a('string');
        expect(skill).to.have.property('description').that.is.a('string');
        expect(skill).to.have.property('tags').that.is.an('array').with.length.greaterThan(0);
    });

    it('toA2ACard() includes "fetch" skill with required fields', () => {
        const svc   = new CapabilitiesService();
        const card  = svc.toA2ACard();
        const skill = card.skills.find(s => s.id === 'fetch');
        expect(skill, 'fetch skill not found').to.exist;
        expect(skill).to.have.property('id', 'fetch');
        expect(skill).to.have.property('name').that.is.a('string');
        expect(skill).to.have.property('description').that.is.a('string');
        expect(skill).to.have.property('tags').that.is.an('array').with.length.greaterThan(0);
    });

    // ── 4. MCP get_agent_card tool ─────────────────────────────────────────────

    it('get_agent_card MCP tool returns object with protocolVersion "0.3.0"', async () => {
        const { client, cleanup } = await connect();
        try {
            const card = await callTool(client, 'get_agent_card');
            expect(card).to.have.property('protocolVersion', '0.3.0');
        } finally {
            await cleanup();
        }
    });

    it('get_agent_card MCP tool returns same structure as toA2ACard()', async () => {
        const { client, cleanup } = await connect();
        try {
            const card = await callTool(client, 'get_agent_card');
            const required = ['name', 'description', 'url', 'preferredTransport', 'skills'];
            for (const field of required) {
                expect(card, `missing field from MCP tool: ${field}`).to.have.property(field);
            }
            expect(card.skills).to.be.an('array').with.length(3);
            const ids = card.skills.map(s => s.id);
            expect(ids).to.include('download');
            expect(ids).to.include('batch_download');
            expect(ids).to.include('fetch');
        } finally {
            await cleanup();
        }
    });

    it('get_agent_card MCP tool accepts endpoint_url override', async () => {
        const { client, cleanup } = await connect();
        try {
            const card = await callTool(client, 'get_agent_card', { endpoint_url: 'https://my.host/a2a' });
            expect(card.url).to.equal('https://my.host/a2a');
        } finally {
            await cleanup();
        }
    });

    // ── 5. --capabilities discovery section includes a2a ──────────────────────

    it('getDiscoveryInfo() includes an "a2a" key', () => {
        const svc  = new CapabilitiesService();
        const disc = svc.getDiscoveryInfo();
        expect(disc).to.have.property('a2a');
    });

    it('discovery.a2a.protocolVersion is "0.3.0"', () => {
        const svc  = new CapabilitiesService();
        const disc = svc.getDiscoveryInfo();
        expect(disc.a2a).to.have.property('protocolVersion', '0.3.0');
    });

    it('discovery.a2a.command references --agent-card flag', () => {
        const svc  = new CapabilitiesService();
        const disc = svc.getDiscoveryInfo();
        expect(disc.a2a.command).to.include('--agent-card');
    });

    it('getCapabilities() discovery section includes a2a key', () => {
        const svc  = new CapabilitiesService();
        const caps = svc.getCapabilities();
        expect(caps.discovery).to.have.property('a2a');
    });

});
