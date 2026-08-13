'use strict';
/**
 * @fileoverview End-to-end tests for the recursive CLI surface (-R/--recursive,
 * --level, --no-parent) — the advertised contract from --help and
 * --capabilities (limits.recursion), wired in index.ts.
 *
 * Each test spawns the real CLI as a child process against a local node:http
 * server on an ephemeral port. Child processes exit before assertions run
 * (awaited on the close event), and the server closes in afterAll. The CLI has
 * no crawl-delay flag, so each crawled page costs the crawler's default 1s
 * politeness delay — sites here are kept to 1-2 pages.
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');

const repoRoot = path.join(__dirname, '..');
const indexJs = path.join(repoRoot, 'index.js');

// ─── Local fixture server ─────────────────────────────────────────────────────

let server;
let origin;
let requests;
let routes;

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

const tempBase = path.join(__dirname, 'temp');
let tmpDir;

beforeEach(() => {
    requests = [];
    routes = {};
    fs.mkdirSync(tempBase, {recursive: true});
    tmpDir = fs.mkdtempSync(path.join(tempBase, 'rec-cli-'));
});

afterEach(() => {
    try {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    } catch {
        // best effort — Windows can hold brief locks
    }
});

/**
 * Run the CLI and resolve with {code, stdout, stderr} once it exits.
 */
function runCli(args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [indexJs, ...args], {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {...process.env, NODE_ENV: 'test'},
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => { stdout += d.toString(); });
        child.stderr.on('data', d => { stderr += d.toString(); });
        child.on('error', reject);
        child.on('close', code => resolve({code, stdout, stderr}));
    });
}

function hostDir(base) {
    const port = new URL(origin).port;
    return path.join(base, `127.0.0.1_${port}`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('recursive CLI (-R / --recursive)', () => {

    it('-R crawls the start page and downloads discovered files', async() => {
        routes['/site/index.html'] = {body: '<a href="a.pdf">a</a>'};
        routes['/site/a.pdf'] = {contentType: 'application/pdf', body: 'CLI-PDF-A'};

        const result = await runCli(['-R', `${origin}/site/index.html`], tmpDir);

        expect(result.code).to.equal(0);
        const downloaded = path.join(hostDir(tmpDir), 'site', 'a.pdf');
        expect(fs.readFileSync(downloaded, 'utf8')).to.equal('CLI-PDF-A');
        // The crawl actually happened over HTTP
        expect(requests).to.include('/site/index.html');
        expect(requests).to.include('/site/a.pdf');
    });

    it('--level 1 stops traversal at the advertised default-style depth bound', async() => {
        routes['/deep/index.html'] = {body: '<a href="page2.html">p2</a><a href="top.pdf">t</a>'};
        routes['/deep/page2.html'] = {body: '<a href="deep.pdf">d</a>'};
        routes['/deep/top.pdf'] = {contentType: 'application/pdf', body: 'TOP'};
        routes['/deep/deep.pdf'] = {contentType: 'application/pdf', body: 'DEEP'};

        const result = await runCli(['-R', '--level', '1', `${origin}/deep/index.html`], tmpDir);

        expect(result.code).to.equal(0);
        expect(fs.existsSync(path.join(hostDir(tmpDir), 'deep', 'top.pdf'))).to.be.true;
        // page2 is at the depth limit: never crawled, so deep.pdf never found
        expect(requests).to.not.include('/deep/page2.html');
        expect(fs.existsSync(path.join(hostDir(tmpDir), 'deep', 'deep.pdf'))).to.be.false;
    });

    it('--no-parent fences the crawl to the start directory', async() => {
        routes['/docs/index.html'] = {body: `<a href="${origin}/up.html">up</a><a href="inner.pdf">i</a>`};
        routes['/up.html'] = {body: '<a href="secret.pdf">s</a>'};
        routes['/docs/inner.pdf'] = {contentType: 'application/pdf', body: 'INNER'};
        routes['/secret.pdf'] = {contentType: 'application/pdf', body: 'SECRET'};

        const result = await runCli(['-R', '--no-parent', `${origin}/docs/index.html`], tmpDir);

        expect(result.code).to.equal(0);
        expect(fs.existsSync(path.join(hostDir(tmpDir), 'docs', 'inner.pdf'))).to.be.true;
        // The parent-directory page was never crawled, so its file was never found
        expect(requests).to.not.include('/up.html');
        expect(fs.existsSync(path.join(hostDir(tmpDir), 'secret.pdf'))).to.be.false;
    });

    it('-A filters downloads by accept pattern', async() => {
        routes['/mix/index.html'] = {body: '<a href="keep.pdf">k</a><a href="skip.zip">s</a>'};
        routes['/mix/keep.pdf'] = {contentType: 'application/pdf', body: 'KEEP'};
        routes['/mix/skip.zip'] = {contentType: 'application/zip', body: 'SKIP'};

        const result = await runCli(['-R', '-A', '*.pdf', `${origin}/mix/index.html`], tmpDir);

        expect(result.code).to.equal(0);
        expect(fs.existsSync(path.join(hostDir(tmpDir), 'mix', 'keep.pdf'))).to.be.true;
        expect(fs.existsSync(path.join(hostDir(tmpDir), 'mix', 'skip.zip'))).to.be.false;
        expect(requests).to.not.include('/mix/skip.zip');
    });

    it('rejects recursive mode combined with stdout output', async() => {
        const viaOutputFile = await runCli(['-R', '-o', '-', `${origin}/x.html`], tmpDir);
        expect(viaOutputFile.code).to.equal(1);
        expect(viaOutputFile.stdout + viaOutputFile.stderr)
            .to.include('Recursive mode is not compatible with --stdout');

        const viaStdoutFlag = await runCli(['--stdout', '--recursive', `${origin}/x.html`], tmpDir);
        expect(viaStdoutFlag.code).to.equal(1);
        expect(viaStdoutFlag.stdout + viaStdoutFlag.stderr)
            .to.include('Recursive mode is not compatible with --stdout');
    });

    it('rejects --level outside the advertised 1-50 range', async() => {
        for (const bad of ['0', '51', 'abc']) {
            // eslint-disable-next-line no-await-in-loop
            const result = await runCli(['-R', '--level', bad, `${origin}/x.html`], tmpDir);
            expect(result.code).to.equal(1);
            expect(result.stdout + result.stderr).to.include('--level must be a number between 1 and 50');
        }
        // Nothing was ever fetched for invalid input
        expect(requests).to.deep.equal([]);
    });
});
