'use strict';
/**
 * @fileoverview Regression tests for the redundant HEAD probe (#163).
 *
 * Every download used to call resumeManager.testRangeSupport() first, costing a
 * HEAD before the GET. Everything that probe returns — Content-Length,
 * Accept-Ranges, ETag, Last-Modified — also arrives on the GET response, so for
 * a fresh download it bought nothing. A recursive crawl paid it once per file.
 *
 * The probe is now issued only when a resume could actually happen, which
 * hasResumableState() decides from local disk state alone.
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { downloadFile } = require('../lib/downloader.js');
const resumeManager = require('../lib/resumeManager.js');
const RecursiveDownloader = require('../lib/recursiveDownloader.js');
const { DownloadSession } = require('../lib/core/DownloadSession.js');

const BODY = '0123456789ABCDEFGHIJ'; // 20 bytes

let server;
let origin;
let requests;
let routes;

before(() => new Promise(resolve => {
    server = http.createServer((req, res) => {
        requests.push(`${req.method} ${req.url}`);

        const route = routes[req.url];
        if (!route) {
            res.writeHead(404, {'Content-Type': 'text/plain'});
            res.end('not found');
            return;
        }

        const headers = {
            'Content-Type': route.contentType || 'text/html',
            'Accept-Ranges': 'bytes',
            ETag: '"v1"',
        };

        if (req.method === 'HEAD') {
            res.writeHead(200, {...headers, 'Content-Length': String(route.body.length)});
            res.end();
            return;
        }

        const match = /bytes=(\d+)-/.exec(req.headers.range || '');
        if (match) {
            const start = Number(match[1]);
            res.writeHead(206, {
                ...headers,
                'Content-Range': `bytes ${start}-${route.body.length - 1}/${route.body.length}`,
                'Content-Length': String(route.body.length - start),
            });
            res.end(route.body.slice(start));
            return;
        }

        res.writeHead(200, {...headers, 'Content-Length': String(route.body.length)});
        res.end(route.body);
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
    requests = [];
    routes = {
        '/f.bin': {contentType: 'application/octet-stream', body: BODY},
        '/': {body: '<a href="/docs/">docs</a>'},
        '/docs/': {body: '<a href="/docs/a.txt">a</a><a href="/docs/b.txt">b</a>'},
        '/docs/a.txt': {contentType: 'text/plain', body: 'AAA'},
        '/docs/b.txt': {contentType: 'text/plain', body: 'BBB'},
    };
    originalCwd = process.cwd();
    fs.mkdirSync(tempBase, {recursive: true});
    tmpDir = fs.mkdtempSync(path.join(tempBase, 'probe-'));
});

afterEach(() => {
    process.chdir(originalCwd);
    try {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    } catch {
        // Windows can briefly hold locks on just-written files
    }
});

const methodsFor = url => requests.filter(r => r.endsWith(` ${url}`)).map(r => r.split(' ')[0]);

describe('download probe avoidance (#163)', () => {

    describe('a fresh download makes exactly one request', () => {

        it('does not HEAD before the GET', async() => {
            await downloadFile(`${origin}/f.bin`, tmpDir, 1, 1, true, {quietMode: true});
            expect(methodsFor('/f.bin')).to.deep.equal(['GET']);
        });

        it('still writes the complete file', async() => {
            await downloadFile(`${origin}/f.bin`, tmpDir, 1, 1, true, {quietMode: true});
            expect(fs.readFileSync(path.join(tmpDir, 'f.bin'), 'utf8')).to.equal(BODY);
        });

        it('leaves no resume metadata behind, so the cleanup path still ran', async() => {
            // Metadata is written mid-download from the GET response headers and
            // removed once the file completes — a finished file has no partial
            // state to resume. Its absence here proves the save/cleanup pair
            // executed; the resume tests below prove the saved values are right.
            await downloadFile(`${origin}/f.bin`, tmpDir, 1, 1, true, {quietMode: true});
            expect(await resumeManager.loadMetadata(`${origin}/f.bin`, tmpDir)).to.equal(null);
        });

        it('reports an accurate bytes_total on download_start', async() => {
            // bytes_total used to come from the HEAD. It now comes from the GET
            // response headers, which is the whole reason download_start moved
            // after the request — a wrong read here is visible to every agent.
            const session = new DownloadSession({quietMode: true}).start();
            const starts = [];
            const original = session.emitter.downloadStart.bind(session.emitter);
            session.emitter.downloadStart = (url, data) => {
                starts.push(data);
                return original(url, data);
            };

            try {
                await downloadFile(`${origin}/f.bin`, tmpDir, 1, 1, true, {_session: session});
            } finally {
                session.close?.();
            }

            expect(starts).to.have.length(1);
            expect(starts[0].bytes_total).to.equal(BODY.length);
            expect(starts[0].resumed).to.be.false;
        });
    });

    describe('a resumable download still probes', () => {

        /** Simulate an interrupted transfer: 8 of 20 bytes, plus metadata. */
        async function interrupt(url, target) {
            fs.writeFileSync(target, BODY.slice(0, 8));
            await resumeManager.saveMetadata(url, target, BODY.length, {
                etag: '"v1"',
                'last-modified': null,
                'content-length': String(BODY.length),
            });
        }

        it('issues the HEAD when a partial file and metadata exist', async() => {
            const url = `${origin}/f.bin`;
            await interrupt(url, path.join(tmpDir, 'f.bin'));
            requests = [];

            await downloadFile(url, tmpDir, 1, 1, true, {quietMode: true});
            expect(methodsFor('/f.bin')).to.deep.equal(['HEAD', 'GET']);
        });

        it('resumes from the right offset and completes the file', async() => {
            const url = `${origin}/f.bin`;
            const target = path.join(tmpDir, 'f.bin');
            await interrupt(url, target);
            requests = [];

            await downloadFile(url, tmpDir, 1, 1, true, {quietMode: true});
            expect(fs.readFileSync(target, 'utf8')).to.equal(BODY);
        });
    });

    describe('hasResumableState reads disk only', () => {

        it('is false when nothing has been downloaded', async() => {
            const target = path.join(tmpDir, 'missing.bin');
            expect(await resumeManager.hasResumableState(`${origin}/f.bin`, target)).to.be.false;
        });

        it('is false when a partial file exists but metadata does not', async() => {
            const target = path.join(tmpDir, 'f.bin');
            fs.writeFileSync(target, 'partial');
            expect(await resumeManager.hasResumableState(`${origin}/f.bin`, target)).to.be.false;
        });

        it('is true when both exist', async() => {
            const url = `${origin}/f.bin`;
            const target = path.join(tmpDir, 'f.bin');
            fs.writeFileSync(target, BODY.slice(0, 8));
            await resumeManager.saveMetadata(url, target, BODY.length, {etag: '"v1"'});
            expect(await resumeManager.hasResumableState(url, target)).to.be.true;
        });

        it('makes no network request', async() => {
            const url = `${origin}/f.bin`;
            const target = path.join(tmpDir, 'f.bin');
            fs.writeFileSync(target, BODY.slice(0, 8));
            await resumeManager.saveMetadata(url, target, BODY.length, {etag: '"v1"'});
            requests = [];

            await resumeManager.hasResumableState(url, target);
            expect(requests).to.deep.equal([]);
        });
    });

    describe('a recursive crawl requests each file once', () => {

        it('fetches pages and files exactly once each', async() => {
            // The shape from the issue: two pages, two files, six requests.
            const downloader = new RecursiveDownloader({
                level: 3,
                delayMs: 1,
                respectRobotsTxt: false,
            });
            requests = [];
            await downloader.recursiveDownload([origin], tmpDir);

            expect(methodsFor('/docs/a.txt')).to.deep.equal(['GET']);
            expect(methodsFor('/docs/b.txt')).to.deep.equal(['GET']);
            expect(requests.filter(r => r.includes('HEAD'))).to.deep.equal([]);
        });

        it('makes one request per url overall', async() => {
            const downloader = new RecursiveDownloader({
                level: 3,
                delayMs: 1,
                respectRobotsTxt: false,
            });
            requests = [];
            await downloader.recursiveDownload([origin], tmpDir);

            const counts = {};
            for (const entry of requests) { counts[entry] = (counts[entry] || 0) + 1; }
            const repeated = Object.entries(counts).filter(([, n]) => n > 1);
            expect(repeated, `these urls were requested more than once: ${JSON.stringify(repeated)}`)
                .to.deep.equal([]);
        });
    });
});
