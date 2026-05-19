const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    include: ['test/**/*.js'],
    exclude: [
      'test/vitest-setup.js',
      'test/downloadSpec.js',
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
    setupFiles: ['test/vitest-setup.js']
  }
});
