'use strict';
/**
 * @fileoverview Tests for lib/recursiveDownloader.js
 *
 * Contracts covered:
 * - option mapping into the embedded crawler (level alias, defaults,
 *   crawl-concurrency cap)
 * - parsePatterns normalisation (CSV string, arrays, junk input)
 * - directory creation (ensureDirectoryExists, structure recreation before
 *   downloads start)
 * - recursiveDownload input validation and the "nothing discovered" path
 * - per-file error isolation in downloadWithCustomPaths: one bad URL must
 *   not abort the batch or throw
 * - getDownloadStats shape
 *
 * The successful download path (downloadSingleFile rename, full Phase-2) is
 * covered against the local server now that lib/downloader exposes
 * downloadFile as a property of its batch export.
 *
 * All HTTP traffic goes to a local node:http server on an ephemeral port.
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const RecursiveDownloader = require('../lib/recursiveDownloader.js');

// ─── Local fixture server ─────────────────────────────────────────────────────

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
        res.writeHead(route.status || 200, {'Content-Type': route.contentType || 'text/html'});
        res.end(route.body || '');
    });
    server.listen(0, '127.0.0.1', () => {
        origin = `http://127.0.0.1:${server.address().port}`;
        resolve();
    });
}));

after(() => new Promise(resolve => server.close(resolve)));

// Temp dirs live under test/temp (inside the repo) because the download
// pipeline's security validation rejects destinations outside the CWD.
const tempBase = path.join(__dirname, 'temp');
let tmpDir;
let originalCwd;

beforeEach(() => {
    routes = {};
    originalCwd = process.cwd();
    fs.mkdirSync(tempBase, {recursive: true});
    tmpDir = fs.mkdtempSync(path.join(tempBase, 'rec-dl-'));
});

afterEach(() => {
    // The underlying download pipeline chdirs into destinations; restore
    // defensively so a leak can never corrupt later specs.
    process.chdir(originalCwd);
    try {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    } catch {
        // best effort — Windows can hold brief locks
    }
});

function makeDownloader(overrides = {}) {
    return new RecursiveDownloader({delayMs: 1, respectRobotsTxt: false, ...overrides});
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RecursiveDownloader', () => {

    describe('constructor option mapping', () => {
        it('applies documented defaults', () => {
            const dl = new RecursiveDownloader();
            expect(dl.options.maxDepth).to.equal(5);
            expect(dl.options.noParent).to.be.false;
            expect(dl.options.enableResume).to.be.true;
            expect(dl.options.createDirectoryStructure).to.be.true;
            expect(dl.options.maxConcurrentDownloads).to.equal(3);
            expect(dl.options.respectRobotsTxt).to.be.true;
        });

        it('level is an alias for maxDepth and takes precedence', () => {
            expect(new RecursiveDownloader({level: 2}).options.maxDepth).to.equal(2);
            expect(new RecursiveDownloader({level: 2, maxDepth: 9}).options.maxDepth).to.equal(2);
            expect(new RecursiveDownloader({maxDepth: 7}).options.maxDepth).to.equal(7);
        });

        it('threads crawl-relevant options into the embedded crawler', () => {
            const dl = new RecursiveDownloader({
                level: 3,
                noParent: true,
                accept: ['*.pdf'],
                reject: ['*.exe'],
                followExternalLinks: true,
                userAgent: 'custom-agent/2.0',
            });
            expect(dl.crawler.options.maxDepth).to.equal(3);
            expect(dl.crawler.options.noParent).to.be.true;
            expect(dl.crawler.options.acceptPatterns).to.deep.equal(['*.pdf']);
            expect(dl.crawler.options.rejectPatterns).to.deep.equal(['*.exe']);
            expect(dl.crawler.options.followExternalLinks).to.be.true;
            expect(dl.crawler.options.userAgent).to.equal('custom-agent/2.0');
        });

        it('caps crawl concurrency at 3 regardless of download concurrency', () => {
            expect(new RecursiveDownloader({maxConcurrentDownloads: 10}).crawler.options.maxConcurrent).to.equal(3);
            expect(new RecursiveDownloader({maxConcurrentDownloads: 2}).crawler.options.maxConcurrent).to.equal(2);
        });

        it('explicit false disables resume and directory structure', () => {
            const dl = new RecursiveDownloader({enableResume: false, createDirectoryStructure: false});
            expect(dl.options.enableResume).to.be.false;
            expect(dl.options.createDirectoryStructure).to.be.false;
        });
    });

    describe('downloader export (regression)', () => {
        it('lib/downloader exposes downloadFile on the batch export', () => {
            // downloadSingleFile destructures {downloadFile} from lib/downloader.
            // This was undefined before the property was attached, making every
            // recursive per-file download throw before reaching the network.
            const downloader = require('../lib/downloader.js');
            expect(downloader).to.be.a('function');
            expect(downloader.downloadFile).to.be.a('function');
        });
    });

    describe('constructor pattern normalisation (regression)', () => {
        it('accepts CSV strings for accept/reject and parses them into arrays', () => {
            const dl = new RecursiveDownloader({accept: '*.pdf, *.zip', reject: '*.exe'});
            expect(dl.options.acceptPatterns).to.deep.equal(['*.pdf', '*.zip']);
            expect(dl.options.rejectPatterns).to.deep.equal(['*.exe']);
            expect(dl.crawler.options.acceptPatterns).to.deep.equal(['*.pdf', '*.zip']);
        });

        it('honours an explicit delayMs of 0', () => {
            expect(new RecursiveDownloader({delayMs: 0}).options.delayMs).to.equal(0);
        });
    });

    describe('parsePatterns', () => {
        it('returns [] for null, undefined and non-string non-array input', () => {
            expect(RecursiveDownloader.parsePatterns(null)).to.deep.equal([]);
            expect(RecursiveDownloader.parsePatterns(undefined)).to.deep.equal([]);
            expect(RecursiveDownloader.parsePatterns(42)).to.deep.equal([]);
            expect(RecursiveDownloader.parsePatterns({glob: '*.pdf'})).to.deep.equal([]);
        });

        it('splits a CSV string, trimming whitespace and dropping empties', () => {
            expect(RecursiveDownloader.parsePatterns('*.pdf, *.zip ,,*.jpg'))
                .to.deep.equal(['*.pdf', '*.zip', '*.jpg']);
        });

        it('filters an array down to non-empty strings', () => {
            expect(RecursiveDownloader.parsePatterns(['*.pdf', '', 7, null, '*.zip']))
                .to.deep.equal(['*.pdf', '*.zip']);
        });
    });

    describe('ensureDirectoryExists', () => {
        it('creates nested parent directories for a file path', async() => {
            const dl = makeDownloader();
            const filePath = path.join(tmpDir, 'a', 'b', 'c', 'file.txt');

            await dl.ensureDirectoryExists(filePath);

            expect(fs.statSync(path.join(tmpDir, 'a', 'b', 'c')).isDirectory()).to.be.true;
        });

        it('is idempotent for existing directories', async() => {
            const dl = makeDownloader();
            const filePath = path.join(tmpDir, 'x', 'file.txt');
            await dl.ensureDirectoryExists(filePath);
            await dl.ensureDirectoryExists(filePath); // must not throw
            expect(fs.statSync(path.join(tmpDir, 'x')).isDirectory()).to.be.true;
        });
    });

    describe('recursiveDownload input validation', () => {
        it('rejects an empty URL list', async() => {
            try {
                await makeDownloader().recursiveDownload([], tmpDir);
                expect.fail('should have thrown');
            } catch (error) {
                expect(error.message).to.include('No URLs provided');
            }
        });

        it('rejects a non-array argument', async() => {
            try {
                await makeDownloader().recursiveDownload('http://x/', tmpDir);
                expect.fail('should have thrown');
            } catch (error) {
                expect(error.message).to.include('No URLs provided');
            }
        });
    });

    describe('recursiveDownload — discovery phase', () => {
        it('returns [] when the crawl finds no downloadable files', async() => {
            routes['/empty.html'] = {body: '<p>no links here</p>'};
            const dl = makeDownloader();

            const results = await dl.recursiveDownload([`${origin}/empty.html`], tmpDir);

            expect(results).to.deep.equal([]);
        });
    });

    describe('downloadDiscoveredFiles', () => {
        it('returns [] for an empty discovery list', async() => {
            const results = await makeDownloader().downloadDiscoveredFiles([], tmpDir);
            expect(results).to.deep.equal([]);
        });

        it('recreates the directory structure before downloading', async() => {
            const dl = makeDownloader();
            // Unreachable host: downloads fail, but structure creation happens first
            const discovered = [
                {url: 'http://127.0.0.1:1/docs/guides/intro.pdf', type: 'downloadable', depth: 1, parent: null},
                {url: 'http://127.0.0.1:1/assets/logo.png', type: 'downloadable', depth: 1, parent: null},
            ];

            await dl.downloadDiscoveredFiles(discovered, tmpDir);

            // generateLocalPath maps host:port to "host_port" directories
            expect(fs.statSync(path.join(tmpDir, '127.0.0.1_1', 'docs', 'guides')).isDirectory()).to.be.true;
            expect(fs.statSync(path.join(tmpDir, '127.0.0.1_1', 'assets')).isDirectory()).to.be.true;
        });
    });

    describe('downloadWithCustomPaths — per-file error isolation', () => {
        it('returns a failed result per URL instead of throwing when downloads fail', async() => {
            const dl = makeDownloader();
            const urls = ['http://127.0.0.1:1/a.pdf', 'http://127.0.0.1:1/b.pdf'];
            const urlToPathMap = new Map([
                [urls[0], path.join(tmpDir, 'a.pdf')],
                [urls[1], path.join(tmpDir, 'b.pdf')],
            ]);

            const results = await dl.downloadWithCustomPaths(urls, urlToPathMap, false, {});

            expect(results).to.have.length(2);
            for (const result of results) {
                expect(result.success).to.be.false;
                expect(result.error).to.be.a('string');
                expect(urls).to.include(result.url);
            }
        });
    });

    describe('downloadSingleFile — success path', () => {
        it('downloads a file and renames it to the requested target name', async() => {
            routes['/files/data.bin'] = {contentType: 'application/octet-stream', body: 'RECURSIVE-OK'};
            const dl = makeDownloader();
            const targetPath = path.join(tmpDir, 'renamed.bin');

            const result = await dl.downloadSingleFile(
                `${origin}/files/data.bin`, targetPath, 1, 1, false, {},
            );

            expect(result.path).to.equal(targetPath);
            expect(fs.readFileSync(targetPath, 'utf8')).to.equal('RECURSIVE-OK');
            // The as-downloaded name must be gone after the rename
            expect(fs.existsSync(path.join(tmpDir, 'data.bin'))).to.be.false;
        });

        it('keeps the name when the URL basename already matches', async() => {
            routes['/files/exact.bin'] = {contentType: 'application/octet-stream', body: 'EXACT'};
            const dl = makeDownloader();
            const targetPath = path.join(tmpDir, 'exact.bin');

            const result = await dl.downloadSingleFile(
                `${origin}/files/exact.bin`, targetPath, 1, 1, false, {},
            );

            expect(result.path).to.equal(targetPath);
            expect(fs.readFileSync(targetPath, 'utf8')).to.equal('EXACT');
        });
    });

    describe('recursiveDownload — full crawl and download (Phase 2)', () => {
        it('crawls a site and downloads discovered files into the recreated structure', async() => {
            routes['/site/index.html'] = {body: '<a href="a.pdf">a</a><a href="sub/b.pdf">b</a>'};
            routes['/site/a.pdf'] = {contentType: 'application/pdf', body: 'PDF-A'};
            routes['/site/sub/b.pdf'] = {contentType: 'application/pdf', body: 'PDF-B'};
            const dl = makeDownloader({enableResume: false});

            const results = await dl.recursiveDownload([`${origin}/site/index.html`], tmpDir);

            expect(results).to.have.length(2);
            expect(results.every(r => r.success)).to.be.true;

            const port = new URL(origin).port;
            const hostDir = path.join(tmpDir, `127.0.0.1_${port}`);
            expect(fs.readFileSync(path.join(hostDir, 'site', 'a.pdf'), 'utf8')).to.equal('PDF-A');
            expect(fs.readFileSync(path.join(hostDir, 'site', 'sub', 'b.pdf'), 'utf8')).to.equal('PDF-B');

            const stats = dl.getDownloadStats();
            expect(stats.downloadedFiles).to.equal(2);
            expect(stats.failedFiles).to.equal(0);
        });

        it('applies accept patterns end to end', async() => {
            routes['/mix/index.html'] = {body: '<a href="keep.pdf">k</a><a href="skip.zip">s</a>'};
            routes['/mix/keep.pdf'] = {contentType: 'application/pdf', body: 'KEEP'};
            routes['/mix/skip.zip'] = {contentType: 'application/zip', body: 'SKIP'};
            const dl = makeDownloader({enableResume: false, accept: '*.pdf'});

            const results = await dl.recursiveDownload([`${origin}/mix/index.html`], tmpDir);

            expect(results).to.have.length(1);
            expect(results[0].url).to.equal(`${origin}/mix/keep.pdf`);
            const port = new URL(origin).port;
            expect(fs.existsSync(path.join(tmpDir, `127.0.0.1_${port}`, 'mix', 'keep.pdf'))).to.be.true;
            expect(fs.existsSync(path.join(tmpDir, `127.0.0.1_${port}`, 'mix', 'skip.zip'))).to.be.false;
        });
    });

    describe('getDownloadStats', () => {
        it('merges downloader counters with crawler stats', () => {
            const dl = makeDownloader();
            const stats = dl.getDownloadStats();

            expect(stats).to.have.property('totalUrls');
            expect(stats).to.have.property('downloadedFiles');
            expect(stats).to.have.property('failedFiles');
            expect(stats.crawlStats).to.be.an('object');
            expect(stats.crawlStats).to.have.property('pagesVisited');
            expect(stats.crawlStats).to.have.property('visitedUrls');
        });
    });
});
