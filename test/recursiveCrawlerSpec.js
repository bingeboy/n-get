'use strict';
/**
 * @fileoverview Tests for lib/recursiveCrawler.js
 *
 * Contracts covered:
 * - glob pattern matching and accept/reject filtering (reject wins)
 * - crawl eligibility: depth limit, revisit guard, no-parent restriction,
 *   external-host restriction
 * - URL extraction from HTML: attribute/CSS sources, relative-vs-absolute
 *   resolution, scheme filtering, dedup, srcset splitting
 * - crawlable vs downloadable classification
 * - robots.txt parsing and enforcement
 * - local path generation (directory structure recreation)
 * - crawl loop: cycle termination, depth enforcement, discovery-not-download
 * - error paths: HTTP error status, unreachable host, non-HTML content
 * - bounded memory (cleanupMemory) and stats/reset
 *
 * All HTTP traffic goes to a local node:http server on an ephemeral port.
 * The module's own politeness delay is set to 1ms — it cannot be 0 because
 * of the `options.delayMs || 1000` default (reported upstream).
 */

const path = require('node:path');
const http = require('node:http');

const RecursiveCrawler = require('../lib/recursiveCrawler.js');

// ─── Local fixture server ─────────────────────────────────────────────────────

let server;
let origin;
let requests; // paths requested since last reset
let routes;   // path -> {status?, contentType?, body?}

before(() => new Promise(resolve => {
    server = http.createServer((req, res) => {
        requests.push(req.url);
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

beforeEach(() => {
    requests = [];
    routes = {};
});

// Fast, network-quiet crawler for unit tests. delayMs cannot be 0 (see header).
function makeCrawler(overrides = {}) {
    return new RecursiveCrawler({delayMs: 1, respectRobotsTxt: false, ...overrides});
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RecursiveCrawler', () => {

    describe('globToRegex', () => {
        it('anchors the pattern — *.pdf must not match report.pdfx', () => {
            const regex = makeCrawler().globToRegex('*.pdf');
            expect(regex.test('report.pdf')).to.be.true;
            expect(regex.test('report.pdfx')).to.be.false;
            expect(regex.test('xreport.pdf')).to.be.true; // * covers any prefix
        });

        it('treats ? as exactly one character', () => {
            const regex = makeCrawler().globToRegex('file?.txt');
            expect(regex.test('file1.txt')).to.be.true;
            expect(regex.test('file.txt')).to.be.false;
            expect(regex.test('file12.txt')).to.be.false;
        });

        it('is case-insensitive', () => {
            expect(makeCrawler().globToRegex('*.PDF').test('report.pdf')).to.be.true;
        });

        it('escapes regex metacharacters so they match literally', () => {
            const regex = makeCrawler().globToRegex('file(1).txt');
            expect(regex.test('file(1).txt')).to.be.true;
            expect(regex.test('file1.txt')).to.be.false;
            // Unescaped dot must not act as a wildcard
            expect(makeCrawler().globToRegex('a.b').test('aXb')).to.be.false;
        });
    });

    describe('shouldDownloadFile', () => {
        const url = s => new URL(s);

        it('accepts everything when no patterns are set', () => {
            expect(makeCrawler().shouldDownloadFile(url('http://x/any.bin'))).to.be.true;
        });

        it('with accept patterns, only matching files pass', () => {
            const crawler = makeCrawler({acceptPatterns: ['*.pdf', '*.zip']});
            expect(crawler.shouldDownloadFile(url('http://x/doc.pdf'))).to.be.true;
            expect(crawler.shouldDownloadFile(url('http://x/data.zip'))).to.be.true;
            expect(crawler.shouldDownloadFile(url('http://x/image.png'))).to.be.false;
        });

        it('reject patterns exclude matching files', () => {
            const crawler = makeCrawler({rejectPatterns: ['*.exe']});
            expect(crawler.shouldDownloadFile(url('http://x/setup.exe'))).to.be.false;
            expect(crawler.shouldDownloadFile(url('http://x/doc.pdf'))).to.be.true;
        });

        it('reject wins over accept for the same file', () => {
            const crawler = makeCrawler({acceptPatterns: ['*.pdf'], rejectPatterns: ['secret*']});
            expect(crawler.shouldDownloadFile(url('http://x/secret-plan.pdf'))).to.be.false;
            expect(crawler.shouldDownloadFile(url('http://x/public.pdf'))).to.be.true;
        });
    });

    describe('shouldCrawlUrl', () => {
        it('refuses URLs at or beyond maxDepth', () => {
            const crawler = makeCrawler({maxDepth: 3});
            const u = new URL('http://host/page');
            expect(crawler.shouldCrawlUrl(u, 'http://host/', 2)).to.be.true;
            expect(crawler.shouldCrawlUrl(u, 'http://host/', 3)).to.be.false;
            expect(crawler.shouldCrawlUrl(u, 'http://host/', 4)).to.be.false;
        });

        it('refuses URLs already visited', () => {
            const crawler = makeCrawler();
            const u = new URL('http://host/page');
            expect(crawler.shouldCrawlUrl(u, 'http://host/', 0)).to.be.true;
            crawler.visited.add(u.toString());
            expect(crawler.shouldCrawlUrl(u, 'http://host/', 0)).to.be.false;
        });

        describe('noParent restriction', () => {
            it('allows descendants of the base directory', () => {
                const crawler = makeCrawler({noParent: true});
                const base = 'http://host/docs/index.html';
                expect(crawler.shouldCrawlUrl(new URL('http://host/docs/sub/page.html'), base, 0)).to.be.true;
                expect(crawler.shouldCrawlUrl(new URL('http://host/docs/other.html'), base, 0)).to.be.true;
            });

            it('refuses parents and siblings outside the base directory', () => {
                const crawler = makeCrawler({noParent: true});
                const base = 'http://host/docs/index.html';
                expect(crawler.shouldCrawlUrl(new URL('http://host/'), base, 0)).to.be.false;
                expect(crawler.shouldCrawlUrl(new URL('http://host/images/x.html'), base, 0)).to.be.false;
            });

            it('uses the base URL directory, stripping the filename', () => {
                const crawler = makeCrawler({noParent: true});
                // Base is a file — its directory /a/ is the fence, not /a/b.html
                expect(crawler.shouldCrawlUrl(new URL('http://host/a/c.html'), 'http://host/a/b.html', 0)).to.be.true;
            });
        });

        describe('external host restriction', () => {
            it('refuses other hosts by default', () => {
                const crawler = makeCrawler();
                expect(crawler.shouldCrawlUrl(new URL('http://other.example/x'), 'http://host/', 0)).to.be.false;
                expect(crawler.shouldCrawlUrl(new URL('http://host/x'), 'http://host/', 0)).to.be.true;
            });

            it('allows other hosts when followExternalLinks is set', () => {
                const crawler = makeCrawler({followExternalLinks: true});
                expect(crawler.shouldCrawlUrl(new URL('http://other.example/x'), 'http://host/', 0)).to.be.true;
            });
        });
    });

    describe('extractUrlsFromHtml', () => {
        const base = 'http://host/dir/page.html';

        it('extracts href and src attributes and resolves relative URLs', () => {
            const html = `
                <a href="child.html">c</a>
                <a href="/rooted.html">r</a>
                <a href="../up.html">u</a>
                <img src="pic.png">
                <script src="http://host/app.js"></script>`;
            const urls = makeCrawler().extractUrlsFromHtml(html, base);
            expect(urls).to.include('http://host/dir/child.html');
            expect(urls).to.include('http://host/rooted.html');
            expect(urls).to.include('http://host/up.html');
            expect(urls).to.include('http://host/dir/pic.png');
            expect(urls).to.include('http://host/app.js');
        });

        it('extracts CSS url() and @import references', () => {
            const html = `
                <style>
                  @import url("theme.css");
                  body { background: url('bg.png'); }
                </style>`;
            const urls = makeCrawler().extractUrlsFromHtml(html, base);
            expect(urls).to.include('http://host/dir/theme.css');
            expect(urls).to.include('http://host/dir/bg.png');
        });

        it('splits srcset entries and strips descriptors', () => {
            const html = '<img srcset="small.jpg 1x, big.jpg 2x">';
            const urls = makeCrawler().extractUrlsFromHtml(html, base);
            expect(urls).to.include('http://host/dir/small.jpg');
            expect(urls).to.include('http://host/dir/big.jpg');
        });

        it('skips data:, mailto:, tel:, javascript: and fragment-only links', () => {
            const html = `
                <a href="data:text/plain,hi">d</a>
                <a href="mailto:a@b.c">m</a>
                <a href="tel:+123">t</a>
                <a href="javascript:void(0)">j</a>
                <a href="#section">f</a>
                <a href="real.html">ok</a>`;
            const urls = makeCrawler().extractUrlsFromHtml(html, base);
            expect(urls).to.deep.include('http://host/dir/real.html');
            expect(urls.some(u => u.startsWith('data:'))).to.be.false;
            expect(urls.some(u => u.startsWith('mailto:'))).to.be.false;
            expect(urls.some(u => u.startsWith('tel:'))).to.be.false;
            expect(urls.some(u => u.startsWith('javascript:'))).to.be.false;
            expect(urls.some(u => u.includes('#section'))).to.be.false;
        });

        it('keeps only http and https URLs', () => {
            const html = '<a href="ftp://host/file.zip">f</a><a href="https://host/s.html">s</a>';
            const urls = makeCrawler().extractUrlsFromHtml(html, base);
            expect(urls.some(u => u.startsWith('ftp:'))).to.be.false;
            expect(urls).to.include('https://host/s.html');
        });

        it('deduplicates repeated references', () => {
            const html = '<a href="one.html">1</a><a href="one.html">1 again</a><img src="one.html">';
            const urls = makeCrawler().extractUrlsFromHtml(html, base);
            expect(urls.filter(u => u === 'http://host/dir/one.html')).to.have.length(1);
        });

        it('returns an empty array for HTML with no links', () => {
            expect(makeCrawler().extractUrlsFromHtml('<p>plain text</p>', base)).to.deep.equal([]);
        });
    });

    describe('classifyUrl', () => {
        const crawler = makeCrawler();

        it('classifies page-like URLs as crawlable', () => {
            expect(crawler.classifyUrl('http://h/index.html')).to.equal('crawlable');
            expect(crawler.classifyUrl('http://h/page.php')).to.equal('crawlable');
            expect(crawler.classifyUrl('http://h/about')).to.equal('crawlable');
            expect(crawler.classifyUrl('http://h/dir/')).to.equal('crawlable');
            expect(crawler.classifyUrl('http://h/')).to.equal('crawlable');
        });

        it('classifies known file extensions as downloadable', () => {
            expect(crawler.classifyUrl('http://h/doc.pdf')).to.equal('downloadable');
            expect(crawler.classifyUrl('http://h/a.zip')).to.equal('downloadable');
            expect(crawler.classifyUrl('http://h/i.jpg')).to.equal('downloadable');
            expect(crawler.classifyUrl('http://h/s.js')).to.equal('downloadable');
            expect(crawler.classifyUrl('http://h/s.css')).to.equal('downloadable');
        });

        it('treats unknown extensions as downloadable (safe default)', () => {
            expect(crawler.classifyUrl('http://h/data.xyz123')).to.equal('downloadable');
        });
    });

    describe('parseRobotsTxt', () => {
        it('blocks paths under a wildcard-agent Disallow prefix', () => {
            const crawler = makeCrawler();
            const robots = 'User-agent: *\nDisallow: /private/';
            expect(crawler.parseRobotsTxt(robots, 'http://h/private/page.html')).to.be.false;
            expect(crawler.parseRobotsTxt(robots, 'http://h/public/page.html')).to.be.true;
        });

        it('applies sections addressed to our user agent', () => {
            const crawler = makeCrawler({userAgent: 'n-get-crawler/1.0'});
            const robots = 'User-agent: n-get-crawler/1.0\nDisallow: /blocked/';
            expect(crawler.parseRobotsTxt(robots, 'http://h/blocked/x')).to.be.false;
        });

        it('ignores sections addressed to other agents', () => {
            const crawler = makeCrawler({userAgent: 'n-get-crawler/1.0'});
            const robots = 'User-agent: SomeOtherBot\nDisallow: /';
            expect(crawler.parseRobotsTxt(robots, 'http://h/anything')).to.be.true;
        });

        it('treats an empty Disallow as allow-all', () => {
            const crawler = makeCrawler();
            expect(crawler.parseRobotsTxt('User-agent: *\nDisallow:', 'http://h/x')).to.be.true;
        });
    });

    describe('generateLocalPath', () => {
        it('uses just the filename when directory structure is disabled', () => {
            const crawler = makeCrawler({createDirectoryStructure: false});
            expect(crawler.generateLocalPath('http://h/a/b/file.pdf', '/dest'))
                .to.equal(path.join('/dest', 'file.pdf'));
        });

        it('falls back to index.html when the URL has no filename', () => {
            const crawler = makeCrawler({createDirectoryStructure: false});
            expect(crawler.generateLocalPath('http://h/', '/dest'))
                .to.equal(path.join('/dest', 'index.html'));
        });

        it('recreates hostname and path structure', () => {
            const crawler = makeCrawler();
            expect(crawler.generateLocalPath('http://example.com/a/b/file.pdf', '/dest'))
                .to.equal(path.join('/dest', 'example.com', 'a', 'b', 'file.pdf'));
        });

        it('appends non-default ports to the hostname directory', () => {
            const crawler = makeCrawler();
            expect(crawler.generateLocalPath('http://example.com:8080/f.txt', '/dest'))
                .to.equal(path.join('/dest', 'example.com_8080', 'f.txt'));
        });

        it('maps the root path to index.html', () => {
            const crawler = makeCrawler();
            expect(crawler.generateLocalPath('http://example.com/', '/dest'))
                .to.equal(path.join('/dest', 'example.com', 'index.html'));
        });

        it('folds query strings into a safe filename, preserving the extension', () => {
            const crawler = makeCrawler();
            const result = crawler.generateLocalPath('http://example.com/page.html?a=1&b=2', '/dest');
            expect(result.endsWith('.html')).to.be.true;
            expect(result).to.include('page_a_1_b_2');
            expect(result).to.not.include('?');
            expect(result).to.not.include('&');
        });
    });

    describe('crawlUrl over HTTP', () => {
        it('returns a non-HTML response as a single downloadable item without counting a page visit', async() => {
            routes['/data.bin'] = {contentType: 'application/octet-stream', body: 'binary'};
            const crawler = makeCrawler();

            const items = await crawler.crawlUrl(`${origin}/data.bin`, 2, `${origin}/parent.html`);

            expect(items).to.deep.equal([{
                url: `${origin}/data.bin`,
                type: 'downloadable',
                depth: 2,
                parent: `${origin}/parent.html`,
            }]);
            expect(crawler.stats.pagesVisited).to.equal(0);
        });

        it('returns [] and counts an error for an HTTP error status', async() => {
            routes['/missing.html'] = {status: 404, body: 'gone'};
            const crawler = makeCrawler();

            const items = await crawler.crawlUrl(`${origin}/missing.html`);

            expect(items).to.deep.equal([]);
            expect(crawler.stats.errors).to.equal(1);
        });

        it('returns [] and counts an error for an unreachable host', async() => {
            const crawler = makeCrawler();

            // Port 1 on loopback — connection refused immediately
            const items = await crawler.crawlUrl('http://127.0.0.1:1/x.html');

            expect(items).to.deep.equal([]);
            expect(crawler.stats.errors).to.equal(1);
        });

        it('does not fetch a URL twice (revisit guard)', async() => {
            routes['/page.html'] = {body: '<p>no links</p>'};
            const crawler = makeCrawler();

            await crawler.crawlUrl(`${origin}/page.html`);
            const secondResult = await crawler.crawlUrl(`${origin}/page.html`);

            expect(secondResult).to.deep.equal([]);
            expect(requests.filter(p => p === '/page.html')).to.have.length(1);
        });

        it('honours a robots.txt Disallow before fetching the page', async() => {
            routes['/robots.txt'] = {contentType: 'text/plain', body: 'User-agent: *\nDisallow: /private/'};
            routes['/private/page.html'] = {body: '<a href="leak.html">x</a>'};
            const crawler = makeCrawler({respectRobotsTxt: true});

            const items = await crawler.crawlUrl(`${origin}/private/page.html`);

            expect(items).to.deep.equal([]);
            expect(requests).to.include('/robots.txt');
            expect(requests).to.not.include('/private/page.html');
        });

        it('does not fetch robots.txt when respectRobotsTxt is false', async() => {
            routes['/open.html'] = {body: '<p>hi</p>'};
            const crawler = makeCrawler(); // respectRobotsTxt: false

            await crawler.crawlUrl(`${origin}/open.html`);

            expect(requests).to.not.include('/robots.txt');
            expect(requests).to.include('/open.html');
        });
    });

    describe('crawl — full traversal', () => {
        it('terminates on cyclic links, enforces maxDepth, and discovers without downloading', async() => {
            // a(0) <-> b(1) cycle; b links c; c links doc3. With maxDepth 2,
            // c (depth 2) must not be crawled, so doc3 is never discovered.
            routes['/a.html'] = {body: '<a href="/b.html">b</a><a href="/doc1.pdf">1</a>'};
            routes['/b.html'] = {body: '<a href="/a.html">a</a><a href="/c.html">c</a><a href="/doc2.pdf">2</a>'};
            routes['/c.html'] = {body: '<a href="/doc3.pdf">3</a>'};
            const crawler = makeCrawler({maxDepth: 2});

            const downloads = await crawler.crawl([`${origin}/a.html`]);
            const urls = downloads.map(d => d.url);

            expect(urls).to.include(`${origin}/doc1.pdf`);
            expect(urls).to.include(`${origin}/doc2.pdf`);
            expect(urls).to.not.include(`${origin}/doc3.pdf`);

            // Each page fetched exactly once despite the a <-> b cycle
            expect(requests.filter(p => p === '/a.html')).to.have.length(1);
            expect(requests.filter(p => p === '/b.html')).to.have.length(1);
            expect(requests).to.not.include('/c.html');

            // Discovery must not download the files themselves
            expect(requests).to.not.include('/doc1.pdf');
            expect(requests).to.not.include('/doc2.pdf');

            // Depth bookkeeping on the discovered items
            const doc1 = downloads.find(d => d.url === `${origin}/doc1.pdf`);
            const doc2 = downloads.find(d => d.url === `${origin}/doc2.pdf`);
            expect(doc1.depth).to.equal(1);
            expect(doc1.parent).to.equal(`${origin}/a.html`);
            expect(doc2.depth).to.equal(2);
        });

        it('applies accept patterns during traversal', async() => {
            routes['/page.html'] = {body: '<a href="keep.pdf">k</a><a href="skip.zip">s</a>'};
            const crawler = makeCrawler({acceptPatterns: ['*.pdf']});

            const downloads = await crawler.crawl([`${origin}/page.html`]);
            const urls = downloads.map(d => d.url);

            expect(urls).to.include(`${origin}/keep.pdf`);
            expect(urls).to.not.include(`${origin}/skip.zip`);
        });

        it('classifies an initial URL that serves a file via its content type', async() => {
            routes['/report'] = {contentType: 'application/pdf', body: '%PDF-fake'};
            const crawler = makeCrawler();

            const downloads = await crawler.crawl([`${origin}/report`]);

            expect(downloads).to.have.length(1);
            expect(downloads[0].url).to.equal(`${origin}/report`);
            expect(downloads[0].type).to.equal('downloadable');
        });

        it('returns [] for a page with no links', async() => {
            routes['/empty.html'] = {body: '<p>nothing here</p>'};
            const crawler = makeCrawler();

            const downloads = await crawler.crawl([`${origin}/empty.html`]);

            expect(downloads).to.deep.equal([]);
            expect(crawler.stats.pagesVisited).to.equal(1);
        });
    });

    describe('memory bounds and state', () => {
        it('cleanupMemory trims visited and discovered to their limits, keeping recent entries', () => {
            const crawler = makeCrawler();
            crawler.maxVisitedEntries = 5;
            crawler.maxDiscoveredEntries = 4;
            crawler.cleanupThreshold = 8;

            for (let i = 0; i < 10; i++) {
                crawler.visited.add(`http://h/v${i}`);
                crawler.discovered.set(`http://h/d${i}`, {depth: 1, parent: null, type: 'crawlable'});
            }

            crawler.cleanupMemory();

            expect(crawler.visited.size).to.equal(5);
            expect(crawler.discovered.size).to.equal(4);
            // Most recent entries survive, oldest are evicted
            expect(crawler.visited.has('http://h/v9')).to.be.true;
            expect(crawler.visited.has('http://h/v0')).to.be.false;
            expect(crawler.discovered.has('http://h/d9')).to.be.true;
            expect(crawler.discovered.has('http://h/d0')).to.be.false;
        });

        it('does nothing below the cleanup threshold', () => {
            const crawler = makeCrawler();
            crawler.visited.add('http://h/only');
            crawler.cleanupMemory();
            expect(crawler.visited.size).to.equal(1);
        });

        it('getStats reports counters plus visited/discovered sizes', () => {
            const crawler = makeCrawler();
            crawler.visited.add('http://h/a');
            crawler.discovered.set('http://h/b', {depth: 1, parent: null, type: 'downloadable'});
            crawler.stats.errors = 2;

            const stats = crawler.getStats();

            expect(stats.visitedUrls).to.equal(1);
            expect(stats.discoveredUrls).to.equal(1);
            expect(stats.errors).to.equal(2);
        });

        it('reset clears all crawl state', () => {
            const crawler = makeCrawler();
            crawler.visited.add('http://h/a');
            crawler.discovered.set('http://h/b', {depth: 1, parent: null, type: 'crawlable'});
            crawler.robotsCache.set('http://h/robots.txt', false);
            crawler.stats.pagesVisited = 7;

            crawler.reset();

            expect(crawler.visited.size).to.equal(0);
            expect(crawler.discovered.size).to.equal(0);
            expect(crawler.robotsCache.size).to.equal(0);
            expect(crawler.stats.pagesVisited).to.equal(0);
        });
    });
});
