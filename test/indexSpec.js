
const {expect} = require('chai');
const {execSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs').promises;

describe('Main CLI Application', () => {
    const testDir = path.join(__dirname, 'cli-test');

    before(async() => {
        try {
            await fs.mkdir(testDir, {recursive: true});
        } catch {
            // Directory might already exist
        }
    });

    after(async() => {
        // Clean up test files
        try {
            const files = await fs.readdir(testDir);
            for (const file of files) {
                await fs.unlink(path.join(testDir, file));
            }

            await fs.rmdir(testDir);
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('CLI argument parsing', () => {
        it('should show error message when no arguments provided', function() {
            this.timeout(5000);

            try {
                execSync('node index.js', {cwd: path.join(__dirname, '..')});
                expect.fail('Should have exited with error');
            } catch (error) {
                expect(error.stderr.toString()).to.include('Error: No URLs provided');
                expect(error.stderr.toString()).to.include('nget --help');
            }
        });

        it('should handle single URL download', function() {
            this.timeout(15000);

            const output = execSync(`node index.js https://httpbin.org/json -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            // Strip ANSI color codes for testing
            const cleanOutput = output.replaceAll(/\u001B\[[\d;]*m/g, '');
            expect(cleanOutput).to.include('Download Summary');
            expect(cleanOutput).to.include('Successful: 1/1');
        });

        it('should handle multiple URL downloads', function() {
            this.timeout(20000);

            const output = execSync(`node index.js https://httpbin.org/json https://httpbin.org/uuid -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            // Strip ANSI color codes for testing
            const cleanOutput = output.replaceAll(/\u001B\[[\d;]*m/g, '');
            expect(cleanOutput).to.include('Download Summary');
            expect(cleanOutput).to.include('Successful: 2/2');
        });

        it('should handle invalid destination gracefully', function() {
            this.timeout(5000);

            try {
                execSync('node index.js https://httpbin.org/json -d /nonexistent/path', {
                    cwd: path.join(__dirname, '..'),
                    encoding: 'utf8',
                });
                expect.fail('Should have exited with error');
            } catch (error) {
                const output = error.stderr ? error.stderr.toString() : error.stdout.toString();
                expect(output).to.include('Invalid destination path');
            }
        });
    });

    describe('Error handling', () => {
        it('should handle network errors gracefully', function() {
            this.timeout(10000);

            try {
                execSync('node index.js https://invalid-domain-that-should-not-exist.com/file.txt', {
                    cwd: path.join(__dirname, '..'),
                    encoding: 'utf8',
                });
                expect.fail('Should have thrown an error');
            } catch (error) {
                // Should exit with non-zero code and show error summary
                expect(error.status).to.equal(1);
                expect(error.stdout).to.include('Failed: 1');
            }
        });

        it('should handle mixed valid and invalid URLs', function() {
            this.timeout(15000);

            const output = execSync(`node index.js https://httpbin.org/json https://invalid-domain.com/file.txt -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            // Strip ANSI color codes for testing
            const cleanOutput = output.replaceAll(/\u001B\[[\d;]*m/g, '');
            expect(cleanOutput).to.include('Successful: 1');
            expect(cleanOutput).to.include('Failed: 1');
        });
    });

    describe('Output filename (-o flag)', () => {
        it('should use custom filename when -o parameter is specified', async function() {
            this.timeout(15000);

            const customFilename = 'test-custom-uuid.json';
            const customFilePath = path.join(testDir, customFilename);

            const output = execSync(`node index.js https://httpbin.org/uuid -o ${customFilename} -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            // Strip ANSI color codes for testing
            const cleanOutput = output.replaceAll(/\u001B\[[\d;]*m/g, '');
            expect(cleanOutput).to.include('Successful: 1/1');

            // Check that file exists with custom name
            try {
                await fs.access(customFilePath);
            } catch (error) {
                // Check if file was created with URL-extracted name instead (bug behavior)
                const urlExtractedPath = path.join(testDir, 'uuid');
                try {
                    await fs.access(urlExtractedPath);
                    expect.fail(`Bug reproduced: File was created as 'uuid' instead of '${customFilename}'. The -o parameter was ignored.`);
                } catch {
                    expect.fail(`Neither custom filename '${customFilename}' nor URL-extracted filename 'uuid' was found.`);
                }
            }
        });

        it('should use custom filename with different extension when -o parameter is specified', async function() {
            this.timeout(15000);

            const customFilename = 'my-data.txt';
            const customFilePath = path.join(testDir, customFilename);

            const output = execSync(`node index.js https://httpbin.org/json -o ${customFilename} -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            // Strip ANSI color codes for testing
            const cleanOutput = output.replaceAll(/\u001B\[[\d;]*m/g, '');
            expect(cleanOutput).to.include('Successful: 1/1');

            // Check that file exists with custom name
            try {
                await fs.access(customFilePath);
            } catch (error) {
                // Check if file was created with URL-extracted name instead (bug behavior)
                const urlExtractedPath = path.join(testDir, 'json');
                try {
                    await fs.access(urlExtractedPath);
                    expect.fail(`Bug reproduced: File was created as 'json' instead of '${customFilename}'. The -o parameter was ignored.`);
                } catch {
                    expect.fail(`Neither custom filename '${customFilename}' nor URL-extracted filename 'json' was found.`);
                }
            }
        });
    });
});
