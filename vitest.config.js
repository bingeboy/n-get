const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    // *Spec.js only. A bare test/**/*.js glob also matched helper modules such
    // as test/fixtures/*, which contain no tests and are reported as failed
    // files ("No test suite found").
    include: ['test/**/*Spec.js'],
    // Network-dependent specs live in the integration suite instead — see
    // vitest.integration.config.js and `npm run test:integration`.
    exclude: [
      'test/vitest-setup.js',
      'test/indexSpec.js',
      'test/pipeSpec.js',
      'test/recursivePipeSpec.js',
      'test/fetchSpec.js',
      'test/stdoutSpec.js',
      'test/webhookSpec.js',
      '**/node_modules/**'
    ],
    testTimeout: 15000,
    globals: true,
    setupFiles: ['test/vitest-setup.js'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.js', 'index.js'],
      exclude: ['lib/**/*.ts', 'node_modules/**', 'test/**'],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage'
    }
  }
});
