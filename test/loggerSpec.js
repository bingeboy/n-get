'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');

const Logger = require('../lib/services/Logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nget-logger-test-'));
}

function silentLogger(overrides = {}) {
    return new Logger({
        outputs: ['console'],
        format: 'json',
        level: 'trace',
        enableColors: false,
        ...overrides,
    });
}

// Capture console.log/error output for assertions
function captureConsole(fn) {
    const lines = [];
    const orig = { log: console.log, error: console.error, warn: console.warn };
    console.log   = (...a) => lines.push(a.join(' '));
    console.error = (...a) => lines.push(a.join(' '));
    console.warn  = (...a) => lines.push(a.join(' '));
    try { fn(); } finally {
        Object.assign(console, orig);
    }
    return lines;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Logger', () => {

    describe('constructor', () => {
        it('defaults to info level', () => {
            const l = new Logger({ outputs: [] });
            expect(l.config.level).toBe('info');
        });

        it('accepts custom level', () => {
            const l = new Logger({ outputs: [], level: 'debug' });
            expect(l.config.level).toBe('debug');
        });

        it('defaults to text format', () => {
            const l = new Logger({ outputs: [] });
            expect(l.config.format).toBe('text');
        });

        it('initializes metrics', () => {
            const l = new Logger({ outputs: [] });
            expect(l.metrics.logsWritten).toBe(0);
            expect(l.metrics.errorsEncountered).toBe(0);
        });

        it('initializes empty contextStack', () => {
            const l = new Logger({ outputs: [] });
            expect(l.contextStack).toEqual([]);
        });

        it('creates log dir when file output is requested', () => {
            const dir = makeTempDir();
            const logDir = path.join(dir, 'logs');
            const l = new Logger({ outputs: ['file'], logDir });
            expect(fs.existsSync(logDir)).toBe(true);
            l.shutdown();
        });
    });

    describe('log levels', () => {
        it('error() logs at error level', () => {
            const l = silentLogger();
            const lines = captureConsole(() => l.error('boom'));
            expect(lines.some(ln => ln.includes('ERROR') || ln.includes('error'))).toBe(true);
        });

        it('warn() logs at warn level', () => {
            const l = silentLogger();
            const lines = captureConsole(() => l.warn('watch out'));
            expect(lines.some(ln => ln.includes('WARN') || ln.includes('warn'))).toBe(true);
        });

        it('info() logs at info level', () => {
            const l = silentLogger();
            const lines = captureConsole(() => l.info('hello'));
            expect(lines.some(ln => ln.includes('INFO') || ln.includes('info'))).toBe(true);
        });

        it('debug() is suppressed when level=info', () => {
            const l = silentLogger({ level: 'info' });
            const lines = captureConsole(() => l.debug('hidden'));
            expect(lines.length).toBe(0);
        });

        it('debug() appears when level=debug', () => {
            const l = silentLogger({ level: 'debug' });
            const lines = captureConsole(() => l.debug('visible'));
            expect(lines.some(ln => ln.includes('DEBUG') || ln.includes('debug'))).toBe(true);
        });

        it('trace() is suppressed when level=info', () => {
            const l = silentLogger({ level: 'info' });
            const lines = captureConsole(() => l.trace('hidden'));
            expect(lines.length).toBe(0);
        });

        it('increments logsWritten metric', () => {
            const l = silentLogger();
            captureConsole(() => { l.info('a'); l.info('b'); });
            expect(l.metrics.logsWritten).toBeGreaterThanOrEqual(2);
        });

        it('logs error object with stack trace', () => {
            const l = silentLogger({ includeStackTrace: true });
            const lines = captureConsole(() => l.error('fail', {}, new Error('stack test')));
            expect(lines.join('\n')).toContain('stack test');
        });
    });

    describe('createLogEntry', () => {
        it('includes level, message, timestamp, pid', () => {
            const l = silentLogger();
            const entry = l.createLogEntry('info', 'test msg', {}, null);
            expect(entry.level).toBe('INFO');
            expect(entry.message).toBe('test msg');
            expect(entry.timestamp).toBeDefined();
            expect(entry.process.pid).toBe(process.pid);
        });

        it('attaches correlationId when set', () => {
            const l = silentLogger();
            l.setCorrelationId('req-abc');
            const entry = l.createLogEntry('info', 'msg', {}, null);
            expect(entry.correlationId).toBe('req-abc');
        });

        it('attaches context stack entries', () => {
            const l = silentLogger();
            l.pushContext({ component: 'downloader' });
            const entry = l.createLogEntry('info', 'msg', {}, null);
            expect(entry.context).toBeDefined();
        });

        it('attaches error info when provided', () => {
            const l = silentLogger();
            const err = new Error('test error');
            const entry = l.createLogEntry('error', 'msg', {}, err);
            expect(entry.error.message).toBe('test error');
        });

        it('includes performance fields for warn/error', () => {
            const l = silentLogger();
            const entry = l.createLogEntry('error', 'msg', {}, null);
            expect(entry.performance).toBeDefined();
        });
    });

    describe('context management', () => {
        it('pushContext adds to stack', () => {
            const l = silentLogger();
            l.pushContext({ foo: 'bar' });
            expect(l.contextStack.length).toBe(1);
            expect(l.contextStack[0].foo).toBe('bar');
        });

        it('popContext removes from stack', () => {
            const l = silentLogger();
            l.pushContext({ x: 1 });
            const popped = l.popContext();
            expect(popped.x).toBe(1);
            expect(l.contextStack.length).toBe(0);
        });

        it('clearContext empties the stack', () => {
            const l = silentLogger();
            l.pushContext({ a: 1 });
            l.pushContext({ b: 2 });
            l.clearContext();
            expect(l.contextStack.length).toBe(0);
        });

        it('setCorrelationId stores the id', () => {
            const l = silentLogger();
            l.setCorrelationId('corr-xyz');
            expect(l.correlationId).toBe('corr-xyz');
        });
    });

    describe('child()', () => {
        it('returns a Logger instance', () => {
            const l = silentLogger();
            const child = l.child({ service: 'test' });
            expect(child).toBeInstanceOf(Logger);
        });

        it('inherits correlationId from parent', () => {
            const l = silentLogger();
            l.setCorrelationId('parent-id');
            const child = l.child({ x: 1 });
            expect(child.correlationId).toBe('parent-id');
        });

        it('child has its own context pushed', () => {
            const l = silentLogger();
            const child = l.child({ component: 'worker' });
            expect(child.contextStack.length).toBeGreaterThan(0);
        });
    });

    describe('audit()', () => {
        it('logs without throwing', () => {
            const l = silentLogger();
            expect(() => captureConsole(() => l.audit('user_login', { ip: '127.0.0.1' }, 'user1'))).not.toThrow();
        });

        it('includes audit=true in meta', () => {
            const l = silentLogger();
            let captured = null;
            const orig = l.info.bind(l);
            l.info = (msg, meta) => { captured = meta; orig(msg, meta); };
            captureConsole(() => l.audit('action', { detail: 'x' }));
            expect(captured?.audit).toBe(true);
        });
    });

    describe('performance()', () => {
        it('logs without throwing', () => {
            const l = silentLogger();
            expect(() => captureConsole(() => l.performance('download', 1234, { bytes: 512 }))).not.toThrow();
        });
    });

    describe('security()', () => {
        it('logs without throwing', () => {
            const l = silentLogger();
            expect(() => captureConsole(() => l.security('suspicious_ip', { ip: '1.2.3.4' }))).not.toThrow();
        });

        it('supports warn severity', () => {
            const l = silentLogger();
            const lines = captureConsole(() => l.security('bad_request', {}, 'warn'));
            expect(lines.some(ln => ln.includes('Security'))).toBe(true);
        });
    });

    describe('getStats()', () => {
        it('returns logsWritten, uptime, config, contextDepth', () => {
            const l = silentLogger();
            captureConsole(() => l.info('x'));
            const stats = l.getStats();
            expect(stats.logsWritten).toBeGreaterThanOrEqual(1);
            expect(stats.uptime).toBeGreaterThanOrEqual(0);
            expect(stats.config.level).toBe('trace');
            expect(stats.contextDepth).toBe(0);
        });

        it('includes correlationId in stats', () => {
            const l = silentLogger();
            l.setCorrelationId('stat-corr');
            expect(l.getStats().correlationId).toBe('stat-corr');
        });
    });

    describe('flush() / shutdown()', () => {
        it('flush() resolves without error', async () => {
            const l = silentLogger();
            await expect(l.flush()).resolves.toBeUndefined();
        });

        it('shutdown() resolves without error', async () => {
            const l = silentLogger();
            await expect(l.shutdown()).resolves.toBeUndefined();
        });
    });

    describe('file output', () => {
        it('writes log lines to file', () => {
            const dir = makeTempDir();
            const logDir = path.join(dir, 'logs');
            const l = new Logger({ outputs: ['file'], logDir, format: 'text', level: 'info' });
            captureConsole(() => l.info('file test message'));
            const files = fs.readdirSync(logDir);
            const logFile = files.find(f => f.endsWith('.log'));
            expect(logFile).toBeDefined();
            const content = fs.readFileSync(path.join(logDir, logFile), 'utf8');
            expect(content).toContain('file test message');
        });

        it('writes JSON format to file', () => {
            const dir = makeTempDir();
            const logDir = path.join(dir, 'logs');
            const l = new Logger({ outputs: ['file'], logDir, format: 'json', level: 'info' });
            captureConsole(() => l.info('json line'));
            const files = fs.readdirSync(logDir);
            const logFile = files.find(f => f.endsWith('.log'));
            const content = fs.readFileSync(path.join(logDir, logFile), 'utf8');
            expect(() => JSON.parse(content.trim().split('\n')[0])).not.toThrow();
        });

        it('writes CSV format to file', () => {
            const dir = makeTempDir();
            const logDir = path.join(dir, 'logs');
            const l = new Logger({ outputs: ['file'], logDir, format: 'csv', level: 'info' });
            captureConsole(() => l.info('csv line'));
            const files = fs.readdirSync(logDir);
            const logFile = files.find(f => f.endsWith('.log'));
            const content = fs.readFileSync(path.join(logDir, logFile), 'utf8');
            expect(content).toContain(',');
        });
    });

    describe('text format console output', () => {
        it('emits colored output when enableColors=true', () => {
            const l = new Logger({ outputs: ['console'], format: 'text', level: 'info', enableColors: true });
            const lines = captureConsole(() => l.info('colored'));
            expect(lines.join('')).toContain('colored');
        });

        it('emits plain output when enableColors=false', () => {
            const l = new Logger({ outputs: ['console'], format: 'text', level: 'info', enableColors: false });
            const lines = captureConsole(() => l.warn('plain'));
            expect(lines.join('')).toContain('plain');
        });
    });

    describe('log rotation', () => {
        it('rotates file when size limit exceeded', () => {
            const dir = makeTempDir();
            const logDir = path.join(dir, 'logs');
            const l = new Logger({
                outputs: ['file'], logDir, format: 'text', level: 'info',
                maxFileSize: 10, // 10 bytes — tiny so rotation triggers immediately
                maxFiles: 3,
            });
            captureConsole(() => {
                l.info('line one that is definitely over 10 bytes');
                l.info('line two that is definitely over 10 bytes');
            });
            // At least one file should exist
            const files = fs.readdirSync(logDir);
            expect(files.length).toBeGreaterThan(0);
        });
    });

    describe('formatAsCSV / getCSVHeader', () => {
        it('produces comma-separated output', () => {
            const l = silentLogger({ format: 'csv' });
            const entry = l.createLogEntry('info', 'csv test', { key: 'val' }, null);
            const csv = l.formatAsCSV(entry);
            expect(csv).toContain(',');
            expect(csv).toContain('INFO');
        });

        it('getCSVHeader returns a header row', () => {
            const l = silentLogger();
            const header = l.getCSVHeader();
            expect(header).toContain('timestamp');
            expect(header).toContain('level');
        });
    });
});
