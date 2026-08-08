// Integration suite — exercises the real CLI end to end.
//
// These specs are excluded from the default `npm test` run (see
// vitest.config.js) because they shell out to `node index.js` as a subprocess.
// Run them with `npm run test:integration`.
//
// HTTP traffic goes to a local fixture server (test/fixtures/), not to
// httpbin.org, so the suite no longer fails when a third-party service is down.
// A handful of specs still resolve deliberately-invalid hostnames to exercise
// DNS failure; those fail fast offline and need no network.
const {defineConfig} = require('vitest/config');

module.exports = defineConfig({
    test: {
        include: [
            'test/indexSpec.js',
            'test/pipeSpec.js',
            'test/recursivePipeSpec.js',
            'test/fetchSpec.js',
            'test/stdoutSpec.js',
            'test/webhookSpec.js',
        ],
        // Network round-trips and subprocess spawns are slower than the unit
        // suite's 15s budget.
        testTimeout: 30000,
        hookTimeout: 30000,
        globals: true,
        setupFiles: ['test/vitest-setup.js'],
        // Starts the fixture server once per run and exports NGET_TEST_ORIGIN.
        globalSetup: ['test/fixtures/global-setup.js'],
        // Subprocesses write to shared temp dirs; running files in sequence
        // avoids cross-test interference.
        fileParallelism: false,
    },
});
