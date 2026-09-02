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

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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

        it('discovery section has all required commands + ndjsonEvents + outputModes + webhooks + a2a', () => {
            const required = ['help', 'capabilities', 'openapi', 'mcp', 'ndjsonEvents', 'outputModes', 'webhooks', 'a2a'];
            required.forEach(key => {
                expect(capabilities.discovery, `missing discovery key: ${key}`).to.have.property(key);
            });
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

        it('agentIntegration.eventDriven.webhooks reports supported and hmac-sha256 signing', () => {
            const webhooks = capabilities.agentIntegration.eventDriven.webhooks;
            // webhooks is now an object (not the old string 'supported')
            expect(webhooks).to.be.an('object');
            expect(webhooks).to.have.property('supported', true);
            expect(webhooks).to.have.property('signing', 'hmac-sha256');
        });

        it('discovery.webhooks has url flag and events array', () => {
            expect(capabilities.discovery).to.have.property('webhooks');
            expect(capabilities.discovery.webhooks).to.have.property('flag');
            expect(capabilities.discovery.webhooks).to.have.property('events');
            expect(capabilities.discovery.webhooks.events).to.be.an('array');
            expect(capabilities.discovery.webhooks.events.length).to.be.greaterThan(0);
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

    // Regression: config-loading output used to land on stdout for these
    // commands, so `JSON.parse` failed on `Unexpected token 'L'`. `--quiet`
    // worked around it, but an agent following AGENTS.md has no reason to
    // pass it. These assert stdout is parseable WITHOUT --quiet — that is the
    // whole point, so do not "fix" a failure here by adding --quiet.
    describe('machine-readable commands emit clean stdout (no --quiet)', () => {

        // Vitest sets NODE_ENV=test, which loads config/test.yaml with
        // logging.level "warn" — that alone silences the config banner. A test
        // inheriting it cannot observe this bug at all. Agents run without
        // NODE_ENV and get the "development" config, so spawn that way instead.
        function runCliAsAgent(args) {
            const env = {...process.env};
            delete env.NODE_ENV;
            return execFileSync(process.execPath, [cli, ...args], {
                cwd: projectRoot,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                env,
            });
        }

        // Whether history is empty is ambient state — the repo root
        // accumulates entries as soon as anyone runs a download there. The
        // original version of this test ran only against the repo root, so it
        // exercised whichever state that happened to be in: it passed locally
        // on a dir with history and failed in CI on a clean checkout, where
        // the empty branch returned "No download history found." as plain text
        // regardless of --output-format. Both states are pinned explicitly
        // below so neither can go unchecked again.
        const tempBase = path.join(__dirname, 'temp');
        let emptyDir;
        let populatedDir;

        before(() => {
            fs.mkdirSync(tempBase, {recursive: true});
            emptyDir = fs.mkdtempSync(path.join(tempBase, 'hist-empty-'));
            populatedDir = fs.mkdtempSync(path.join(tempBase, 'hist-full-'));
            fs.mkdirSync(path.join(populatedDir, '.nget'), {recursive: true});
            fs.writeFileSync(
                path.join(populatedDir, '.nget', 'nget.history'),
                JSON.stringify({
                    timestamp: new Date().toISOString(),
                    url: 'http://example.com/f.bin',
                    filePath: path.join(populatedDir, 'f.bin'),
                    status: 'success',
                    size: 10,
                    duration: 5,
                    error: null,
                    correlationId: 'test-corr',
                    metadata: {},
                    version: '1.0',
                }) + '\n',
            );
        });

        after(() => {
            for (const dir of [emptyDir, populatedDir]) {
                try { fs.rmSync(dir, {recursive: true, force: true}); } catch { /* best effort */ }
            }
        });

        it('history show --output-format json parses when history is EMPTY', () => {
            const out = runCliAsAgent(['history', 'show', '-d', emptyDir, '--output-format', 'json']).trim();
            let parsed;
            expect(() => { parsed = JSON.parse(out); }, 'stdout was not parseable JSON: ' + out.slice(0, 200)).to.not.throw();
            // An empty result is still a result: an empty array, not prose.
            expect(parsed.summary.totalEntries).to.equal(0);
            expect(parsed.entries).to.deep.equal([]);
        });

        it('history show --output-format json parses when history EXISTS', () => {
            const out = runCliAsAgent(['history', 'show', '-d', populatedDir, '--output-format', 'json']).trim();
            let parsed;
            expect(() => { parsed = JSON.parse(out); }, 'stdout was not parseable JSON: ' + out.slice(0, 200)).to.not.throw();
            expect(parsed.summary.totalEntries).to.equal(1);
            expect(parsed.entries[0]).to.have.property('url', 'http://example.com/f.bin');
        });

        it('passing -d does not leak destination UI into structured stdout', () => {
            const out = runCliAsAgent(['history', 'show', '-d', emptyDir, '--output-format', 'json']);
            expect(out).to.not.match(/Moving Directory/);
            expect(out).to.not.match(/Destination set/);
        });

        it('keeps the destination confirmation in text mode', () => {
            // The human path is not a payload — this feedback should survive.
            const out = runCliAsAgent(['history', 'show', '-d', emptyDir]);
            expect(out).to.match(/Destination set/);
            expect(out).to.match(/No download history found/);
        });

        it('nget jobs emits a single parseable NDJSON line', () => {
            const out = runCliAsAgent(['jobs']).trim();
            expect(() => JSON.parse(out), `stdout was not parseable JSON:\n${out.slice(0, 200)}`).to.not.throw();
            expect(JSON.parse(out)).to.have.property('event', 'jobs');
        });

        it('nget history show --output-format json is parseable', () => {
            const out = runCliAsAgent(['history', 'show', '--output-format', 'json']).trim();
            expect(() => JSON.parse(out), `stdout was not parseable JSON:\n${out.slice(0, 200)}`).to.not.throw();
        });

        // `config` pollutes stdout from two managers, not one: the one index.js
        // builds, and the separate one configCommands builds for itself. The
        // latter used to silence itself only for --quiet, so fixing the former
        // alone left this command just as unparseable.
        it('nget config show --output-format json is parseable', () => {
            const out = runCliAsAgent(['config', 'show', '--output-format', 'json']).trim();
            expect(() => JSON.parse(out), 'stdout was not parseable JSON: ' + out.slice(0, 200)).to.not.throw();
        });

        it('nget config show --output-format yaml carries no config banner', () => {
            const out = runCliAsAgent(['config', 'show', '--output-format', 'yaml']);
            expect(out).to.not.match(/Loaded configuration from/);
            expect(out).to.match(/^operation: config/m);
        });

        // The human path is deliberately untouched: text output is not a
        // payload, and config validate must keep reporting in full.
        it('leaves text-mode config output alone', () => {
            const out = runCliAsAgent(['config', 'validate']);
            expect(out).to.match(/Configuration is valid/);
            expect(out).to.match(/Critical Sections/);
        });

        it('stdout carries no config-loading banner', () => {
            const cases = [
                ['jobs'],
                ['history', 'show', '--output-format', 'json'],
                ['config', 'show', '--output-format', 'json'],
            ];
            for (const args of cases) {
                expect(runCliAsAgent(args), `leaked config output: nget ${args.join(' ')}`)
                    .to.not.match(/Loaded configuration from/);
            }
        });
    });
});
