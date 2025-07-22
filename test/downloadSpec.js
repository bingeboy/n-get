const {expect} = require('chai');
const {execSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs').promises;

describe('Download Functionality', () => {
    const testDir = path.join(__dirname, 'download-test');

    before(async () => {
        try {
            await fs.mkdir(testDir, {recursive: true});
        } catch {
            // Directory might already exist
        }
    });

    after(async () => {
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

    describe('Basic Download Tests', () => {
        it('should successfully download a simple webpage', function () {
            this.timeout(30000);

            const output = execSync(`node index.js http://httpbin.org/html -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
                stdio: 'pipe'
            });

            expect(output).to.include('🎉 Download Summary');
            expect(output).to.include('✅ Successful: 1/1');
        });

        it('should successfully download JSON data', function () {
            this.timeout(30000);

            const output = execSync(`node index.js https://httpbin.org/json -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
                stdio: 'pipe'
            });

            expect(output).to.include('🎉 Download Summary');
            expect(output).to.include('✅ Successful: 1/1');
        });

        it('should handle HTTPS URLs correctly', function () {
            this.timeout(30000);

            const output = execSync(`node index.js https://httpbin.org/get -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
                stdio: 'pipe'
            });

            expect(output).to.include('🎉 Download Summary');
            expect(output).to.include('✅ Successful: 1/1');
        });

        it('should show security warning for HTTP URLs', function () {
            this.timeout(30000);

            const output = execSync(`node index.js http://httpbin.org/get -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
                stdio: 'pipe'
            });

            expect(output).to.include('Security validation warning');
            expect(output).to.include('Using HTTP instead of HTTPS');
            expect(output).to.include('✅ Successful: 1/1');
        });

        it('should handle the simple domain case like google.com', function () {
            this.timeout(30000);

            const output = execSync(`node index.js google.com -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
                stdio: 'pipe'
            });

            expect(output).to.include('No Protocol Provided, Defaulting to');
            expect(output).to.include('🎉 Download Summary');
            expect(output).to.include('✅ Successful: 1/1');
        });

        it('should create downloaded files with correct content', async function () {
            this.timeout(30000);

            execSync(`node index.js https://httpbin.org/json -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
                stdio: 'pipe'
            });

            // The file should be named 'json' (the path part of the URL)
            const downloadedFile = path.join(testDir, 'json');
            const fileExists = await fs.access(downloadedFile).then(() => true).catch(() => false);
            expect(fileExists).to.be.true;

            const fileContent = await fs.readFile(downloadedFile, 'utf8');
            // The JSON response should contain slideshow data
            expect(fileContent).to.include('slideshow');
            
            // Verify it's valid JSON
            const jsonData = JSON.parse(fileContent);
            expect(jsonData).to.have.property('slideshow');
        });

        it('should handle multiple URLs in a single command', function () {
            this.timeout(45000);

            const output = execSync(`node index.js https://httpbin.org/json https://httpbin.org/html -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
                stdio: 'pipe'
            });

            expect(output).to.include('🎉 Download Summary');
            expect(output).to.include('✅ Successful: 2/2');
        });
    });

    describe('Error Handling Tests', () => {
        it('should handle invalid URLs gracefully', function () {
            this.timeout(30000);

            try {
                execSync(`node index.js not-a-valid-url -d ${testDir}`, {
                    cwd: path.join(__dirname, '..'),
                    encoding: 'utf8',
                    stdio: 'pipe'
                });
                expect.fail('Should have failed for invalid URL');
            } catch (error) {
                // Should exit with non-zero status for invalid URL
                expect(error.status).to.not.equal(0);
            }
        });

        it('should handle non-existent domains', function () {
            this.timeout(30000);

            try {
                const output = execSync(`node index.js https://this-domain-definitely-does-not-exist-12345.com -d ${testDir}`, {
                    cwd: path.join(__dirname, '..'),
                    encoding: 'utf8',
                    stdio: 'pipe'
                });
                // If it doesn't throw, check that it reports an error in the summary
                if (output.includes('Download Summary')) {
                    expect(output).to.match(/Failed: [1-9]/);
                }
            } catch (error) {
                // Network errors are expected for non-existent domains
                expect(error.status).to.not.equal(0);
            }
        });
    });

    describe('Resume and Progress Tests', () => {
        it('should show progress indicators during download', function () {
            this.timeout(30000);

            const output = execSync(`node index.js https://httpbin.org/json -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
                stdio: 'pipe'
            });

            expect(output).to.include('⬇️');
            expect(output).to.include('[1/1]');
            expect(output).to.include('✅');
        });

        it('should report download statistics', function () {
            this.timeout(30000);

            const output = execSync(`node index.js https://httpbin.org/json -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
                stdio: 'pipe'
            });

            expect(output).to.include('⏱️ Total time:');
            expect(output).to.include('📂 Downloaded files:');
        });
    });
});