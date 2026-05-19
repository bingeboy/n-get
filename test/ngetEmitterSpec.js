'use strict';

const { NgetEmitter, EVENT } = require('../lib/core/NgetEmitter');

// ─── Stream capture helpers ───────────────────────────────────────────────────

function captureStream(stream) {
    const state = { output: '' };
    const orig = stream.write.bind(stream);
    stream.write = function (chunk) {
        state.output += chunk;
        return true;
    };
    state.restore = function () {
        stream.write = orig;
    };
    return state;
}

// ─── Stub UIManager factory ───────────────────────────────────────────────────

function makeUi(overrides) {
    const calls = {
        displayBanner: [],
        displayDownloadStart: [],
        displayDownloadComplete: [],
        displayError: [],
        displayWarning: [],
        displayInfo: [],
        displaySummary: [],
    };
    const ui = {
        displayBanner:         function () { calls.displayBanner.push([]); },
        displayDownloadStart:  function (...args) { calls.displayDownloadStart.push(args); },
        displayDownloadComplete: function (...args) { calls.displayDownloadComplete.push(args); },
        displayError:          function (...args) { calls.displayError.push(args); },
        displayWarning:        function (...args) { calls.displayWarning.push(args); },
        displayInfo:           function (...args) { calls.displayInfo.push(args); },
        displaySummary:        function (...args) { calls.displaySummary.push(args); },
        _calls:                calls,
        ...overrides,
    };
    return ui;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NgetEmitter', function () {

    // ── Constructor ──────────────────────────────────────────────────────────

    describe('Constructor', function () {
        it('defaults humanMode and pipeMode to false', function () {
            const emitter = new NgetEmitter({ sessionId: 'test-1' });
            expect(emitter.humanMode).to.equal(false);
            expect(emitter.pipeMode).to.equal(false);
        });

        it('sets sessionId from options', function () {
            const emitter = new NgetEmitter({ sessionId: 'my-session' });
            expect(emitter.sessionId).to.equal('my-session');
        });

        it('sets humanMode when provided', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
            expect(emitter.humanMode).to.equal(true);
        });

        it('sets pipeMode when provided', function () {
            const emitter = new NgetEmitter({ sessionId: 's', pipeMode: true });
            expect(emitter.pipeMode).to.equal(true);
        });

        it('routes to stdout in agent mode (default)', function () {
            const stdout = captureStream(process.stdout);
            const stderr = captureStream(process.stderr);
            try {
                const emitter = new NgetEmitter({ sessionId: 'agent-mode' });
                emitter.emit('info', { message: 'hello' });
                expect(stdout.output).to.include('hello');
                expect(stderr.output).to.equal('');
            } finally {
                stdout.restore();
                stderr.restore();
            }
        });

        it('routes to stderr in humanMode', function () {
            const stdout = captureStream(process.stdout);
            const stderr = captureStream(process.stderr);
            try {
                const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
                emitter.emit('warning', { message: 'watch out' });
                expect(stdout.output).to.equal('');
                expect(stderr.output).to.include('watch out');
            } finally {
                stdout.restore();
                stderr.restore();
            }
        });

        it('routes to stderr in pipeMode', function () {
            const stdout = captureStream(process.stdout);
            const stderr = captureStream(process.stderr);
            try {
                const emitter = new NgetEmitter({ sessionId: 's', pipeMode: true });
                emitter.emit('info', { message: 'piped' });
                expect(stdout.output).to.equal('');
                expect(stderr.output).to.include('piped');
            } finally {
                stdout.restore();
                stderr.restore();
            }
        });

        it('accepts a ui object', function () {
            const ui = makeUi();
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            // Should not throw
            expect(emitter).to.be.instanceof(NgetEmitter);
        });

        it('works without a ui object (ui defaults to null)', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
            expect(emitter).to.be.instanceof(NgetEmitter);
        });
    });

    // ── emit() core ──────────────────────────────────────────────────────────

    describe('emit()', function () {
        let stdout;

        beforeEach(function () {
            stdout = captureStream(process.stdout);
        });

        afterEach(function () {
            stdout.restore();
        });

        it('returns an object with event, ts, and session fields', function () {
            const emitter = new NgetEmitter({ sessionId: 'sess-42' });
            const result = emitter.emit('info', { message: 'test' });

            expect(result).to.have.property('event', 'info');
            expect(result).to.have.property('session', 'sess-42');
            expect(result).to.have.property('ts').that.is.a('number');
        });

        it('merges extra payload into the returned event', function () {
            const emitter = new NgetEmitter({ sessionId: 's' });
            const result = emitter.emit('info', { message: 'msg', extra: 'data' });

            expect(result.message).to.equal('msg');
            expect(result.extra).to.equal('data');
        });

        it('ts is close to Date.now()', function () {
            const before = Date.now();
            const emitter = new NgetEmitter({ sessionId: 's' });
            const result = emitter.emit('info', {});
            const after = Date.now();

            expect(result.ts).to.be.at.least(before);
            expect(result.ts).to.be.at.most(after);
        });

        it('in agent mode writes a JSON line to stdout', function () {
            const emitter = new NgetEmitter({ sessionId: 's' });
            emitter.emit('info', { message: 'agent-output' });

            const parsed = JSON.parse(stdout.output.trim());
            expect(parsed.event).to.equal('info');
            expect(parsed.message).to.equal('agent-output');
        });

        it('in agent mode the JSON line ends with newline', function () {
            const emitter = new NgetEmitter({ sessionId: 's' });
            emitter.emit('info', {});
            expect(stdout.output).to.match(/\n$/);
        });

        it('in humanMode calls _renderHuman instead of writing JSON', function () {
            const stderr = captureStream(process.stderr);
            try {
                const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
                emitter.emit('warning', { message: 'no-json' });
                // stderr should have plain text, not JSON
                expect(stderr.output).to.not.match(/^\{/);
                expect(stderr.output).to.include('no-json');
            } finally {
                stderr.restore();
            }
        });

        it('returns the event even in humanMode', function () {
            const stderr = captureStream(process.stderr);
            try {
                const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
                const result = emitter.emit('warning', { message: 'check-return' });
                expect(result.event).to.equal('warning');
            } finally {
                stderr.restore();
            }
        });
    });

    // ── EVENT constant ───────────────────────────────────────────────────────

    describe('EVENT constant', function () {
        it('exports all expected event type keys', function () {
            expect(EVENT.SESSION_START).to.equal('session_start');
            expect(EVENT.SESSION_END).to.equal('session_end');
            expect(EVENT.DOWNLOAD_QUEUED).to.equal('download_queued');
            expect(EVENT.DOWNLOAD_START).to.equal('download_start');
            expect(EVENT.PROGRESS).to.equal('progress');
            expect(EVENT.CHECKSUM_START).to.equal('checksum_start');
            expect(EVENT.CHECKSUM_COMPLETE).to.equal('checksum_complete');
            expect(EVENT.DOWNLOAD_COMPLETE).to.equal('download_complete');
            expect(EVENT.DOWNLOAD_ERROR).to.equal('download_error');
            expect(EVENT.WARNING).to.equal('warning');
            expect(EVENT.INFO).to.equal('info');
        });
    });

    // ── Typed helpers ────────────────────────────────────────────────────────

    describe('Typed event helpers (agent mode)', function () {
        let emitter;
        let stdout;

        beforeEach(function () {
            stdout = captureStream(process.stdout);
            emitter = new NgetEmitter({ sessionId: 'typed-tests' });
        });

        afterEach(function () {
            stdout.restore();
        });

        it('sessionStart() emits event=session_start', function () {
            const result = emitter.sessionStart();
            expect(result.event).to.equal('session_start');
        });

        it('sessionStart() merges extra data', function () {
            const result = emitter.sessionStart({ pid: 999 });
            expect(result.pid).to.equal(999);
        });

        it('sessionEnd() emits event=session_end', function () {
            const result = emitter.sessionEnd();
            expect(result.event).to.equal('session_end');
        });

        it('sessionEnd() merges summary', function () {
            const stats = { total: 2, success: 2, errors: 0, resumed: 0, bytes: 100, duration: 500, avg_speed: 200, file_paths: [] };
            const result = emitter.sessionEnd({ stats });
            expect(result.stats).to.deep.equal(stats);
        });

        it('downloadQueued() emits event=download_queued with url', function () {
            const result = emitter.downloadQueued('https://example.com/file.zip');
            expect(result.event).to.equal('download_queued');
            expect(result.url).to.equal('https://example.com/file.zip');
        });

        it('downloadQueued() merges extra data', function () {
            const result = emitter.downloadQueued('https://example.com/f.zip', { index: 1 });
            expect(result.index).to.equal(1);
        });

        it('downloadStart() emits event=download_start with url', function () {
            const result = emitter.downloadStart('https://example.com/start.zip');
            expect(result.event).to.equal('download_start');
            expect(result.url).to.equal('https://example.com/start.zip');
        });

        it('downloadStart() merges extra data', function () {
            const result = emitter.downloadStart('https://x.com/f', { filename: 'f', bytes_total: 500 });
            expect(result.filename).to.equal('f');
            expect(result.bytes_total).to.equal(500);
        });

        it('progress() emits event=progress with correct fields', function () {
            const result = emitter.progress('https://example.com/f', 500, 1000, 250);
            expect(result.event).to.equal('progress');
            expect(result.url).to.equal('https://example.com/f');
            expect(result.bytes_received).to.equal(500);
            expect(result.bytes_total).to.equal(1000);
            expect(result.speed_bps).to.equal(250);
        });

        it('progress() pct is null when bytesTotal === 0', function () {
            const result = emitter.progress('https://example.com/f', 0, 0, 0);
            expect(result.pct).to.be.null;
        });

        it('progress() pct is correct percentage when bytesTotal > 0', function () {
            const result = emitter.progress('https://example.com/f', 750, 1000, 100);
            expect(result.pct).to.equal(75);
        });

        it('progress() pct floors the percentage (not rounds)', function () {
            const result = emitter.progress('https://example.com/f', 1, 3, 0);
            // 1/3 * 100 = 33.33... → floor = 33
            expect(result.pct).to.equal(33);
        });

        it('checksumStart() emits event=checksum_start with file and algorithms', function () {
            const result = emitter.checksumStart('/path/to/file.zip', ['md5', 'sha256']);
            expect(result.event).to.equal('checksum_start');
            expect(result.file).to.equal('/path/to/file.zip');
            expect(result.algorithms).to.deep.equal(['md5', 'sha256']);
        });

        it('checksumComplete() emits event=checksum_complete with file and checksums', function () {
            const checksums = { md5: 'abc123', sha256: 'def456' };
            const result = emitter.checksumComplete('/path/file.zip', checksums);
            expect(result.event).to.equal('checksum_complete');
            expect(result.file).to.equal('/path/file.zip');
            expect(result.checksums).to.deep.equal(checksums);
        });

        it('downloadComplete() emits event=download_complete with url', function () {
            const result = emitter.downloadComplete('https://example.com/done.zip');
            expect(result.event).to.equal('download_complete');
            expect(result.url).to.equal('https://example.com/done.zip');
        });

        it('downloadComplete() merges extra data', function () {
            const result = emitter.downloadComplete('https://x.com/f', { size: 2048, duration_ms: 1200 });
            expect(result.size).to.equal(2048);
            expect(result.duration_ms).to.equal(1200);
        });

        it('downloadError() emits event=download_error with url and error message', function () {
            const err = new Error('Connection refused');
            const result = emitter.downloadError('https://example.com/fail.zip', err);
            expect(result.event).to.equal('download_error');
            expect(result.url).to.equal('https://example.com/fail.zip');
            expect(result.error).to.equal('Connection refused');
        });

        it('downloadError() retryable defaults to false when not set on error', function () {
            const err = new Error('oops');
            const result = emitter.downloadError('https://x.com/f', err);
            expect(result.retryable).to.equal(false);
        });

        it('downloadError() retryable is true when set on error', function () {
            const err = Object.assign(new Error('timeout'), { retryable: true });
            const result = emitter.downloadError('https://x.com/f', err);
            expect(result.retryable).to.equal(true);
        });

        it('downloadError() code defaults to null when not set on error', function () {
            const err = new Error('generic error');
            const result = emitter.downloadError('https://x.com/f', err);
            expect(result.code).to.be.null;
        });

        it('downloadError() code is included when set on error', function () {
            const err = Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
            const result = emitter.downloadError('https://x.com/f', err);
            expect(result.code).to.equal('ENOTFOUND');
        });

        it('warn() emits event=warning with message', function () {
            const result = emitter.warn('Something suspicious');
            expect(result.event).to.equal('warning');
            expect(result.message).to.equal('Something suspicious');
        });

        it('warn() merges extra data', function () {
            const result = emitter.warn('careful', { code: 'W001' });
            expect(result.code).to.equal('W001');
        });

        it('info() emits event=info with message', function () {
            const result = emitter.info('All good');
            expect(result.event).to.equal('info');
            expect(result.message).to.equal('All good');
        });

        it('info() merges extra data', function () {
            const result = emitter.info('note', { detail: 'extra' });
            expect(result.detail).to.equal('extra');
        });
    });

    // ── Stream routing ────────────────────────────────────────────────────────

    describe('Stream routing', function () {
        it('agent mode: events go to stdout, not stderr', function () {
            const stdout = captureStream(process.stdout);
            const stderr = captureStream(process.stderr);
            try {
                const emitter = new NgetEmitter({ sessionId: 's' });
                emitter.info('agent-stdout');
                expect(stdout.output).to.include('agent-stdout');
                expect(stderr.output).to.equal('');
            } finally {
                stdout.restore();
                stderr.restore();
            }
        });

        it('humanMode: events go to stderr, not stdout', function () {
            const stdout = captureStream(process.stdout);
            const stderr = captureStream(process.stderr);
            try {
                const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
                emitter.warn('human-stderr');
                expect(stderr.output).to.include('human-stderr');
                expect(stdout.output).to.equal('');
            } finally {
                stdout.restore();
                stderr.restore();
            }
        });

        it('pipeMode: events go to stderr, not stdout', function () {
            const stdout = captureStream(process.stdout);
            const stderr = captureStream(process.stderr);
            try {
                const emitter = new NgetEmitter({ sessionId: 's', pipeMode: true });
                emitter.info('pipe-stderr');
                expect(stderr.output).to.include('pipe-stderr');
                expect(stdout.output).to.equal('');
            } finally {
                stdout.restore();
                stderr.restore();
            }
        });
    });

    // ── _renderHuman() — with ui ─────────────────────────────────────────────

    describe('_renderHuman() with ui object', function () {
        let ui;
        let stderr;

        beforeEach(function () {
            ui = makeUi();
            stderr = captureStream(process.stderr);
        });

        afterEach(function () {
            stderr.restore();
        });

        it('session_start: calls ui.displayBanner()', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.sessionStart();
            expect(ui._calls.displayBanner).to.have.length(1);
        });

        it('session_start: does not write to stream when ui present', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.sessionStart();
            expect(stderr.output).to.equal('');
        });

        it('download_start: calls ui.displayDownloadStart() with correct args (filename branch)', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.downloadStart('https://x.com/file.zip', {
                filename: 'file.zip',
                bytes_total: 1024,
                index: 2,
                total: 5,
                resumed: true,
                resume_from: 256,
            });
            expect(ui._calls.displayDownloadStart).to.have.length(1);
            const args = ui._calls.displayDownloadStart[0];
            expect(args[0]).to.equal('file.zip');
            expect(args[1]).to.equal(1024);
            expect(args[2]).to.equal(2);
            expect(args[3]).to.equal(5);
            expect(args[4]).to.equal(true);
            expect(args[5]).to.equal(256);
        });

        it('download_start: falls back to url when filename is absent', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.downloadStart('https://x.com/file.zip');
            const args = ui._calls.displayDownloadStart[0];
            expect(args[0]).to.equal('https://x.com/file.zip');
        });

        it('download_start: defaults bytes_total/index/total/resumed/resume_from when absent', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.downloadStart('https://x.com/f');
            const args = ui._calls.displayDownloadStart[0];
            expect(args[1]).to.equal(0);   // bytes_total default
            expect(args[2]).to.equal(1);   // index default
            expect(args[3]).to.equal(1);   // total default
            expect(args[4]).to.equal(false); // resumed default
            expect(args[5]).to.equal(0);   // resume_from default
        });

        it('download_complete: calls ui.displayDownloadComplete() with correct args (filename branch)', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.downloadComplete('https://x.com/f', {
                filename: 'file.zip',
                bytes_total: 2048,
                duration_ms: 2000,
                speed_bps: 1024,
            });
            expect(ui._calls.displayDownloadComplete).to.have.length(1);
            const args = ui._calls.displayDownloadComplete[0];
            expect(args[0]).to.equal('file.zip');
            expect(args[1]).to.equal(2048);
            expect(args[2]).to.be.closeTo(2.0, 0.001);
            expect(args[3]).to.equal(1024);
        });

        it('download_complete: falls back to url when filename absent', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.downloadComplete('https://x.com/f.zip', { bytes_total: 100 });
            const args = ui._calls.displayDownloadComplete[0];
            expect(args[0]).to.equal('https://x.com/f.zip');
        });

        it('download_complete: falls back to size when bytes_total absent', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.downloadComplete('https://x.com/f', { size: 512 });
            const args = ui._calls.displayDownloadComplete[0];
            expect(args[1]).to.equal(512);
        });

        it('download_complete: defaults to 0 bytes when neither bytes_total nor size present', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.downloadComplete('https://x.com/f');
            const args = ui._calls.displayDownloadComplete[0];
            expect(args[1]).to.equal(0);
        });

        it('download_error: calls ui.displayError() with error message and url', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            const err = new Error('Connection reset');
            emitter.downloadError('https://x.com/fail', err);
            expect(ui._calls.displayError).to.have.length(1);
            const args = ui._calls.displayError[0];
            expect(args[0]).to.equal('Connection reset');
            expect(args[1]).to.equal('https://x.com/fail');
        });

        it('warning: calls ui.displayWarning() with message', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.warn('Be careful');
            expect(ui._calls.displayWarning).to.have.length(1);
            expect(ui._calls.displayWarning[0][0]).to.equal('Be careful');
        });

        it('info: calls ui.displayInfo() with message', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.info('Status update');
            expect(ui._calls.displayInfo).to.have.length(1);
            expect(ui._calls.displayInfo[0][0]).to.equal('Status update');
        });

        it('session_end with stats: calls ui.displaySummary() with mapped fields', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            const stats = {
                total: 5,
                success: 4,
                errors: 1,
                resumed: 2,
                bytes: 10240,
                duration: 3500,
                avg_speed: 2925,
                file_paths: ['/tmp/a', '/tmp/b'],
            };
            emitter.sessionEnd({ stats });
            expect(ui._calls.displaySummary).to.have.length(1);
            const summaryArg = ui._calls.displaySummary[0][0];
            expect(summaryArg.totalFiles).to.equal(5);
            expect(summaryArg.successCount).to.equal(4);
            expect(summaryArg.errorCount).to.equal(1);
            expect(summaryArg.resumedCount).to.equal(2);
            expect(summaryArg.totalBytes).to.equal(10240);
            expect(summaryArg.totalTime).to.equal(3500);
            expect(summaryArg.averageSpeed).to.equal(2925);
            expect(summaryArg.filePaths).to.deep.equal(['/tmp/a', '/tmp/b']);
        });

        it('session_end without stats: does not call ui.displaySummary()', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.sessionEnd({});
            expect(ui._calls.displaySummary).to.have.length(0);
        });

        it('progress: silent — no ui call and no stream output', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.progress('https://x.com/f', 50, 100, 25);
            // No ui methods should have been called
            expect(ui._calls.displayBanner).to.have.length(0);
            expect(ui._calls.displayDownloadStart).to.have.length(0);
            expect(ui._calls.displayDownloadComplete).to.have.length(0);
            expect(ui._calls.displayError).to.have.length(0);
            expect(ui._calls.displayWarning).to.have.length(0);
            expect(ui._calls.displayInfo).to.have.length(0);
            expect(ui._calls.displaySummary).to.have.length(0);
            // No output to stderr
            expect(stderr.output).to.equal('');
        });

        it('checksum_start: silent — no ui call and no stream output', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.checksumStart('/tmp/file', ['md5']);
            expect(Object.values(ui._calls).flat()).to.have.length(0);
            expect(stderr.output).to.equal('');
        });

        it('checksum_complete: silent — no ui call and no stream output', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.checksumComplete('/tmp/file', { md5: 'abc' });
            expect(Object.values(ui._calls).flat()).to.have.length(0);
            expect(stderr.output).to.equal('');
        });

        it('download_queued: silent — no ui call and no stream output', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, ui });
            emitter.downloadQueued('https://x.com/f');
            expect(Object.values(ui._calls).flat()).to.have.length(0);
            expect(stderr.output).to.equal('');
        });
    });

    // ── _renderHuman() — without ui (fallback text) ──────────────────────────

    describe('_renderHuman() without ui (fallback plain text)', function () {
        let stderr;

        beforeEach(function () {
            stderr = captureStream(process.stderr);
        });

        afterEach(function () {
            stderr.restore();
        });

        it('session_start: no output (no ui, no fallback for session_start)', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
            emitter.sessionStart();
            expect(stderr.output).to.equal('');
        });

        it('download_start: writes ">> starting  <url>" to stderr', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
            emitter.downloadStart('https://x.com/file.zip');
            expect(stderr.output).to.include('>> starting  https://x.com/file.zip');
        });

        it('download_complete: writes "[OK] <url>  (<size> bytes)" to stderr', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
            emitter.downloadComplete('https://x.com/done.zip', { size: 1024 });
            expect(stderr.output).to.include('[OK] https://x.com/done.zip');
            expect(stderr.output).to.include('1024 bytes');
        });

        it('download_complete: uses 0 bytes when size absent', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
            emitter.downloadComplete('https://x.com/done.zip');
            expect(stderr.output).to.include('0 bytes');
        });

        it('download_error: writes "[ERR] <url>: <message>" to stderr', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
            const err = new Error('Timeout');
            emitter.downloadError('https://x.com/fail', err);
            expect(stderr.output).to.include('[ERR] https://x.com/fail: Timeout');
        });

        it('warning: writes "[WARN] <message>" to stderr', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
            emitter.warn('Low disk space');
            expect(stderr.output).to.include('[WARN] Low disk space');
        });

        it('info: writes "[INFO] <message>" to stderr', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
            emitter.info('Connecting...');
            expect(stderr.output).to.include('[INFO] Connecting...');
        });

        it('session_end with stats but no ui: no output', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
            const stats = { total: 1, success: 1, errors: 0, resumed: 0, bytes: 100, duration: 200, avg_speed: 500, file_paths: [] };
            emitter.sessionEnd({ stats });
            expect(stderr.output).to.equal('');
        });

        it('session_end without stats and no ui: no output', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
            emitter.sessionEnd({});
            expect(stderr.output).to.equal('');
        });

        it('progress: silent — no stream output', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
            emitter.progress('https://x.com/f', 100, 200, 50);
            expect(stderr.output).to.equal('');
        });

        it('checksum_start: silent — no stream output', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
            emitter.checksumStart('/tmp/f', ['sha256']);
            expect(stderr.output).to.equal('');
        });

        it('checksum_complete: silent — no stream output', function () {
            const emitter = new NgetEmitter({ sessionId: 's', humanMode: true });
            emitter.checksumComplete('/tmp/f', { sha256: 'abc' });
            expect(stderr.output).to.equal('');
        });
    });

    // ── Edge cases ────────────────────────────────────────────────────────────

    describe('Edge cases', function () {
        it('emit() with no payload uses empty object default', function () {
            const stdout = captureStream(process.stdout);
            try {
                const emitter = new NgetEmitter({ sessionId: 'edge' });
                const result = emitter.emit('info');
                expect(result.event).to.equal('info');
                expect(result.session).to.equal('edge');
            } finally {
                stdout.restore();
            }
        });

        it('sessionStart() with no args uses empty default', function () {
            const stdout = captureStream(process.stdout);
            try {
                const emitter = new NgetEmitter({ sessionId: 's' });
                const result = emitter.sessionStart();
                expect(result.event).to.equal('session_start');
            } finally {
                stdout.restore();
            }
        });

        it('sessionEnd() with no args uses empty default', function () {
            const stdout = captureStream(process.stdout);
            try {
                const emitter = new NgetEmitter({ sessionId: 's' });
                const result = emitter.sessionEnd();
                expect(result.event).to.equal('session_end');
            } finally {
                stdout.restore();
            }
        });

        it('downloadQueued() with no extra data uses empty default', function () {
            const stdout = captureStream(process.stdout);
            try {
                const emitter = new NgetEmitter({ sessionId: 's' });
                const result = emitter.downloadQueued('https://example.com/f');
                expect(result.event).to.equal('download_queued');
            } finally {
                stdout.restore();
            }
        });

        it('downloadStart() with no extra data uses empty default', function () {
            const stdout = captureStream(process.stdout);
            try {
                const emitter = new NgetEmitter({ sessionId: 's' });
                const result = emitter.downloadStart('https://example.com/f');
                expect(result.event).to.equal('download_start');
            } finally {
                stdout.restore();
            }
        });

        it('downloadComplete() with no extra data uses empty default', function () {
            const stdout = captureStream(process.stdout);
            try {
                const emitter = new NgetEmitter({ sessionId: 's' });
                const result = emitter.downloadComplete('https://example.com/f');
                expect(result.event).to.equal('download_complete');
            } finally {
                stdout.restore();
            }
        });

        it('warn() with no extra data uses empty default', function () {
            const stdout = captureStream(process.stdout);
            try {
                const emitter = new NgetEmitter({ sessionId: 's' });
                const result = emitter.warn('heads up');
                expect(result.event).to.equal('warning');
            } finally {
                stdout.restore();
            }
        });

        it('info() with no extra data uses empty default', function () {
            const stdout = captureStream(process.stdout);
            try {
                const emitter = new NgetEmitter({ sessionId: 's' });
                const result = emitter.info('status');
                expect(result.event).to.equal('info');
            } finally {
                stdout.restore();
            }
        });

        it('progress() pct is 0 when bytesReceived is 0 and bytesTotal > 0', function () {
            const stdout = captureStream(process.stdout);
            try {
                const emitter = new NgetEmitter({ sessionId: 's' });
                const result = emitter.progress('https://x.com/f', 0, 1000, 0);
                expect(result.pct).to.equal(0);
            } finally {
                stdout.restore();
            }
        });

        it('progress() pct is 100 when fully downloaded', function () {
            const stdout = captureStream(process.stdout);
            try {
                const emitter = new NgetEmitter({ sessionId: 's' });
                const result = emitter.progress('https://x.com/f', 1000, 1000, 500);
                expect(result.pct).to.equal(100);
            } finally {
                stdout.restore();
            }
        });

        it('agent mode JSON output is valid NDJSON (parseable)', function () {
            const stdout = captureStream(process.stdout);
            try {
                const emitter = new NgetEmitter({ sessionId: 'ndjson-test' });
                emitter.sessionStart({ agent: 'test-agent' });
                emitter.info('line two');
                const lines = stdout.output.trim().split('\n');
                expect(lines).to.have.length(2);
                const first = JSON.parse(lines[0]);
                const second = JSON.parse(lines[1]);
                expect(first.event).to.equal('session_start');
                expect(second.event).to.equal('info');
            } finally {
                stdout.restore();
            }
        });

        it('humanMode + pipeMode both true routes to stderr', function () {
            const stdout = captureStream(process.stdout);
            const stderr = captureStream(process.stderr);
            try {
                const emitter = new NgetEmitter({ sessionId: 's', humanMode: true, pipeMode: true });
                emitter.warn('both-modes');
                expect(stderr.output).to.include('both-modes');
                expect(stdout.output).to.equal('');
            } finally {
                stdout.restore();
                stderr.restore();
            }
        });
    });

    // ── webhook sink ─────────────────────────────────────────────────────────

    describe('webhook sink', () => {

        it('fires POST to webhook URL when an event is emitted', async () => {
            const http = require('node:http');
            const received = [];
            const server = http.createServer((req, res) => {
                let body = '';
                req.on('data', c => { body += c; });
                req.on('end', () => {
                    try { received.push(JSON.parse(body)); } catch { /* ignore */ }
                    res.writeHead(200); res.end();
                });
            });
            await new Promise(r => server.listen(0, '127.0.0.1', r));
            const { port } = server.address();

            const stdout = captureStream(process.stdout);
            try {
                const emitter = new NgetEmitter({
                    sessionId: 'test-wh',
                    webhooks: [{ url: `http://127.0.0.1:${port}/hook` }],
                });

                emitter.emit('info', { message: 'hello' });
                await new Promise(r => setTimeout(r, 300));
            } finally {
                stdout.restore();
            }

            server.close();
            expect(received.length).to.be.greaterThanOrEqual(1);
            expect(received[0]).to.have.property('event', 'info');
        });

        it('skips events not in the events filter', async () => {
            const http = require('node:http');
            const received = [];
            const server = http.createServer((req, res) => {
                let body = '';
                req.on('data', c => { body += c; });
                req.on('end', () => {
                    try { received.push(JSON.parse(body)); } catch { /* ignore */ }
                    res.writeHead(200); res.end();
                });
            });
            await new Promise(r => server.listen(0, '127.0.0.1', r));
            const { port } = server.address();

            const stdout = captureStream(process.stdout);
            try {
                const emitter = new NgetEmitter({
                    sessionId: 'test-wh-filter',
                    webhooks: [{ url: `http://127.0.0.1:${port}/hook`, events: ['download_complete'] }],
                });

                emitter.emit('info', { message: 'should be filtered' });
                emitter.emit('download_complete', { url: 'http://example.com/file.zip' });
                await new Promise(r => setTimeout(r, 300));
            } finally {
                stdout.restore();
            }

            server.close();
            expect(received.length).to.equal(1);
            expect(received[0]).to.have.property('event', 'download_complete');
        });

    });
});
