'use strict';
/**
 * @fileoverview Vitest globalSetup for the integration suite.
 *
 * Starts the local httpbin stand-in once for the whole run and publishes its
 * origin as NGET_TEST_ORIGIN. The integration specs shell out to the CLI via
 * execSync, and child processes inherit process.env, so the spawned
 * `node index.js ...` reaches the fixture without extra plumbing.
 *
 * Exported as a single default function returning its teardown. Vitest loads
 * this through Vite's ESM pipeline, so `module.exports = {setup, teardown}`
 * surfaces as `default` and is rejected — the default export must be callable.
 */

const fs = require('node:fs');
const {startFixtureServer} = require('./server');
const {ORIGIN_FILE} = require('./origin');

module.exports = async function globalSetup() {
    const {server, origin} = await startFixtureServer();

    // Env var covers the main process and anything it spawns; the file covers
    // worker threads, which do not see env mutations made after they start.
    process.env.NGET_TEST_ORIGIN = origin;
    fs.writeFileSync(ORIGIN_FILE, origin);

    console.log(`[fixtures] local httpbin stand-in listening on ${origin}`);

    return async function teardown() {
        await new Promise(resolve => server.close(resolve));
        try { fs.unlinkSync(ORIGIN_FILE); } catch { /* already gone */ }
    };
};
