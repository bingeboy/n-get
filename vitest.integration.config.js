// Integration suite — requires a live network.
//
// These specs are excluded from the default `npm test` run (see
// vitest.config.js) because they shell out to the real CLI and hit external
// hosts. Run them explicitly with `npm run test:integration`. They are
// deliberately NOT part of CI.
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
        // Subprocesses write to shared temp dirs; running files in sequence
        // avoids cross-test interference.
        fileParallelism: false,
    },
});
