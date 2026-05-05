'use strict';
/**
 * @fileoverview Tests for lib/core/DownloadSession.js
 *
 * Covers: constructor, start(), end(), queueDownload(), updateDownload(),
 *         completeDownload(), failDownload(), _flushStatus() guard,
 *         readActiveSessions(), pruneDeadSessions().
 */

const { expect } = require('chai');
const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');

const {
    DownloadSession,
    ACTIVE_DIR,
    readActiveSessions,
    pruneDeadSessions,
} = require('../lib/core/DownloadSession.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Wait for the async fire-and-forget fs.writeFile to settle. */
function flushIO() {
    return new Promise(resolve => setTimeout(resolve, 50));
}

/** Read the status JSON written by a session (synchronous, after flushIO). */
function readStatusFile(sessionId) {
    const file = path.join(ACTIVE_DIR, `${sessionId}.json`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Remove a session's status file if it exists (cleanup). */
function cleanFile(sessionId) {
    try { fs.unlinkSync(path.join(ACTIVE_DIR, `${sessionId}.json`)); } catch { /* ok */ }
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('DownloadSession', () => {

    // Track every session created so we can clean up their files afterwards.
    const createdIds = [];

    afterEach(() => {
        createdIds.forEach(id => cleanFile(id));
        createdIds.length = 0;
    });

    function makeSession(opts = {}) {
        const s = new DownloadSession(opts);
        createdIds.push(s.id);
        return s;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    describe('constructor', () => {
        it('uses provided sessionId', () => {
            const s = makeSession({ sessionId: 'test-fixed-id' });
            expect(s.id).to.equal('test-fixed-id');
        });

        it('generates an id when none is provided', () => {
            const s = makeSession();
            expect(s.id).to.be.a('string').and.to.match(/^sess_\d+_[0-9a-f]{8}$/);
        });

        it('sets agentId from options', () => {
            const s = makeSession({ agentId: 'my-agent' });
            expect(s.agentId).to.equal('my-agent');
        });

        it('defaults agentId to null', () => {
            const s = makeSession();
            expect(s.agentId).to.be.null;
        });

        it('sets humanMode, pipeMode, quietMode from options', () => {
            const s = makeSession({ humanMode: true, pipeMode: true, quietMode: true });
            expect(s.humanMode).to.be.true;
            expect(s.pipeMode).to.be.true;
            expect(s.quietMode).to.be.true;
        });

        it('defaults humanMode, pipeMode, quietMode to false', () => {
            const s = makeSession();
            expect(s.humanMode).to.be.false;
            expect(s.pipeMode).to.be.false;
            expect(s.quietMode).to.be.false;
        });

        it('records startTime as a number close to Date.now()', () => {
            const before = Date.now();
            const s = makeSession();
            const after  = Date.now();
            expect(s.startTime).to.be.at.least(before);
            expect(s.startTime).to.be.at.most(after);
        });

        it('creates an NgetEmitter with matching sessionId', () => {
            const s = makeSession({ sessionId: 'emitter-check' });
            expect(s.emitter).to.exist;
            expect(s.emitter.sessionId).to.equal('emitter-check');
        });

        it('creates logger, securityService, metadataService', () => {
            const s = makeSession();
            expect(s.logger).to.exist;
            expect(s.securityService).to.exist;
            expect(s.metadataService).to.exist;
        });

        it('accepts a configManager and uses it to configure services', () => {
            const configManager = {
                get: (key, def) => {
                    if (key === 'logging')  return { level: 'debug', format: 'json', outputs: ['console'] };
                    if (key === 'security') return {};
                    if (key === 'security.enableIntegrityChecks') return true;
                    return def;
                },
                getConfig: () => ({}),
            };
            const s = makeSession({ configManager });
            expect(s.configManager).to.equal(configManager);
            expect(s.logger).to.exist;
        });
    });

    // ─── start() ──────────────────────────────────────────────────────────────

    describe('start()', () => {
        it('returns `this` (chainable)', () => {
            const s = makeSession({ sessionId: 'start-chain', quietMode: true });
            const ret = s.start();
            expect(ret).to.equal(s);
            s.end();
        });

        it('creates the ACTIVE_DIR if it does not exist', () => {
            const s = makeSession({ sessionId: 'start-mkdir', quietMode: true });
            s.start();
            expect(fs.existsSync(ACTIVE_DIR)).to.be.true;
            s.end();
        });

        it('writes a status JSON file to ACTIVE_DIR', async () => {
            const s = makeSession({ sessionId: 'start-writes', quietMode: true });
            s.start();
            await flushIO();
            const data = readStatusFile('start-writes');
            expect(data.sessionId).to.equal('start-writes');
            expect(data.pid).to.equal(process.pid);
            expect(data).to.have.property('startTime');
            expect(data.downloads).to.deep.equal({});
            await s.end();
        });

        it('emits a session_start event (captured from stdout)', async () => {
            const s = makeSession({ sessionId: 'start-event', quietMode: false, humanMode: false });
            const chunks = [];
            const orig = process.stdout.write.bind(process.stdout);
            process.stdout.write = (chunk, ...rest) => { chunks.push(String(chunk)); return orig(chunk, ...rest); };
            try {
                s.start();
                await s.end();
            } finally {
                process.stdout.write = orig;
            }
            const events = chunks.map(c => { try { return JSON.parse(c); } catch { return null; } }).filter(Boolean);
            const sessionStart = events.find(e => e.event === 'session_start');
            expect(sessionStart).to.exist;
            expect(sessionStart.session).to.equal('start-event');
        });
    });

    // ─── end() ────────────────────────────────────────────────────────────────

    describe('end()', () => {
        it('removes the status file', async () => {
            const s = makeSession({ sessionId: 'end-removes', quietMode: true });
            s.start();
            await flushIO();
            expect(fs.existsSync(path.join(ACTIVE_DIR, 'end-removes.json'))).to.be.true;
            await s.end();
            expect(fs.existsSync(path.join(ACTIVE_DIR, 'end-removes.json'))).to.be.false;
        });

        it('does not throw when the status file is already gone', async () => {
            const s = makeSession({ sessionId: 'end-idempotent', quietMode: true });
            s.start();
            await flushIO();
            cleanFile('end-idempotent');
            try { await s.end(); } catch (e) { expect.fail('should not throw: ' + e.message); }
        });

        it('emits a session_end event', async () => {
            const s = makeSession({ sessionId: 'end-event', quietMode: false, humanMode: false });
            const chunks = [];
            const orig = process.stdout.write.bind(process.stdout);
            process.stdout.write = (chunk, ...rest) => { chunks.push(String(chunk)); return orig(chunk, ...rest); };
            try {
                s.start();
                await s.end({ stats: { total: 1, success: 1, errors: 0 } });
            } finally {
                process.stdout.write = orig;
            }
            const events = chunks.map(c => { try { return JSON.parse(c); } catch { return null; } }).filter(Boolean);
            const sessionEnd = events.find(e => e.event === 'session_end');
            expect(sessionEnd).to.exist;
        });

        it('calls logger.shutdown()', async () => {
            const s = makeSession({ sessionId: 'end-shutdown', quietMode: true });
            s.start();
            let shutdownCalled = false;
            const origShutdown = s.logger.shutdown.bind(s.logger);
            s.logger.shutdown = async () => { shutdownCalled = true; return origShutdown(); };
            await s.end();
            expect(shutdownCalled).to.be.true;
        });
    });

    // ─── queueDownload() ─────────────────────────────────────────────────────

    describe('queueDownload()', () => {
        it('adds URL with status "queued"', async () => {
            const s = makeSession({ sessionId: 'queue-test', quietMode: true });
            s.start();
            s.queueDownload('https://example.com/file.zip');
            await flushIO();
            const data = readStatusFile('queue-test');
            expect(data.downloads['https://example.com/file.zip']).to.exist;
            expect(data.downloads['https://example.com/file.zip'].status).to.equal('queued');
            await s.end();
        });

        it('updates the status file with the queued entry', async () => {
            const s = makeSession({ sessionId: 'queue-flush', quietMode: true });
            s.start();
            s.queueDownload('https://example.com/a.txt');
            s.queueDownload('https://example.com/b.txt');
            await flushIO();
            const data = readStatusFile('queue-flush');
            expect(Object.keys(data.downloads)).to.have.length(2);
            await s.end();
        });

        it('emits a download_queued event', async () => {
            const s = makeSession({ sessionId: 'queue-event', quietMode: false, humanMode: false });
            const chunks = [];
            const orig = process.stdout.write.bind(process.stdout);
            process.stdout.write = (chunk, ...rest) => { chunks.push(String(chunk)); return orig(chunk, ...rest); };
            try {
                s.start();
                s.queueDownload('https://example.com/queued.zip');
                await s.end();
            } finally {
                process.stdout.write = orig;
            }
            const events = chunks.map(c => { try { return JSON.parse(c); } catch { return null; } }).filter(Boolean);
            const queuedEvent = events.find(e => e.event === 'download_queued');
            expect(queuedEvent).to.exist;
            expect(queuedEvent.url).to.equal('https://example.com/queued.zip');
        });
    });

    // ─── updateDownload() ────────────────────────────────────────────────────

    describe('updateDownload()', () => {
        it('merges update into an existing entry', async () => {
            const s = makeSession({ sessionId: 'update-merge', quietMode: true });
            s.start();
            s.queueDownload('https://example.com/f.zip');
            await flushIO();
            s.updateDownload('https://example.com/f.zip', { status: 'active', bytes_received: 512 });
            await flushIO();
            const data = readStatusFile('update-merge');
            const entry = data.downloads['https://example.com/f.zip'];
            expect(entry.status).to.equal('active');
            expect(entry.bytes_received).to.equal(512);
            await s.end();
        });

        it('creates a new entry when URL not previously queued', async () => {
            const s = makeSession({ sessionId: 'update-create', quietMode: true });
            s.start();
            s.updateDownload('https://example.com/new.zip', { status: 'active' });
            await flushIO();
            const data = readStatusFile('update-create');
            expect(data.downloads['https://example.com/new.zip']).to.exist;
            expect(data.downloads['https://example.com/new.zip'].status).to.equal('active');
            await s.end();
        });

        it('always refreshes updatedAt timestamp', async () => {
            const s = makeSession({ sessionId: 'update-ts', quietMode: true });
            s.start();
            s.queueDownload('https://example.com/ts.zip');
            await flushIO();
            const before = readStatusFile('update-ts').downloads['https://example.com/ts.zip'].updatedAt;

            await new Promise(r => setTimeout(r, 5));

            s.updateDownload('https://example.com/ts.zip', { status: 'active' });
            await flushIO();
            const after = readStatusFile('update-ts').downloads['https://example.com/ts.zip'].updatedAt;

            expect(after).to.not.equal(before);
            await s.end();
        });
    });

    // ─── completeDownload() ──────────────────────────────────────────────────

    describe('completeDownload()', () => {
        it('sets status to "complete" with file, bytes_total, speed_bps', async () => {
            const s = makeSession({ sessionId: 'complete-test', quietMode: true });
            s.start();
            s.queueDownload('https://example.com/done.zip');
            s.completeDownload('https://example.com/done.zip', {
                path:  '/tmp/done.zip',
                size:  2048,
                speed: 1024,
            });
            await flushIO();
            const data  = readStatusFile('complete-test');
            const entry = data.downloads['https://example.com/done.zip'];
            expect(entry.status).to.equal('complete');
            expect(entry.file).to.equal('/tmp/done.zip');
            expect(entry.bytes_total).to.equal(2048);
            expect(entry.speed_bps).to.equal(1024);
            await s.end();
        });

        it('works even if the URL was never queued first', async () => {
            const s = makeSession({ sessionId: 'complete-no-queue', quietMode: true });
            s.start();
            s.completeDownload('https://example.com/direct.zip', { path: '/tmp/direct.zip', size: 100 });
            await flushIO();
            const data = readStatusFile('complete-no-queue');
            expect(data.downloads['https://example.com/direct.zip'].status).to.equal('complete');
            await s.end();
        });
    });

    // ─── failDownload() ──────────────────────────────────────────────────────

    describe('failDownload()', () => {
        it('sets status to "error" with error message', async () => {
            const s = makeSession({ sessionId: 'fail-test', quietMode: true });
            s.start();
            const err = new Error('Connection refused');
            s.failDownload('https://example.com/bad.zip', err);
            await flushIO();
            const data  = readStatusFile('fail-test');
            const entry = data.downloads['https://example.com/bad.zip'];
            expect(entry.status).to.equal('error');
            expect(entry.error).to.equal('Connection refused');
            expect(entry.code).to.be.null;
            await s.end();
        });

        it('captures error.code when present', async () => {
            const s = makeSession({ sessionId: 'fail-code', quietMode: true });
            s.start();
            const err = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
            s.failDownload('https://example.com/coded.zip', err);
            await flushIO();
            const data  = readStatusFile('fail-code');
            const entry = data.downloads['https://example.com/coded.zip'];
            expect(entry.code).to.equal('ECONNREFUSED');
            await s.end();
        });
    });

    // ─── _flushStatus() guard ────────────────────────────────────────────────

    describe('_flushStatus() inactive guard', () => {
        it('does NOT write a status file before start() is called', async () => {
            const s = makeSession({ sessionId: 'flush-before-start', quietMode: true });
            // updateDownload internally calls _flushStatus but _active is false
            s.updateDownload('https://example.com/x.zip', { status: 'active' });
            await flushIO();
            expect(fs.existsSync(path.join(ACTIVE_DIR, 'flush-before-start.json'))).to.be.false;
        });

        it('does NOT write a status file after end() is called', async () => {
            const s = makeSession({ sessionId: 'flush-after-end', quietMode: true });
            s.start();
            await s.end();
            // update after end — _active is false
            s.updateDownload('https://example.com/y.zip', { status: 'active' });
            await flushIO();
            // File should have been deleted by end() and not re-created
            expect(fs.existsSync(path.join(ACTIVE_DIR, 'flush-after-end.json'))).to.be.false;
        });
    });

    // ─── readActiveSessions() ────────────────────────────────────────────────

    describe('readActiveSessions()', () => {
        it('returns an empty array when no session files exist', () => {
            // Ensure any leftover files from this session won't interfere.
            // We use a unique prefix so they won't collide.
            const sessions = readActiveSessions();
            expect(sessions).to.be.an('array');
        });

        it('returns parsed sessions for running sessions', async () => {
            const s = makeSession({ sessionId: 'read-sess-1', quietMode: true });
            s.start();
            await flushIO();
            const sessions = readActiveSessions();
            const found = sessions.find(s => s.sessionId === 'read-sess-1');
            expect(found).to.exist;
            expect(found.pid).to.equal(process.pid);
            await s.end();
        });

        it('returns multiple sessions', async () => {
            const s1 = makeSession({ sessionId: 'read-multi-1', quietMode: true });
            const s2 = makeSession({ sessionId: 'read-multi-2', quietMode: true });
            s1.start();
            s2.start();
            await flushIO();
            const sessions = readActiveSessions();
            const ids = sessions.map(s => s.sessionId);
            expect(ids).to.include('read-multi-1');
            expect(ids).to.include('read-multi-2');
            await s1.end();
            await s2.end();
        });

        it('skips corrupt JSON files and returns valid ones', async () => {
            // Write a corrupt file directly
            fs.mkdirSync(ACTIVE_DIR, { recursive: true });
            const corruptPath = path.join(ACTIVE_DIR, 'corrupt-test.json');
            fs.writeFileSync(corruptPath, 'this is not json {{{', 'utf8');
            createdIds.push('corrupt-test'); // schedule cleanup

            const s = makeSession({ sessionId: 'read-valid-alongside', quietMode: true });
            s.start();
            await flushIO();

            const sessions = readActiveSessions();
            const ids = sessions.map(s => s.sessionId);
            expect(ids).to.include('read-valid-alongside');
            expect(ids).to.not.include('corrupt-test');
            await s.end();
        });
    });

    // ─── pruneDeadSessions() ─────────────────────────────────────────────────

    describe('pruneDeadSessions()', () => {
        it('does not throw when ACTIVE_DIR does not exist', () => {
            // pruneDeadSessions catches ENOENT internally
            expect(() => pruneDeadSessions()).to.not.throw();
        });

        it('keeps files whose PID is the current (live) process', async () => {
            const s = makeSession({ sessionId: 'prune-keep', quietMode: true });
            s.start();
            await flushIO();
            pruneDeadSessions();
            expect(fs.existsSync(path.join(ACTIVE_DIR, 'prune-keep.json'))).to.be.true;
            await s.end();
        });

        it('removes files whose PID does not exist', () => {
            fs.mkdirSync(ACTIVE_DIR, { recursive: true });
            const deadFile = path.join(ACTIVE_DIR, 'dead-session.json');
            fs.writeFileSync(deadFile, JSON.stringify({
                sessionId: 'dead-session',
                pid: 999999999, // virtually impossible to exist
                startTime: new Date().toISOString(),
                downloads: {},
            }), 'utf8');

            pruneDeadSessions();

            expect(fs.existsSync(deadFile)).to.be.false;
        });

        it('skips corrupt files without throwing', () => {
            fs.mkdirSync(ACTIVE_DIR, { recursive: true });
            const corruptFile = path.join(ACTIVE_DIR, 'prune-corrupt.json');
            fs.writeFileSync(corruptFile, '{ bad json', 'utf8');
            createdIds.push('prune-corrupt'); // schedule cleanup

            expect(() => pruneDeadSessions()).to.not.throw();
            // Corrupt file should still be present (we can't decide its PID)
            expect(fs.existsSync(corruptFile)).to.be.true;
        });
    });
});
