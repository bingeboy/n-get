'use strict';
/**
 * @fileoverview Regression tests for recursive downloads in durable history
 * (issue #162).
 *
 * Flat downloads have always been written to .nget/. Recursive ones
 * were not: files fetched by a crawl completed successfully, appeared in the
 * live NDJSON stream, and then left no trace once the process exited. That
 * silently undermined the agent-identity work in #156 — provenance existed for
 * every download except the ones a crawl produced.
 *
 * Contracts covered here:
 * - every recursively downloaded file lands in history
 * - entries carry the caller's full identity (agent/session/request/conversation)
 * - entries carry crawl provenance: the depth found at and the linking page
 * - failures are recorded too, not just successes
 * - history collects at the -d destination rather than scattering through the
 *   recreated directory tree, because the reader looks in exactly one directory
 *
 * All HTTP traffic goes to a local node:http server on an ephemeral port.
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const RecursiveDownloader = require('../lib/recursiveDownloader.js');
const HistoryManager = require('../lib/services/HistoryManager.js');

// ─── Local fixture site ───────────────────────────────────────────────────────
//
//   /            → links to /docs/
//   /docs/       → links to two PDFs
//   /docs/*.pdf  → downloadable payloads (depth 2, parent /docs/)

let server;
let origin;
let routes;

before(() => new Promise(resolve => {
    server = http.createServer((req, res) => {
        const route = routes[req.url];
        if (!route) {
            res.writeHead(404, {'Content-Type': 'text/plain'});
            res.end('not found');
            return;
        }
        res.writeHead(200, {'Content-Type': route.contentType || 'text/html'});
        res.end(route.body || '');
    });
    server.listen(0, '127.0.0.1', () => {
        origin = `http://127.0.0.1:${server.address().port}`;
        resolve();
    });
}));

after(() => new Promise(resolve => server.close(resolve)));

const tempBase = path.join(__dirname, 'temp');
let tmpDir;
let originalCwd;

beforeEach(() => {
    routes = {
        '/': {body: '<a href="/docs/">docs</a>'},
        '/docs/': {body: '<a href="/docs/a.pdf">a</a><a href="/docs/b.pdf">b</a>'},
        '/docs/a.pdf': {contentType: 'application/pdf', body: 'PDF-A'},
        '/docs/b.pdf': {contentType: 'application/pdf', body: 'PDF-B'},
    };
    originalCwd = process.cwd();
    fs.mkdirSync(tempBase, {recursive: true});
    tmpDir = fs.mkdtempSync(path.join(tempBase, 'rec-hist-'));
});

afterEach(() => {
    // The download pipeline chdirs into destinations; restore defensively so a
    // leak cannot corrupt later specs.
    process.chdir(originalCwd);
    try {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    } catch {
        // best effort — Windows can hold brief locks on just-written files
    }
});

const IDENTITY = {
    agentId:        'agent-recursive',
    sessionId:      'sess-recursive',
    requestId:      'req-recursive',
    conversationId: 'conv-recursive',
};

function makeDownloader(overrides = {}) {
    return new RecursiveDownloader({
        level: 3,
        delayMs: 1,
        respectRobotsTxt: false,
        ...IDENTITY,
        ...overrides,
    });
}

/** Every .nget directory anywhere under root. */
function findHistoryDirs(root) {
    const found = [];
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            if (!entry.isDirectory()) { continue; }
            const full = path.join(dir, entry.name);
            if (entry.name === '.nget') { found.push(full); } else { walk(full); }
        }
    })(root);
    return found;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('recursive downloads — durable history (#162)', () => {

    it('records every recursively downloaded file in history', async() => {
        const results = await makeDownloader().recursiveDownload([origin], tmpDir);
        expect(results.filter(r => r.success)).to.have.length(2);

        const entries = await new HistoryManager().getHistory(tmpDir);
        expect(entries).to.have.length(2);

        const urls = entries.map(e => e.url).sort();
        expect(urls).to.deep.equal([`${origin}/docs/a.pdf`, `${origin}/docs/b.pdf`]);

        for (const entry of entries) {
            expect(entry.status).to.equal('success');
            expect(entry.size).to.be.a('number');
            // The recorded path is the real nested location on disk, even
            // though the entry itself was collected at the destination root.
            expect(entry.filePath).to.include('docs');
            expect(path.isAbsolute(entry.filePath)).to.be.true;
        }
    });

    it('persists the caller-supplied identity on recursive entries', async() => {
        await makeDownloader().recursiveDownload([origin], tmpDir);

        const entries = await new HistoryManager().getHistory(tmpDir);
        expect(entries).to.have.length(2);

        for (const entry of entries) {
            expect(entry.agentId).to.equal('agent-recursive');
            expect(entry.sessionId).to.equal('sess-recursive');
            expect(entry.requestId).to.equal('req-recursive');
            expect(entry.conversationId).to.equal('conv-recursive');
        }
    });

    it('records the generated session id when the caller supplies none', async() => {
        const dl = makeDownloader({sessionId: null, agentId: null, requestId: null, conversationId: null});
        await dl.recursiveDownload([origin], tmpDir);

        const entries = await new HistoryManager().getHistory(tmpDir);
        expect(entries).to.have.length(2);
        // Identity is absent, but the session id still ties history to the
        // NDJSON stream the run emitted.
        for (const entry of entries) {
            expect(entry.agentId).to.equal(null);
            expect(entry.sessionId).to.match(/^sess_/);
        }
    });

    it('groups one crawl under a single correlation id', async() => {
        await makeDownloader().recursiveDownload([origin], tmpDir);

        const entries = await new HistoryManager().getHistory(tmpDir);
        const ids = new Set(entries.map(e => e.correlationId));
        expect(ids.size).to.equal(1);
        expect([...ids][0]).to.match(/^recursive-/);
    });

    it('records crawl provenance — depth and the page that linked to the file', async() => {
        await makeDownloader().recursiveDownload([origin], tmpDir);

        const entries = await new HistoryManager().getHistory(tmpDir);
        expect(entries).to.have.length(2);

        for (const entry of entries) {
            expect(entry.metadata.recursive).to.be.true;
            // / → /docs/ → the pdf
            expect(entry.metadata.depth).to.equal(2);
            expect(entry.metadata.sourceUrl).to.equal(`${origin}/docs/`);
        }
    });

    it('records failed recursive downloads, not just successes', async() => {
        // Discoverable from the index page, but the fetch 404s.
        routes['/docs/'] = {body: '<a href="/docs/a.pdf">a</a><a href="/docs/missing.pdf">gone</a>'};

        await makeDownloader().recursiveDownload([origin], tmpDir);

        const entries = await new HistoryManager().getHistory(tmpDir);
        const failed = entries.filter(e => e.status === 'failed');
        expect(failed).to.have.length(1);
        expect(failed[0].url).to.equal(`${origin}/docs/missing.pdf`);
        expect(failed[0].error).to.be.a('string');
        // A failed entry still says where the file would have gone.
        expect(failed[0].filePath).to.include('missing.pdf');
        expect(failed[0].metadata.recursive).to.be.true;
    });

    it('collects history at the destination instead of scattering it through the tree', async() => {
        await makeDownloader().recursiveDownload([origin], tmpDir);

        const historyDirs = findHistoryDirs(tmpDir);
        expect(historyDirs).to.have.length(1);
        expect(path.dirname(historyDirs[0])).to.equal(fs.realpathSync(tmpDir));
    });

    it('surfaces recursive entries through the same identity filters as flat downloads', async() => {
        await makeDownloader().recursiveDownload([origin], tmpDir);

        const historyManager = new HistoryManager();
        expect(await historyManager.getHistory(tmpDir, {agentId: 'agent-recursive'})).to.have.length(2);
        expect(await historyManager.getHistory(tmpDir, {sessionId: 'sess-recursive'})).to.have.length(2);
        expect(await historyManager.getHistory(tmpDir, {agentId: 'someone-else'})).to.have.length(0);
    });
});

describe('HistoryManager.historyRoot override', () => {

    it('writes the entry to historyRoot rather than beside the file', async() => {
        const nested = path.join(tmpDir, 'deep', 'nested');
        fs.mkdirSync(nested, {recursive: true});

        await new HistoryManager().logDownload({
            url: 'http://example.com/x.bin',
            filePath: path.join(nested, 'x.bin'),
            historyRoot: tmpDir,
            status: 'success',
        });

        expect(await new HistoryManager().getHistory(tmpDir)).to.have.length(1);
        expect(await new HistoryManager().getHistory(nested)).to.have.length(0);
    });

    it('falls back to the file directory when historyRoot is absent', async() => {
        const nested = path.join(tmpDir, 'deep');
        fs.mkdirSync(nested, {recursive: true});

        await new HistoryManager().logDownload({
            url: 'http://example.com/y.bin',
            filePath: path.join(nested, 'y.bin'),
            status: 'success',
        });

        expect(await new HistoryManager().getHistory(nested)).to.have.length(1);
        expect(await new HistoryManager().getHistory(tmpDir)).to.have.length(0);
    });
});
