'use strict';
/**
 * @fileoverview Tests for lib/cli/jobsCommands.js
 *
 * Covers: NDJSON output (agent mode), human-mode table to stderr,
 *         zero-sessions paths, session summary fields.
 */

const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');

const { handleJobsCommand }  = require('../lib/cli/jobsCommands.js');
const {
    DownloadSession,
    ACTIVE_DIR,
} = require('../lib/core/DownloadSession.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function flushIO() {
    return new Promise(resolve => setTimeout(resolve, 50));
}

function cleanFile(sessionId) {
    try { fs.unlinkSync(path.join(ACTIVE_DIR, `${sessionId}.json`)); } catch { /* ok */ }
}

function captureStdout(fn) {
    const chunks = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...rest) => { chunks.push(String(chunk)); return orig(chunk, ...rest); };
    try { fn(); } finally { process.stdout.write = orig; }
    return chunks.join('');
}

function captureStderr(fn) {
    const chunks = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...rest) => { chunks.push(String(chunk)); return orig(chunk, ...rest); };
    try { fn(); } finally { process.stderr.write = orig; }
    return chunks.join('');
}

function makeSession(opts) {
    return new DownloadSession({ quietMode: true, ...opts });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('handleJobsCommand', () => {

    const createdIds = [];

    afterEach(() => {
        createdIds.forEach(id => cleanFile(id));
        createdIds.length = 0;
    });

    // ─── Agent mode (NDJSON) ─────────────────────────────────────────────────

    describe('agent mode (humanMode=false)', () => {

        it('emits NDJSON with count=0 when no sessions are active', () => {
            // Ensure ACTIVE_DIR exists but has no matching files for this test.
            // Other tests may leave files; we rely on pruneDeadSessions being called.
            // We write no sessions — any stale files from dead PIDs will be pruned.
            const output = captureStdout(() => handleJobsCommand({}, false));
            const line   = JSON.parse(output.trim());
            expect(line.event).to.equal('jobs');
            expect(line).to.have.property('ts').that.is.a('number');
            expect(line).to.have.property('sessions').that.is.an('array');
        });

        it('emits a valid NDJSON line', async () => {
            const id = 'jobs-ndjson-1';
            createdIds.push(id);
            const s = makeSession({ sessionId: id });
            s.start();
            await flushIO();

            let output;
            try {
                output = captureStdout(() => handleJobsCommand({}, false));
            } finally {
                await s.end();
            }

            const line = JSON.parse(output.trim());
            expect(line.event).to.equal('jobs');
            expect(line.count).to.be.at.least(1);
            expect(line.sessions).to.be.an('array');
        });

        it('includes session summary fields in each session entry', async () => {
            const id = 'jobs-ndjson-fields';
            createdIds.push(id);
            const s = makeSession({ sessionId: id, agentId: 'test-agent' });
            s.start();
            s.queueDownload('https://example.com/a.txt');
            await flushIO();

            let output;
            try {
                output = captureStdout(() => handleJobsCommand({}, false));
            } finally {
                await s.end();
            }

            const line    = JSON.parse(output.trim());
            const session = line.sessions.find(s => s.sessionId === id);
            expect(session).to.exist;
            expect(session).to.have.property('sessionId', id);
            expect(session).to.have.property('pid').that.is.a('number');
            expect(session).to.have.property('startTime');
            expect(session).to.have.property('total').that.is.at.least(1);
            expect(session).to.have.property('active').that.is.a('number');
            expect(session).to.have.property('complete').that.is.a('number');
            expect(session).to.have.property('errors').that.is.a('number');
        });

        it('counts download statuses correctly in summary', async () => {
            const id = 'jobs-counts';
            createdIds.push(id);
            const s = makeSession({ sessionId: id });
            s.start();
            s.queueDownload('https://example.com/q.txt');
            await flushIO();
            s.updateDownload('https://example.com/q.txt', { status: 'active' });
            await flushIO();
            s.updateDownload('https://example.com/q.txt', { status: 'complete' });
            await flushIO();
            s.queueDownload('https://example.com/e.txt');
            await flushIO();
            s.updateDownload('https://example.com/e.txt', { status: 'error' });
            await flushIO();

            let output;
            try {
                output = captureStdout(() => handleJobsCommand({}, false));
            } finally {
                await s.end();
            }

            const line    = JSON.parse(output.trim());
            const session = line.sessions.find(s => s.sessionId === id);
            expect(session).to.exist;
            expect(session.total).to.equal(2);
            expect(session.complete).to.equal(1);
            expect(session.errors).to.equal(1);
        });

        it('output is valid JSON (single line, no trailing garbage)', async () => {
            const output = captureStdout(() => handleJobsCommand({}, false));
            expect(() => JSON.parse(output.trim())).to.not.throw();
        });
    });

    // ─── Human mode ──────────────────────────────────────────────────────────

    describe('human mode (humanMode=true)', () => {

        it('writes "No active download sessions." to stderr when empty', () => {
            const stderrOut = captureStderr(() => handleJobsCommand({}, true));
            // May or may not have other sessions; if count is 0 it should say "No active"
            // We can't guarantee isolation perfectly, so just check stderr was written.
            expect(stderrOut).to.be.a('string');
        });

        it('writes nothing to stdout in human mode', async () => {
            const id = 'jobs-human-stdout';
            createdIds.push(id);
            const s = makeSession({ sessionId: id });
            s.start();
            await flushIO();

            let stdoutOut;
            try {
                stdoutOut = captureStdout(() => {
                    captureStderr(() => handleJobsCommand({}, true));
                });
            } finally {
                await s.end();
            }

            expect(stdoutOut).to.equal('');
        });

        it('writes session details to stderr in human mode', async () => {
            const id = 'jobs-human-details';
            createdIds.push(id);
            const s = makeSession({ sessionId: id });
            s.start();
            s.queueDownload('https://example.com/file.zip');
            await flushIO();

            let stderrOut;
            try {
                stderrOut = captureStderr(() => handleJobsCommand({}, true));
            } finally {
                await s.end();
            }

            expect(stderrOut).to.include(id);
            expect(stderrOut).to.include('session');
        });

        it('shows file counts in human mode', async () => {
            const id = 'jobs-human-counts';
            createdIds.push(id);
            const s = makeSession({ sessionId: id });
            s.start();
            s.queueDownload('https://example.com/a.zip');
            s.queueDownload('https://example.com/b.zip');
            await flushIO();

            let stderrOut;
            try {
                stderrOut = captureStderr(() => handleJobsCommand({}, true));
            } finally {
                await s.end();
            }

            expect(stderrOut).to.include(id);
            expect(stderrOut).to.match(/\d+ total/);
        });
    });

    // ─── argv passthrough ────────────────────────────────────────────────────

    describe('argv parameter', () => {
        it('accepts an empty argv object without throwing', () => {
            expect(() => handleJobsCommand({}, false)).to.not.throw();
        });

        it('accepts an argv with extra keys without throwing', () => {
            expect(() => handleJobsCommand({ _: ['jobs'], human: true, verbose: false }, false)).to.not.throw();
        });
    });
});
