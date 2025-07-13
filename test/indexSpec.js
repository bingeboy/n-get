
const { expect } = require('chai');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

describe('Main CLI Application', function() {
    const testDir = path.join(__dirname, 'cli-test');
    
    before(async function() {
        try {
            await fs.mkdir(testDir, { recursive: true });
        } catch (err) {
            // Directory might already exist
        }
    });

    after(async function() {
        // Clean up test files
        try {
            const files = await fs.readdir(testDir);
            for (const file of files) {
                await fs.unlink(path.join(testDir, file));
            }
            await fs.rmdir(testDir);
        } catch (err) {
            // Ignore cleanup errors
        }
    });

    describe('CLI argument parsing', function() {
        it('should show error message when no arguments provided', function() {
            this.timeout(5000);
            
            try {
                execSync('node index.js', { cwd: path.join(__dirname, '..') });
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
                encoding: 'utf8'
            });
            
            // Strip ANSI color codes for testing
            const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
            expect(cleanOutput).to.include('Download Summary');
            expect(cleanOutput).to.include('Successful: 1/1');
        });

        it('should handle multiple URL downloads', function() {
            this.timeout(20000);
            
            const output = execSync(`node index.js https://httpbin.org/json https://httpbin.org/uuid -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8'
            });
            
            // Strip ANSI color codes for testing
            const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
            expect(cleanOutput).to.include('Download Summary');
            expect(cleanOutput).to.include('Successful: 2/2');
        });

        it('should handle invalid destination gracefully', function() {
            this.timeout(5000);
            
            try {
                execSync('node index.js https://httpbin.org/json -d /nonexistent/path', {
                    cwd: path.join(__dirname, '..'),
                    encoding: 'utf8'
                });
                expect.fail('Should have exited with error');
            } catch (error) {
                const output = error.stderr ? error.stderr.toString() : error.stdout.toString();
                expect(output).to.include('Invalid destination path');
            }
        });
    });

    describe('Error handling', function() {
        it('should handle network errors gracefully', function() {
            this.timeout(10000);
            
            try {
                execSync('node index.js https://invalid-domain-that-should-not-exist.com/file.txt', {
                    cwd: path.join(__dirname, '..'),
                    encoding: 'utf8'
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
                encoding: 'utf8'
            });
            
            // Strip ANSI color codes for testing
            const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
            expect(cleanOutput).to.include('Successful: 1');
            expect(cleanOutput).to.include('Failed: 1');
        });
    });
});
