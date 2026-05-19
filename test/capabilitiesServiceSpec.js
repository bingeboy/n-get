'use strict';
/**
 * @fileoverview Tests for lib/services/CapabilitiesService.js
 *
 * Covers:
 *   getCapabilities()     — shape, top-level keys, discovery section, examples.canonical
 *   getDiscoveryInfo()    — all required keys, ndjsonEvents array, outputModes
 *   getUsageExamples()    — existing nested shape preserved, canonical array added
 *   getAgentIntegration() — mcp and openapi fields reflect shipped state
 */

const CapabilitiesService = require('../lib/services/CapabilitiesService');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeService() {
    return new CapabilitiesService();
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('CapabilitiesService', () => {

    // ── getCapabilities ───────────────────────────────────────────────────────

    describe('getCapabilities()', () => {

        it('returns an object with all expected top-level keys', () => {
            const svc  = makeService();
            const caps = svc.getCapabilities();
            const required = [
                'tool', 'protocols', 'features', 'authentication',
                'output', 'configuration', 'limits', 'agentIntegration',
                'reliability', 'cli', 'discovery', '_metadata'
            ];
            required.forEach(key => {
                expect(caps, `missing key: ${key}`).to.have.property(key);
            });
        });

        it('discovery section appears between cli and _metadata (key order)', () => {
            const svc  = makeService();
            const caps = svc.getCapabilities();
            const keys = Object.keys(caps);
            const cliIdx       = keys.indexOf('cli');
            const discoveryIdx = keys.indexOf('discovery');
            const metaIdx      = keys.indexOf('_metadata');
            expect(cliIdx).to.be.lessThan(discoveryIdx, 'cli should come before discovery');
            expect(discoveryIdx).to.be.lessThan(metaIdx, 'discovery should come before _metadata');
        });

        it('includes examples and schemas when detailed=true (default)', () => {
            const svc  = makeService();
            const caps = svc.getCapabilities({ detailed: true });
            expect(caps).to.have.property('examples');
            expect(caps).to.have.property('schemas');
        });

        it('omits examples and schemas when detailed=false', () => {
            const svc  = makeService();
            const caps = svc.getCapabilities({ detailed: false });
            expect(caps).to.not.have.property('examples');
            expect(caps).to.not.have.property('schemas');
        });
    });

    // ── discovery section ─────────────────────────────────────────────────────

    describe('discovery section', () => {

        let discovery;
        before(() => {
            discovery = makeService().getCapabilities().discovery;
        });

        it('has help entry with command and description', () => {
            expect(discovery).to.have.property('help');
            expect(discovery.help).to.have.property('command', 'nget --help');
            expect(discovery.help).to.have.property('description').that.is.a('string').and.is.not.empty;
        });

        it('has capabilities entry with command and description', () => {
            expect(discovery).to.have.property('capabilities');
            expect(discovery.capabilities).to.have.property('command', 'nget --capabilities');
            expect(discovery.capabilities).to.have.property('description').that.is.a('string').and.is.not.empty;
        });

        it('has openapi entry with command and description', () => {
            expect(discovery).to.have.property('openapi');
            expect(discovery.openapi).to.have.property('command', 'nget --openapi-spec');
            expect(discovery.openapi).to.have.property('description').that.is.a('string').and.is.not.empty;
        });

        it('has mcp entry with command and description', () => {
            expect(discovery).to.have.property('mcp');
            expect(discovery.mcp).to.have.property('command', 'nget-mcp');
            expect(discovery.mcp).to.have.property('description').that.is.a('string').and.is.not.empty;
        });

        it('ndjsonEvents is an array of 9 event name strings', () => {
            expect(discovery).to.have.property('ndjsonEvents').that.is.an('array');
            expect(discovery.ndjsonEvents).to.have.length(9);
            const expected = [
                'session_start', 'download_queued', 'download_start', 'progress',
                'checksum_start', 'checksum_complete', 'download_complete',
                'download_error', 'session_end'
            ];
            expected.forEach(ev => {
                expect(discovery.ndjsonEvents, `missing event: ${ev}`).to.include(ev);
            });
        });

        it('outputModes has tty, nonTty, and forceHuman keys', () => {
            expect(discovery).to.have.property('outputModes');
            expect(discovery.outputModes).to.have.property('tty').that.is.a('string').and.is.not.empty;
            expect(discovery.outputModes).to.have.property('nonTty').that.is.a('string').and.is.not.empty;
            expect(discovery.outputModes).to.have.property('forceHuman').that.is.a('string').and.is.not.empty;
        });
    });

    // ── examples.canonical ────────────────────────────────────────────────────

    describe('examples.canonical', () => {

        let examples;
        before(() => {
            examples = makeService().getCapabilities().examples;
        });

        it('canonical is an array', () => {
            expect(examples).to.have.property('canonical').that.is.an('array');
        });

        it('canonical has at least 5 entries', () => {
            expect(examples.canonical.length).to.be.at.least(5);
        });

        it('each canonical entry has description and command strings', () => {
            examples.canonical.forEach((entry, i) => {
                expect(entry, `entry ${i} missing description`).to.have.property('description').that.is.a('string').and.is.not.empty;
                expect(entry, `entry ${i} missing command`).to.have.property('command').that.is.a('string').and.is.not.empty;
            });
        });

        it('existing nested keys (basic, agent, batch, advanced) are preserved', () => {
            ['basic', 'agent', 'batch', 'advanced'].forEach(key => {
                expect(examples, `missing examples.${key}`).to.have.property(key).that.is.an('object');
            });
        });
    });

    // ── agentIntegration — shipped fields ─────────────────────────────────────

    describe('agentIntegration compatibility fields', () => {

        let agentIntegration;
        before(() => {
            agentIntegration = makeService().getCapabilities().agentIntegration;
        });

        it('mcp is "supported" (not "planned")', () => {
            expect(agentIntegration.compatibility).to.have.property('mcp', 'supported');
        });

        it('openapi is "supported" (not false)', () => {
            expect(agentIntegration.discovery).to.have.property('openapi', 'supported');
        });
    });

    // ── toMarkdown ────────────────────────────────────────────────────────────

    describe('toMarkdown()', () => {

        let md;
        before(() => {
            md = makeService().toMarkdown();
        });

        it('returns a non-empty string', () => {
            expect(md).to.be.a('string').and.not.empty;
        });

        it('starts with the n-get header and includes version + license', () => {
            expect(md).to.match(/^# n-get/);
            expect(md).to.include('**Version:**');
            expect(md).to.include('**License:**');
        });

        it('renders the Quick start section with canonical examples', () => {
            expect(md).to.include('## Quick start');
            expect(md).to.include('Download a single file');
            expect(md).to.include('nget https://example.com/file.zip');
        });

        it('renders the Discovery surfaces table with all four entries', () => {
            expect(md).to.include('## Discovery surfaces');
            expect(md).to.include('nget --help');
            expect(md).to.include('nget --capabilities');
            expect(md).to.include('nget --openapi-spec');
            expect(md).to.include('nget-mcp');
        });

        it('lists all 9 NDJSON event types in the event stream section', () => {
            expect(md).to.include('## NDJSON event stream');
            const events = [
                'session_start', 'download_queued', 'download_start', 'progress',
                'checksum_start', 'checksum_complete', 'download_complete',
                'download_error', 'session_end'
            ];
            events.forEach(e => {
                expect(md, `missing event: ${e}`).to.include('`' + e + '`');
            });
        });

        it('documents the programmatic API exports', () => {
            expect(md).to.include('## Programmatic API');
            expect(md).to.include('nget.capabilities');
            expect(md).to.include('nget.openapi');
            expect(md).to.include('nget.instructions');
            expect(md).to.include('nget.fetch');
        });

        it('includes the MCP integration section with the Claude Desktop snippet', () => {
            expect(md).to.include('## MCP integration');
            expect(md).to.include('"command": "nget-mcp"');
        });

        it('output is deterministic (same input → same output)', () => {
            const a = makeService().toMarkdown();
            const b = makeService().toMarkdown();
            expect(a).to.equal(b);
        });
    });

    // ── cli.flags ────────────────────────────────────────────────────────────────

    describe('getCLIFlags()', () => {

        let flags;
        before(() => {
            flags = makeService().getCLIFlags();
        });

        it('returns a non-empty array', () => {
            expect(flags).to.be.an('array').with.length.greaterThan(0);
        });

        it('every entry has long and description strings', () => {
            flags.forEach((f, i) => {
                expect(f, `entry ${i} missing long`).to.have.property('long').that.is.a('string').and.is.not.empty;
                expect(f, `entry ${i} missing description`).to.have.property('description').that.is.a('string').and.is.not.empty;
            });
        });

        it('every entry has a valid group', () => {
            const valid = new Set(['general', 'pipe', 'recursive', 'ssh', 'agent', 'webhook']);
            flags.forEach((f, i) => {
                expect(valid.has(f.group), `entry ${i} has invalid group: ${f.group}`).to.be.true;
            });
        });

        it('contains the key agent flags', () => {
            const longs = flags.map(f => f.long);
            ['agent-id', 'session-id', 'request-id', 'conversation-id',
             'capabilities', 'openapi-spec', 'webhook'].forEach(flag => {
                expect(longs, `missing flag: ${flag}`).to.include(flag);
            });
        });

        it('getCapabilities().cli.flags is populated from getCLIFlags()', () => {
            const svc = makeService();
            const caps = svc.getCapabilities();
            expect(caps.cli).to.have.property('flags').that.is.an('array').with.length.greaterThan(0);
            expect(caps.cli.flags.length).to.equal(svc.getCLIFlags().length);
        });
    });

    // ── toHelpSummary ─────────────────────────────────────────────────────────────

    describe('toHelpSummary()', () => {

        let summary;
        before(() => {
            summary = makeService().toHelpSummary();
        });

        it('returns a non-empty string', () => {
            expect(summary).to.be.a('string').and.is.not.empty;
        });

        it('contains Usage: line', () => {
            expect(summary).to.include('Usage: nget');
        });

        it('contains AI agents discovery block', () => {
            expect(summary).to.include('AI agents — start here:');
            expect(summary).to.include('nget --capabilities');
            expect(summary).to.include('nget fetch');
            expect(summary).to.include('nget-mcp');
        });

        it('contains section headers for each group', () => {
            ['General Options', 'Pipe Options', 'Recursive Download Options',
             'SSH/SFTP Options', 'AI Agent Integration Options', 'Webhook Options'].forEach(section => {
                expect(summary, `missing section: ${section}`).to.include(section);
            });
        });

        it('contains all long flag names', () => {
            const svc = makeService();
            svc.getCLIFlags().forEach(f => {
                expect(summary, `missing flag: --${f.long}`).to.include(`--${f.long}`);
            });
        });

        it('contains Examples: section', () => {
            expect(summary).to.include('Examples:');
        });

        it('is deterministic (same output on repeated calls)', () => {
            const a = makeService().toHelpSummary();
            const b = makeService().toHelpSummary();
            expect(a).to.equal(b);
        });
    });
});
