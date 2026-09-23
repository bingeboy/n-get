/**
 * @fileoverview Integration tests for piping a download to stdout (#146).
 *
 * These previously drove a `--stdout` flag that no longer exists; it was
 * replaced by `-o -` (`--output-file -`), the conventional spelling. The
 * rewrite also uncovered two real bugs the stale assertions had been masking:
 * NDJSON events were being written to stdout alongside the file content, and
 * `-o -` with several URLs exited 1 with no message at all.
 *
 * The contract under test: stdout carries the file content and nothing else,
 * so `nget -o - <url> | jq .` works. Events go to stderr.
 */

const {spawnSync} = require('node:child_process');
const path = require('node:path');

// Local fixture server (test/fixtures/), started by globalSetup.
const ORIGIN = require('./fixtures/origin').readOrigin();

const REPO_ROOT = path.join(__dirname, '..');

/**
 * Run the CLI, capturing stdout and stderr separately.
 * @param {string[]} args
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function runCli(args) {
    // spawnSync, not execFileSync: the latter returns only stdout on success,
    // and these tests assert on both streams being kept separate.
    const result = spawnSync('node', ['index.js', ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    });
    return {
        status: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

describe('stdout output mode (-o -)', () => {

    describe('stdout carries only the file content', () => {

        it('writes the response body to stdout', () => {
            const {stdout} = runCli(['-o', '-', `${ORIGIN}/json`]);
            expect(stdout).to.include('"slideshow"');
            expect(stdout).to.include('"title"');
        });

        it('produces stdout that parses as JSON', () => {
            // The whole point of -o -. Events on stdout used to break this.
            const {stdout} = runCli(['-o', '-', `${ORIGIN}/json`]);
            expect(() => JSON.parse(stdout)).to.not.throw();
            expect(JSON.parse(stdout)).to.have.property('slideshow');
        });

        it('keeps NDJSON events off stdout', () => {
            const {stdout} = runCli(['-o', '-', `${ORIGIN}/json`]);
            expect(stdout).to.not.include('"event":');
            expect(stdout).to.not.include('session_start');
        });

        it('emits the events on stderr instead', () => {
            const {stderr} = runCli(['-o', '-', `${ORIGIN}/json`]);
            expect(stderr).to.include('"event":"session_start"');
        });

        it('shows no progress bars or banners on stdout', () => {
            const {stdout} = runCli(['-o', '-', `${ORIGIN}/json`]);
            expect(stdout).to.not.include('█');
            expect(stdout).to.not.include('Download Summary');
        });
    });

    describe('works against API-shaped endpoints', () => {

        it('returns a parseable body from /get', () => {
            const {stdout} = runCli(['-o', '-', `${ORIGIN}/get`]);
            const json = JSON.parse(stdout);
            expect(json).to.have.property('url');
            // Previously asserted httpbin.org; the suite now uses a local fixture.
            expect(json.url).to.include(ORIGIN);
        });

        it('returns a parseable body from /uuid', () => {
            const {stdout} = runCli(['-o', '-', `${ORIGIN}/uuid`]);
            expect(JSON.parse(stdout)).to.have.property('uuid');
        });

        it('passes non-JSON content through unaltered', () => {
            const {stdout} = runCli(['-o', '-', `${ORIGIN}/html`]);
            expect(stdout).to.include('<html>');
            expect(stdout).to.not.include('"event":');
        });
    });

    describe('rejects combinations that cannot produce one clean stream', () => {

        it('refuses multiple URLs, with a message on stderr', () => {
            // This exited 1 silently before #146: quietMode is implied by -o -,
            // and the only error path was gated on it.
            const {status, stderr} = runCli(['-o', '-', `${ORIGIN}/json`, `${ORIGIN}/uuid`]);
            expect(status).to.not.equal(0);
            expect(stderr).to.include('Cannot write multiple URLs to stdout');
        });

        it('refuses recursive mode, naming the current flag', () => {
            const {status, stderr} = runCli(['-o', '-', '--recursive', `${ORIGIN}/html`]);
            expect(status).to.not.equal(0);
            expect(stderr).to.include('Recursive mode is not compatible with -o -');
        });

        it('still refuses a named output file with multiple URLs', () => {
            const {status, stderr} = runCli(['-o', 'out.txt', `${ORIGIN}/json`, `${ORIGIN}/uuid`]);
            expect(status).to.not.equal(0);
            expect(stderr).to.include('Cannot use -o with multiple URLs');
        });
    });

    describe('help documents the flag', () => {

        it('advertises -o / --output-file and the "-" convention', () => {
            // The old assertions looked for a --stdout entry. There is no such
            // flag; -o - is the supported spelling and help says so.
            const {stdout} = runCli(['--help']);
            expect(stdout).to.include('--output-file');
            expect(stdout).to.match(/-o, --output-file/);
            expect(stdout.toLowerCase()).to.include('stdout');
        });

        it('does not advertise a --stdout flag', () => {
            const {stdout} = runCli(['--help']);
            expect(stdout).to.not.match(/^\s*--stdout\b/m);
        });
    });
});
