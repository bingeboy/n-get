'use strict';
/**
 * @fileoverview Tests for the A2A 1.0 Agent Card.
 *
 * Asserts the published contract from the A2A specification, not a snapshot of
 * whatever the builder currently emits:
 *
 *   §4.4.1 AgentCard    — required: name, description, supportedInterfaces,
 *                         version, capabilities, defaultInputModes,
 *                         defaultOutputModes, skills.
 *                         There is NO top-level protocolVersion and NO
 *                         top-level url in 1.0.
 *   §4.4.6 AgentInterface — required: url, protocolBinding, protocolVersion.
 *   §3.6   Versioning    — Major.Minor only; no patch component on the wire.
 *   Appendix A.2.1       — the `kind` discriminator was removed in 1.0.
 *
 * Regression guard: 3.0.0 shipped a card claiming protocolVersion "1.0" while
 * emitting the 0.3 field shape (id / protocolVersion / url / interfaces at the
 * top level). A conformant 1.0 client fails required-field validation on that.
 *
 * Also covers the get_agent_card MCP tool, which must return the same shape,
 * and the --capabilities discovery section.
 */

const { createServer }      = require('../lib/mcp/server.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client }            = require('@modelcontextprotocol/sdk/client/index.js');
const CapabilitiesService   = require('../lib/services/CapabilitiesService');

// ─── Contract constants (from the A2A 1.0 specification) ─────────────────────

/** AgentCard members the spec marks Required (§4.4.1). */
const REQUIRED_CARD_FIELDS = [
    'name',
    'description',
    'supportedInterfaces',
    'version',
    'capabilities',
    'defaultInputModes',
    'defaultOutputModes',
    'skills',
];

/**
 * Members that must NOT appear on a 1.0 AgentCard. `protocolVersion` and
 * `url` moved into AgentInterface; `id` and `interfaces` are not 1.0 members
 * at all; `kind` was removed protocol-wide in Appendix A.2.1.
 */
const FORBIDDEN_CARD_FIELDS = [
    'id',
    'protocolVersion',
    'url',
    'interfaces',
    'additionalInterfaces',
    'kind',
];

/** AgentInterface members the spec marks Required (§4.4.6). */
const REQUIRED_INTERFACE_FIELDS = ['url', 'protocolBinding', 'protocolVersion'];

const EXPECTED_SKILL_IDS = ['download', 'batch_download', 'fetch'];

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

function card(endpointUrl) {
    return new CapabilitiesService().toA2ACard(endpointUrl);
}

/**
 * Shared contract assertions, run against both the library builder and the
 * MCP tool so the two surfaces cannot drift.
 */
function assertCardConforms(c) {
    for (const field of REQUIRED_CARD_FIELDS) {
        expect(c, `A2A 1.0 requires top-level "${field}"`).to.have.property(field);
    }
    for (const field of FORBIDDEN_CARD_FIELDS) {
        expect(c, `"${field}" is not an A2A 1.0 top-level AgentCard member`)
            .to.not.have.property(field);
    }

    expect(c.supportedInterfaces).to.be.an('array').with.length.greaterThan(0);
    for (const iface of c.supportedInterfaces) {
        expect(iface).to.be.an('object');
        for (const field of REQUIRED_INTERFACE_FIELDS) {
            expect(iface, `AgentInterface requires "${field}"`).to.have.property(field);
        }
        expect(iface.url).to.be.a('string').with.length.greaterThan(0);
        expect(iface.protocolBinding).to.be.a('string').with.length.greaterThan(0);
        // §3.6 — Major.Minor only, no patch component.
        expect(iface.protocolVersion).to.match(/^\d+\.\d+$/);
        expect(iface).to.not.have.property('kind');
        expect(iface).to.not.have.property('transport');
    }

    expect(c.skills).to.be.an('array').with.length.greaterThan(0);
    for (const skill of c.skills) {
        expect(skill).to.have.property('id').that.is.a('string');
        expect(skill).to.have.property('name').that.is.a('string');
        expect(skill).to.have.property('description').that.is.a('string');
        expect(skill).to.have.property('tags').that.is.an('array').with.length.greaterThan(0);
        expect(skill).to.not.have.property('kind');
    }
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('A2A 1.0 Agent Card', () => {

    // ── 1. Required / forbidden top-level members (§4.4.1) ────────────────────

    it('includes every required top-level AgentCard member', () => {
        const c = card();
        for (const field of REQUIRED_CARD_FIELDS) {
            expect(c, `missing required field: ${field}`).to.have.property(field);
        }
    });

    it('omits every member A2A 1.0 removed from the top level', () => {
        const c = card();
        for (const field of FORBIDDEN_CARD_FIELDS) {
            expect(c, `card still emits 0.3-era field: ${field}`).to.not.have.property(field);
        }
    });

    it('declares no top-level protocolVersion — 1.0 moved it into AgentInterface', () => {
        expect(card()).to.not.have.property('protocolVersion');
    });

    it('declares no top-level url — 1.0 moved it into AgentInterface', () => {
        expect(card()).to.not.have.property('url');
    });

    it('name is "n-get"', () => {
        expect(card().name).to.equal('n-get');
    });

    it('description is a non-empty string', () => {
        expect(card().description).to.be.a('string').with.length.greaterThan(0);
    });

    it('version comes from package.json', () => {
        expect(card().version).to.equal(require('../package.json').version);
    });

    it('is JSON-serialisable with no undefined members', () => {
        const c = card();
        const round = JSON.parse(JSON.stringify(c));
        expect(round).to.deep.equal(c);
    });

    // ── 2. supportedInterfaces (§4.4.6) ───────────────────────────────────────

    it('supportedInterfaces is a non-empty array of objects', () => {
        const c = card();
        expect(c.supportedInterfaces).to.be.an('array').with.length.greaterThan(0);
        for (const iface of c.supportedInterfaces) {
            expect(iface).to.be.an('object');
        }
    });

    it('every supportedInterfaces entry carries url, protocolBinding and protocolVersion', () => {
        for (const iface of card().supportedInterfaces) {
            for (const field of REQUIRED_INTERFACE_FIELDS) {
                expect(iface, `interface missing required field: ${field}`)
                    .to.have.property(field).that.is.a('string');
            }
        }
    });

    it('interface protocolVersion is "1.0" with no patch component (§3.6)', () => {
        for (const iface of card().supportedInterfaces) {
            expect(iface.protocolVersion).to.equal('1.0');
            expect(iface.protocolVersion).to.match(/^\d+\.\d+$/);
        }
    });

    it('interface protocolBinding is "JSONRPC" — not the 0.3 "transport" key', () => {
        const [iface] = card().supportedInterfaces;
        expect(iface.protocolBinding).to.equal('JSONRPC');
        expect(iface).to.not.have.property('transport');
    });

    it('endpointUrl override lands on the interface url, not the top level', () => {
        const c = card('https://api.example.com/a2a');
        expect(c.supportedInterfaces[0].url).to.equal('https://api.example.com/a2a');
        expect(c).to.not.have.property('url');
    });

    it('falls back to a placeholder interface url when no endpointUrl is supplied', () => {
        const [iface] = card().supportedInterfaces;
        expect(iface.url).to.be.a('string').with.length.greaterThan(0);
    });

    it('capabilities object includes streaming: true', () => {
        expect(card().capabilities).to.deep.include({ streaming: true });
    });

    it('defaultInputModes and defaultOutputModes are non-empty string arrays', () => {
        const c = card();
        for (const key of ['defaultInputModes', 'defaultOutputModes']) {
            expect(c[key], key).to.be.an('array').with.length.greaterThan(0);
            for (const mode of c[key]) {
                expect(mode).to.be.a('string').with.length.greaterThan(0);
            }
        }
    });

    // ── 3. Appendix A.2.1 — `kind` discriminator removed ──────────────────────

    it('emits no "kind" discriminator anywhere in the card', () => {
        const serialised = JSON.stringify(card());
        expect(serialised).to.not.include('"kind"');
    });

    // ── 4. Skills ─────────────────────────────────────────────────────────────

    it('skills array has exactly 3 entries', () => {
        expect(card().skills).to.be.an('array').with.length(3);
    });

    for (const id of EXPECTED_SKILL_IDS) {
        it(`includes "${id}" skill with id, name, description and tags`, () => {
            const skill = card().skills.find(s => s.id === id);
            expect(skill, `${id} skill not found`).to.exist;
            expect(skill).to.have.property('id', id);
            expect(skill).to.have.property('name').that.is.a('string').with.length.greaterThan(0);
            expect(skill).to.have.property('description').that.is.a('string').with.length.greaterThan(0);
            expect(skill).to.have.property('tags').that.is.an('array').with.length.greaterThan(0);
        });
    }

    // ── 5. Full contract, in one assertion ────────────────────────────────────

    it('toA2ACard() conforms to the A2A 1.0 AgentCard contract', () => {
        assertCardConforms(card());
    });

    it('toA2ACard(endpointUrl) conforms to the A2A 1.0 AgentCard contract', () => {
        assertCardConforms(card('https://my.host/a2a'));
    });

    // ── 6. MCP get_agent_card tool must match ─────────────────────────────────

    it('get_agent_card MCP tool conforms to the A2A 1.0 AgentCard contract', async () => {
        const { client, cleanup } = await connect();
        try {
            assertCardConforms(await callTool(client, 'get_agent_card'));
        } finally {
            await cleanup();
        }
    });

    it('get_agent_card MCP tool returns the same shape as toA2ACard()', async () => {
        const { client, cleanup } = await connect();
        try {
            const fromTool = await callTool(client, 'get_agent_card');
            expect(Object.keys(fromTool).sort()).to.deep.equal(Object.keys(card()).sort());
            const ids = fromTool.skills.map(s => s.id);
            for (const id of EXPECTED_SKILL_IDS) {
                expect(ids).to.include(id);
            }
        } finally {
            await cleanup();
        }
    });

    it('get_agent_card MCP tool puts endpoint_url on the interface, not the top level', async () => {
        const { client, cleanup } = await connect();
        try {
            const c = await callTool(client, 'get_agent_card', { endpoint_url: 'https://my.host/a2a' });
            expect(c.supportedInterfaces[0].url).to.equal('https://my.host/a2a');
            expect(c).to.not.have.property('url');
        } finally {
            await cleanup();
        }
    });

    // ── 7. --capabilities discovery section ───────────────────────────────────

    it('getDiscoveryInfo() includes an "a2a" key', () => {
        expect(new CapabilitiesService().getDiscoveryInfo()).to.have.property('a2a');
    });

    it('discovery.a2a.protocolVersion is "1.0"', () => {
        const disc = new CapabilitiesService().getDiscoveryInfo();
        expect(disc.a2a).to.have.property('protocolVersion', '1.0');
    });

    it('discovery.a2a.command references the --agent-card flag', () => {
        const disc = new CapabilitiesService().getDiscoveryInfo();
        expect(disc.a2a.command).to.include('--agent-card');
    });

    it('getCapabilities() discovery section includes the a2a key', () => {
        expect(new CapabilitiesService().getCapabilities().discovery).to.have.property('a2a');
    });

    // ── 8. No stale "0.3" version claims on agent-facing strings ──────────────

    it('--agent-card flag description does not advertise A2A 0.3', () => {
        const flags = new CapabilitiesService().getCLIFlags();
        const flag = flags.find(f => f.long === 'agent-card');
        expect(flag, '--agent-card flag not found').to.exist;
        expect(flag.description).to.not.match(/0\.3/);
        expect(flag.description).to.include('1.0');
    });
});
