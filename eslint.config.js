module.exports = [
    // Global ignores
    {
        ignores: [
            'temp/**',
            'gh_pages/**',
            '*.tgz',
            'test/temp/**',
            'node_modules/**',
        ],
    },
    // Main configuration for all JS files
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
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
                URL: 'readonly',
            },
        },
        rules: {
            // Basic JavaScript rules
            'no-console': 'off', // Allowed for CLI tools
            'no-unused-vars': ['error', {'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_'}],
            'no-undef': 'error',
            'semi': ['error', 'always'],
            'quotes': ['error', 'single', {'avoidEscape': true}],
            
            // Node.js specific best practices  
            'no-process-exit': 'off', // Allow process.exit() in CLI applications
            'no-path-concat': 'error', // Use path.join() instead of string concatenation
            'no-new-require': 'error', // No 'new require()'
            'no-mixed-requires': 'warn', // Group require statements (warning, not error)
            
            // Security and reliability
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'strict': 'off', // Don't enforce strict mode (Node.js files are automatically strict)
            
            // Code quality
            'eqeqeq': ['error', 'always'], // Use === and !==
            'curly': ['error', 'all'], // Require curly braces for all control statements
            'no-var': 'error', // Use let/const instead of var
            'prefer-const': 'error', // Prefer const when variable is never reassigned
            'no-unused-expressions': 'warn', // Some expressions are intentional in tests
            'no-throw-literal': 'error', // Throw Error objects, not literals
            'handle-callback-err': 'warn', // Handle callback errors (warning for flexibility)
            
            // Async/Promise best practices
            'no-async-promise-executor': 'error',
            'no-await-in-loop': 'warn', // Performance consideration
            'prefer-promise-reject-errors': 'error',
            
            // Style consistency
            'indent': ['error', 4], // 4-space indentation
            'comma-dangle': ['warn', 'always-multiline'], // Warning, not error
            'object-curly-spacing': ['warn', 'never'], // Warning, not error  
            'array-bracket-spacing': ['warn', 'never'], // Warning, not error
            'space-before-function-paren': ['warn', 'never'], // Warning, not error
            'keyword-spacing': 'warn', // Warning, not error
            'space-infix-ops': 'warn', // Warning, not error
            
            // Error prevention
            'no-duplicate-imports': 'error',
            'no-self-compare': 'error',
            'no-template-curly-in-string': 'error',
            'require-atomic-updates': 'off', // Can be overly strict for CLI applications
        },
    },
    // Additional configuration for test files
    {
        files: ['test/**/*.js'],
        languageOptions: {
            globals: {
                describe: 'readonly',
                it: 'readonly',
                before: 'readonly',
                after: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
            },
        },
    },
];