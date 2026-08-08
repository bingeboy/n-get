'use strict';
/**
 * @fileoverview Resolves the fixture server's origin from a test spec.
 *
 * globalSetup runs in Vitest's main process, but specs run in worker threads,
 * and `process.env` mutations made after a worker starts are not visible to it.
 * So the origin is also written to a file that any worker can read
 * synchronously at module load. The env var is preferred when present, which
 * covers running a spec directly.
 */

const fs = require('node:fs');
const path = require('node:path');

const ORIGIN_FILE = path.join(__dirname, '.origin');

function readOrigin() {
    if (process.env.NGET_TEST_ORIGIN) {
        return process.env.NGET_TEST_ORIGIN;
    }
    try {
        return fs.readFileSync(ORIGIN_FILE, 'utf8').trim();
    } catch {
        throw new Error(
            'Fixture server origin unavailable. Run the integration suite via ' +
            '`npm run test:integration` so globalSetup starts test/fixtures/server.js.',
        );
    }
}

module.exports = {readOrigin, ORIGIN_FILE};
