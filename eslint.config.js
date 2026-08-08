// Flat config, covering both halves of the codebase:
//   - hand-written JavaScript: test/, scripts/ and the root config files
//   - TypeScript sources: lib/**/*.ts, index.ts, types/**/*.ts
//
// Deliberately NOT linted: index.js, lib/**/*.js, types/**/*.js — tsc output
// (outDir: "."), so every .js there has a .ts sibling that is the real source.
// Linting generated code produced thousands of phantom errors, including
// "rule not found" for the @typescript-eslint disable comments tsc copies over
// from the .ts.

const tseslint = require('typescript-eslint');

const NODE_GLOBALS = {
    console: 'readonly',
    process: 'readonly',
    Buffer: 'readonly',
    __dirname: 'readonly',
    __filename: 'readonly',
    module: 'readonly',
    require: 'readonly',
    exports: 'readonly',
    global: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    setImmediate: 'readonly',
    queueMicrotask: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
    TextEncoder: 'readonly',
    TextDecoder: 'readonly',
    AbortController: 'readonly',
    AbortSignal: 'readonly',
    fetch: 'readonly',
    Request: 'readonly',
    Response: 'readonly',
    Headers: 'readonly',
    structuredClone: 'readonly',
};

// Vitest injects these via globals: true (see vitest.config.js).
const VITEST_GLOBALS = {
    describe: 'readonly',
    it: 'readonly',
    test: 'readonly',
    suite: 'readonly',
    expect: 'readonly',
    vi: 'readonly',
    before: 'readonly',
    after: 'readonly',
    beforeEach: 'readonly',
    afterEach: 'readonly',
    beforeAll: 'readonly',
    afterAll: 'readonly',
};

module.exports = [
    {
        ignores: [
            'node_modules/**',
            'temp/**',
            'test/temp/**',
            'gh_pages/**',
            'coverage/**',
            '*.tgz',

            // tsc output — source of truth is the .ts sibling
            'index.js',
            'lib/**/*.js',
            'types/**/*.js',
        ],
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: NODE_GLOBALS,
        },
        rules: {
            // Correctness
            'no-undef': 'error',
            'no-unused-vars': ['error', {argsIgnorePattern: '^_', varsIgnorePattern: '^_'}],
            'no-duplicate-imports': 'error',
            'no-self-compare': 'error',
            'no-template-curly-in-string': 'error',
            'no-throw-literal': 'error',
            'eqeqeq': ['error', 'always'],
            'curly': ['error', 'all'],
            'no-var': 'error',
            'prefer-const': 'error',

            // Security
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',

            // Node.js
            'no-path-concat': 'error',
            'no-new-require': 'error',
            'no-mixed-requires': 'warn',
            'no-console': 'off',        // CLI tool
            'no-process-exit': 'off',   // CLI tool
            'handle-callback-err': 'warn',

            // Async / promises
            'no-async-promise-executor': 'error',
            'prefer-promise-reject-errors': 'error',
            'no-await-in-loop': 'warn',
            'require-atomic-updates': 'off',

            // Formatting rules are intentionally absent. ESLint deprecated its
            // stylistic rules in v8.53; the previous config enforced 4-space
            // indent against a 2-space codebase, which is why `npm run lint`
            // reported thousands of failures. If formatting should be enforced,
            // adopt @stylistic/eslint-plugin or Prettier as a separate decision.
        },
    },
    {
        // Spec files are a mix of CommonJS and ESM. 'module' parses both:
        // `import` works, and `require` is declared as a global above.
        files: ['test/**/*.js'],
        languageOptions: {
            sourceType: 'module',
            globals: {...NODE_GLOBALS, ...VITEST_GLOBALS},
        },
        rules: {
            // Chai-style assertions (`expect(x).to.be.true`) are expression
            // statements. Vitest's expect is chai-backed, so these do assert.
            'no-unused-expressions': 'off',
        },
    },

    // ─── TypeScript sources ──────────────────────────────────────────────────
    ...tseslint.configs.recommended.map(c => ({
        ...c,
        files: ['lib/**/*.ts', 'index.ts', 'types/**/*.ts'],
    })),
    {
        files: ['lib/**/*.ts', 'index.ts', 'types/**/*.ts'],
        rules: {
            // `import X = require('...')` is the documented way to consume the
            // `export =` modules this codebase uses (see CLAUDE.md). The rule
            // forbids exactly that pattern, so it contradicts project policy.
            '@typescript-eslint/no-require-imports': 'off',

            // 115 `any`s remain while the JS -> TS migration is in progress and
            // `strict: false` is pinned project-wide. Surfacing them is useful;
            // failing the build on them would force an unrelated cleanup and
            // pressure the strict-mode decision. Warn until migration completes.
            '@typescript-eslint/no-explicit-any': 'warn',

            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
            }],
        },
    },
];
