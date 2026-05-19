'use strict';
/**
 * @fileoverview CLI output contract tests.
 *
 * Locks down the structural contract of the public CLI surface — what
 * agents depend on existing. These are NOT snapshot tests: they assert
 * required sections, flag names, and JSON keys, but tolerate cosmetic
 * edits (spacing, emoji, copy tweaks).
 *
 * If you add a new flag, new capability key, or new event type, update
 * this file to add it to the required set.
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { expect } = require('chai');

const packageJson = require('../package.json');

const projectRoot = path.join(__dirname, '..');
const cli = path.join(projectRoot, 'index.js');

function runCli(args) {
    return execFileSync(process.execPath, [cli, ...args], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

describe('CLI output contract', () => {

    // ── --help ───────────────────────────────────────────────────────────────

    describe('nget --help', () => {

        let stdout;
        before(() => {
            stdout = runCli(['--help']);
        });

        it('is non-empty', () => {
            expect(stdout).to.be.a('string').and.not.empty;
        });

        it('contains the Usage banner', () => {
            expect(stdout).to.match(/Usage:\s+nget/);
        });

        it('documents every flag agents may rely on', () => {
            const requiredFlags = [
                '--capabilities',
                '--openapi-spec',
                '--agent-id',
                '--session-id',
                '--request-id',
                '--conversation-id',
                '--human',
                '--metadata',
                '--checksums',
                '--no-resume',
                '--output-format',
                '-d',
                '-c'
            ];
            requiredFlags.forEach(flag => {
                expect(stdout, `--help missing flag: ${flag}`).to.include(flag);
            });
        });

        it('lists the resume / config / jobs subcommands', () => {
            expect(stdout).to.match(/nget resume/);
            expect(stdout).to.match(/nget config/);
            expect(stdout).to.match(/nget jobs/);
        });

        it('shows at least one Examples block with a concrete invocation', () => {
            expect(stdout).to.match(/Examples?:/);
            expect(stdout).to.match(/nget\s+https?:\/\//);
        });

        it('--help output contains all long flag names from getCapabilities().cli.flags', () => {
            const CapabilitiesService = require('../lib/services/CapabilitiesService');
            const svc = new CapabilitiesService();
            const flags = svc.getCLIFlags();
            flags.forEach(f => {
                expect(stdout, `--help missing --${f.long}`).to.include(`--${f.long}`);
            });
        });
    });

    // ── --capabilities ───────────────────────────────────────────────────────

    describe('nget --capabilities', () => {

        let capabilities;
        before(() => {
            const stdout = runCli(['--capabilities']);
            capabilities = JSON.parse(stdout);
        });

        it('parses as JSON', () => {
            expect(capabilities).to.be.an('object');
        });

        it('has every required top-level key', () => {
            const required = [
                'tool', 'protocols', 'features', 'authentication',
                'output', 'configuration', 'limits', 'agentIntegration',
                'reliability', 'cli', 'discovery', 'examples',
                'schemas', '_metadata'
            ];
            required.forEach(key => {
                expect(capabilities, `missing top-level key: ${key}`).to.have.property(key);
            });
        });

        it('tool.name === "n-get" and version matches package.json', () => {
            expect(capabilities.tool.name).to.equal('n-get');
            expect(capabilities.tool.version).to.equal(packageJson.version);
        });

        it('protocols.supported includes http, https, sftp', () => {
            expect(capabilities.protocols.supported).to.include.members(['http', 'https', 'sftp']);
        });

        it('discovery section has all four commands + ndjsonEvents + outputModes', () => {
            expect(capabilities.discovery).to.have.all.keys(
                'help', 'capabilities', 'openapi', 'mcp', 'ndjsonEvents', 'outputModes'
            );
        });

        it('discovery.ndjsonEvents lists all 9 event types', () => {
            const expected = [
                'session_start', 'download_queued', 'download_start', 'progress',
                'checksum_start', 'checksum_complete', 'download_complete',
                'download_error', 'session_end'
            ];
            expect(capabilities.discovery.ndjsonEvents).to.have.members(expected);
        });

        it('examples.canonical is a non-empty array of {description, command} entries', () => {
            expect(capabilities.examples.canonical).to.be.an('array').that.is.not.empty;
            capabilities.examples.canonical.forEach((entry, i) => {
                expect(entry, `canonical[${i}].description`).to.have.property('description').that.is.a('string').and.not.empty;
                expect(entry, `canonical[${i}].command`).to.have.property('command').that.is.a('string').and.not.empty;
            });
        });

        it('agentIntegration.compatibility.mcp === "supported"', () => {
            expect(capabilities.agentIntegration.compatibility.mcp).to.equal('supported');
        });

        it('agentIntegration.discovery.openapi === "supported"', () => {
            expect(capabilities.agentIntegration.discovery.openapi).to.equal('supported');
        });
    });

    // ── --openapi-spec ───────────────────────────────────────────────────────

    describe('nget --openapi-spec', () => {

        let spec;
        before(() => {
            const stdout = runCli(['--openapi-spec']);
            spec = JSON.parse(stdout);
        });

        it('parses as JSON', () => {
            expect(spec).to.be.an('object');
        });

        it('declares openapi 3.0.x', () => {
            expect(spec.openapi).to.match(/^3\.0\./);
        });

        it('has info, paths, components keys', () => {
            expect(spec).to.have.all.keys('openapi', 'info', 'paths', 'components', 'servers', 'tags', 'externalDocs');
        });

        it('info.title mentions n-get', () => {
            expect(spec.info.title).to.match(/n-?get/i);
        });

        it('info.version matches package.json', () => {
            expect(spec.info.version).to.equal(packageJson.version);
        });

        it('paths has at least one entry', () => {
            expect(Object.keys(spec.paths)).to.have.length.greaterThan(0);
        });
    });
});
