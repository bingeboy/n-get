const {expect} = require('chai');
const {execSync} = require('node:child_process');
const path = require('node:path');

describe('Stdout Mode Tests', () => {
    describe('--stdout flag', () => {
        it('should output content to stdout instead of file', function() {
            this.timeout(10000);

            const output = execSync('node index.js --stdout https://httpbin.org/json', {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            // Should output JSON content to stdout
            expect(output).to.include('{');
            expect(output).to.include('"slideshow"');
            expect(output).to.include('"title"');
        });

        it('should reject multiple URLs with --stdout', function() {
            this.timeout(5000);

            try {
                execSync('node index.js --stdout https://httpbin.org/json https://httpbin.org/uuid 2>&1', {
                    cwd: path.join(__dirname, '..'),
                    encoding: 'utf8',
                    shell: true
                });
                expect.fail('Should have exited with error');
            } catch (error) {
                const errorOutput = error.stdout.toString();
                expect(errorOutput).to.include('Cannot use --stdout flag with multiple URLs');
            }
        });

        it('should reject conflicting options with --stdout and -o', function() {
            this.timeout(5000);

            try {
                execSync('node index.js --stdout -o output.txt https://httpbin.org/json 2>&1', {
                    cwd: path.join(__dirname, '..'),
                    encoding: 'utf8',
                    shell: true
                });
                expect.fail('Should have exited with error');
            } catch (error) {
                const errorOutput = error.stdout.toString();
                expect(errorOutput).to.include('Cannot use --stdout with -o option');
            }
        });

        it('should reject recursive mode with --stdout', function() {
            this.timeout(5000);

            try {
                execSync('node index.js --stdout --recursive https://example.com 2>&1', {
                    cwd: path.join(__dirname, '..'),
                    encoding: 'utf8',
                    shell: true
                });
                expect.fail('Should have exited with error');
            } catch (error) {
                const errorOutput = error.stdout.toString();
                expect(errorOutput).to.include('Recursive mode is not compatible with --stdout');
            }
        });
    });

    describe('Configuration-based stdout mode', () => {
        it('should work with NGET_DOWNLOADS_ENABLESTDOUT environment variable', function() {
            this.timeout(10000);

            const output = execSync('node index.js https://httpbin.org/uuid', {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
                env: {
                    ...process.env,
                    NGET_DOWNLOADS_ENABLESTDOUT: 'true',
                    NODE_ENV: 'test'  // Use test environment to reduce logging
                }
            });

            // Should output JSON content to stdout (may include some logging)
            expect(output).to.include('{');
            expect(output).to.include('"uuid"');
        });

        it.skip('should work with fetch profile', function() {
            // Skip this test for now due to environment config conflicts
            this.timeout(10000);

            const output = execSync('node index.js --config-ai-profile=fetch https://httpbin.org/ip', {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
                env: {
                    ...process.env,
                    NODE_ENV: 'production'  // Use production to avoid development.yaml overrides
                }
            });

            // Should output JSON content to stdout
            expect(output).to.include('{');
            expect(output).to.include('"origin"');
        });
    });

    describe('Stdout mode behavior', () => {
        it('should not show progress bars in stdout mode', function() {
            this.timeout(10000);

            const output = execSync('node index.js --stdout https://httpbin.org/json', {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            // Should not contain progress indicators
            expect(output).to.not.include('█');
            expect(output).to.not.include('%');
            expect(output).to.not.include('Download');
        });

        it('should work with API endpoints', function() {
            this.timeout(10000);

            const output = execSync('node index.js --stdout https://httpbin.org/get', {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            // Should output valid JSON
            const json = JSON.parse(output);
            expect(json).to.have.property('url');
            expect(json.url).to.include('httpbin.org/get');
        });

        it('should handle binary content gracefully', function() {
            this.timeout(10000);

            // This should not crash, even with binary content
            const output = execSync('node index.js --stdout https://httpbin.org/base64/SFRUUEJJTiBpcyBhd2Vzb21l', {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            // Should return the decoded content
            expect(output).to.include('HTTPBIN is awesome');
        });
    });

    describe('Help and documentation', () => {
        it('should include --stdout in help output', function() {
            this.timeout(5000);

            const output = execSync('node index.js --help', {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            expect(output).to.include('--stdout');
            expect(output).to.include('fetch mode');
            expect(output).to.include('single URL only');
        });

        it('should include stdout examples in help', function() {
            this.timeout(5000);

            const output = execSync('node index.js --help', {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            expect(output).to.include('nget --stdout https://api.example.com/data.json');
            expect(output).to.include('| jq .');
        });
    });
});