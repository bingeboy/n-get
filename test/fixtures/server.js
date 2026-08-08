'use strict';
/**
 * @fileoverview Local stand-in for the httpbin.org endpoints the integration
 * suite uses.
 *
 * The integration specs previously hit https://httpbin.org directly, which made
 * them fail whenever that public service was slow, rate-limiting or down — it
 * was returning 503 for most of a run while this suite was being revived. A
 * test that goes red because someone else's server is unhappy teaches people to
 * ignore red.
 *
 * Only the endpoints actually exercised by the specs are implemented, and the
 * response shapes match httpbin closely enough for the existing assertions.
 */

const http = require('node:http');

function sendJson(res, status, body) {
    const payload = JSON.stringify(body, null, 2);
    res.writeHead(status, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
}

function sendText(res, status, text, contentType = 'text/plain') {
    res.writeHead(status, {
        'content-type': contentType,
        'content-length': Buffer.byteLength(text),
    });
    res.end(text);
}

/** Collect the request body, then invoke `done` with it as a string. */
function readBody(req, done) {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => done(body));
}

/**
 * httpbin reports header names title-cased (`X-Custom-Header`), while Node
 * lower-cases them on the request object. Specs assert the httpbin spelling.
 */
function titleCaseHeaders(headers) {
    const out = {};
    for (const [k, v] of Object.entries(headers)) {
        out[k.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('-')] = v;
    }
    return out;
}

/** httpbin's /get|/post|/put|/delete echo shape. */
function echoShape(req, requestUrl, body) {
    let json = null;
    if (body) {
        try { json = JSON.parse(body); } catch { json = null; }
    }
    return {
        args: Object.fromEntries(requestUrl.searchParams),
        data: body || '',
        files: {},
        form: {},
        headers: titleCaseHeaders(req.headers),
        json,
        origin: req.socket.remoteAddress,
        url: requestUrl.href,
    };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function createFixtureServer() {
    const server = http.createServer((req, res) => {
        const requestUrl = new URL(req.url, `http://${req.headers.host}`);
        const p = requestUrl.pathname;

        // /status/<code>
        const statusMatch = p.match(/^\/status\/(\d{3})$/);
        if (statusMatch) {
            const code = Number(statusMatch[1]);
            // httpbin returns the reason phrase upper-cased ("NOT FOUND");
            // Node's default is title case ("Not Found").
            res.statusMessage = (http.STATUS_CODES[code] || 'UNKNOWN').toUpperCase();
            res.writeHead(code, {'content-type': 'text/plain'});
            res.end('');
            return;
        }

        // /base64/<payload>
        const b64Match = p.match(/^\/base64\/(.+)$/);
        if (b64Match) {
            let decoded;
            try {
                decoded = Buffer.from(decodeURIComponent(b64Match[1]), 'base64').toString('utf8');
            } catch {
                decoded = '';
            }
            sendText(res, 200, decoded);
            return;
        }

        // /delay/<seconds> — capped so a hung test cannot wedge the suite.
        const delayMatch = p.match(/^\/delay\/(\d+)$/);
        if (delayMatch) {
            const seconds = Math.min(Number(delayMatch[1]), 10);
            setTimeout(() => sendJson(res, 200, echoShape(req, requestUrl, '')), seconds * 1000);
            return;
        }

        switch (p) {
            case '/json':
                sendJson(res, 200, {
                    slideshow: {
                        author: 'Yours Truly',
                        date: 'date of publication',
                        slides: [
                            {title: 'Wake up to WonderWidgets!', type: 'all'},
                            {
                                items: ['Why <em>WonderWidgets</em> are great', 'Who <em>buys</em> WonderWidgets'],
                                title: 'Overview',
                                type: 'all',
                            },
                        ],
                        title: 'Sample Slide Show',
                    },
                });
                return;

            case '/uuid':
                sendJson(res, 200, {uuid: require('node:crypto').randomUUID()});
                return;

            case '/ip':
                sendJson(res, 200, {origin: req.socket.remoteAddress});
                return;

            case '/user-agent':
                sendJson(res, 200, {'user-agent': req.headers['user-agent'] || null});
                return;

            case '/headers':
                sendJson(res, 200, {headers: titleCaseHeaders(req.headers)});
                return;

            case '/robots.txt':
                sendText(res, 200, 'User-agent: *\nDisallow: /deny\n');
                return;

            case '/html':
                sendText(
                    res,
                    200,
                    '<!DOCTYPE html>\n<html>\n  <head></head>\n  <body>\n    <h1>Herman Melville - Moby-Dick</h1>\n  </body>\n</html>',
                    'text/html',
                );
                return;

            case '/get':
                sendJson(res, 200, echoShape(req, requestUrl, ''));
                return;

            case '/post':
            case '/put':
            case '/delete':
                readBody(req, body => sendJson(res, 200, echoShape(req, requestUrl, body)));
                return;

            default:
                sendJson(res, 404, {error: 'Not Found', path: p});
        }
    });

    return server;
}

/** Start on an ephemeral port; resolves with {server, origin}. */
function startFixtureServer() {
    return new Promise(resolve => {
        const server = createFixtureServer();
        server.listen(0, '127.0.0.1', () => {
            const {port} = server.address();
            resolve({server, origin: `http://127.0.0.1:${port}`});
        });
    });
}

module.exports = {createFixtureServer, startFixtureServer, UUID_RE};
