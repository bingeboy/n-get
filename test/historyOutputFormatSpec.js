'use strict';
/**
 * @fileoverview Regression tests for --output-format across history subcommands (#179).
 *
 * `--capabilities` advertises --output-format globally and `history show`
 * honoured it, but `history stats` and `history search` printed emoji-decorated
 * prose regardless. An agent asking for JSON got something that would not parse
 * — the same failure #157 fixed for the empty-history and -d cases, in the two
 * subcommands that sweep missed.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');

let tmpDir;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-histfmt-'));
});

afterEach(() => {
    try {
        fs.rmSync(tmpDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 50});
    } catch { /* Windows can hold brief locks */ }
});

/**
 * Run the CLI and capture both streams.
 * @param {string[]} args
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function runCli(args) {
    const result = spawnSync('node', ['index.js', ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {...process.env, NODE_ENV: 'test'},
    });
    return {
        status: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

describe('history --output-format (#179)', () => {

    // Each subcommand is exercised against an empty history directory on
    // purpose: an empty result is the case an agent hits first in a fresh
    // environment, and it is exactly where the text fallback used to leak.
    const SUBCOMMANDS = [
        {name: 'show', args: ['history', 'show'], operation: 'history'},
        {name: 'search', args: ['history', 'search', 'nothing-matches-this'], operation: 'history'},
        {name: 'stats', args: ['history', 'stats'], operation: 'history_stats'},
    ];

    describe('json', () => {

        for (const {name, args, operation} of SUBCOMMANDS) {
            it(`${name} emits parseable JSON`, () => {
                const {stdout} = runCli([...args, '-d', tmpDir, '--output-format', 'json']);
                expect(() => JSON.parse(stdout), `stdout was: ${stdout.slice(0, 200)}`).to.not.throw();
                expect(JSON.parse(stdout).operation).to.equal(operation);
            });

            it(`${name} emits no prose alongside the JSON`, () => {
                const {stdout} = runCli([...args, '-d', tmpDir, '--output-format', 'json']);
                expect(stdout).to.not.include('📈');
                expect(stdout).to.not.include('🔍');
                expect(stdout).to.not.include('No download history found');
            });
        }
    });

    describe('yaml', () => {

        for (const {name, args, operation} of SUBCOMMANDS) {
            it(`${name} emits yaml with an operation key`, () => {
                const {stdout} = runCli([...args, '-d', tmpDir, '--output-format', 'yaml']);
                expect(stdout).to.match(new RegExp(`^operation: ${operation}$`, 'm'));
            });
        }
    });

    describe('text mode keeps its human output', () => {

        it('stats still prints a readable summary', () => {
            const {stdout} = runCli(['history', 'stats', '-d', tmpDir]);
            expect(stdout).to.include('Download Statistics');
        });

        it('search still says when nothing matched', () => {
            const {stdout} = runCli(['history', 'search', 'nothing-matches-this', '-d', tmpDir]);
            expect(stdout).to.include('No downloads found matching');
        });

        it('show still says when there is no history', () => {
            const {stdout} = runCli(['history', 'show', '-d', tmpDir]);
            expect(stdout).to.include('No download history found');
        });
    });
});
