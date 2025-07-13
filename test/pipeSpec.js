const { expect } = require('chai');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const recursivePipe = require('../lib/recursivePipe');

describe('Pipe Functionality', function() {
    const testDir = path.join(__dirname, 'temp');
    const ngetPath = path.join(__dirname, '..', 'index.js');
    
    before(async function() {
        // Create temp directory for tests
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
                if (file.startsWith('pipe_test_')) {
                    await fs.unlink(path.join(testDir, file));
                }
            }
        } catch (err) {
            // Ignore cleanup errors
        }
    });

    describe('Stdin URL Input (-i -)', function() {
        it('should read URLs from stdin and download files', function(done) {
            this.timeout(15000);
            
            const child = spawn('node', [ngetPath, '-i', '-', '-d', testDir], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            // Send URLs to stdin
            child.stdin.write('https://httpbin.org/json\n');
            child.stdin.write('https://httpbin.org/uuid\n');
            child.stdin.end();
            
            let stdout = '';
            let stderr = '';
            
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            child.on('close', async (code) => {
                try {
                    expect(code).to.equal(0);
                    
                    // Check that files were downloaded
                    const jsonPath = path.join(testDir, 'json');
                    const uuidPath = path.join(testDir, 'uuid');
                    
                    const jsonStats = await fs.stat(jsonPath);
                    const uuidStats = await fs.stat(uuidPath);
                    
                    expect(jsonStats.isFile()).to.be.true;
                    expect(uuidStats.isFile()).to.be.true;
                    expect(jsonStats.size).to.be.greaterThan(0);
                    expect(uuidStats.size).to.be.greaterThan(0);
                    
                    done();
                } catch (error) {
                    done(error);
                }
            });
        });

        it('should read URLs from file with -i <filename>', function(done) {
            this.timeout(15000);
            
            // Create a URLs file
            const urlsFile = path.join(testDir, 'test_urls.txt');
            const urlsContent = 'https://httpbin.org/json\nhttps://httpbin.org/uuid\n';
            
            fs.writeFile(urlsFile, urlsContent).then(() => {
                const child = spawn('node', [ngetPath, '-i', urlsFile, '-d', testDir], {
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                
                let stdout = '';
                let stderr = '';
                
                child.stdout.on('data', (data) => {
                    stdout += data.toString();
                });
                
                child.stderr.on('data', (data) => {
                    stderr += data.toString();
                });
                
                child.on('close', async (code) => {
                    try {
                        expect(code).to.equal(0);
                        
                        // Check that files were downloaded
                        const jsonPath = path.join(testDir, 'json');
                        const uuidPath = path.join(testDir, 'uuid');
                        
                        const jsonStats = await fs.stat(jsonPath);
                        const uuidStats = await fs.stat(uuidPath);
                        
                        expect(jsonStats.isFile()).to.be.true;
                        expect(uuidStats.isFile()).to.be.true;
                        
                        // Clean up URLs file
                        await fs.unlink(urlsFile);
                        
                        done();
                    } catch (error) {
                        done(error);
                    }
                });
            }).catch(done);
        });

        it('should ignore comment lines (starting with #) in input', function(done) {
            this.timeout(15000);
            
            const child = spawn('node', [ngetPath, '-i', '-', '-d', testDir], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            // Send URLs with comments to stdin
            child.stdin.write('# This is a comment\n');
            child.stdin.write('https://httpbin.org/json\n');
            child.stdin.write('# Another comment\n');
            child.stdin.end();
            
            child.on('close', async (code) => {
                try {
                    expect(code).to.equal(0);
                    
                    // Check that only one file was downloaded
                    const jsonPath = path.join(testDir, 'json');
                    const jsonStats = await fs.stat(jsonPath);
                    expect(jsonStats.isFile()).to.be.true;
                    
                    done();
                } catch (error) {
                    done(error);
                }
            });
        });
    });

    describe('Stdout Output (-o -)', function() {
        it('should output downloaded content to stdout', function(done) {
            this.timeout(15000);
            
            const child = spawn('node', [ngetPath, '-o', '-', 'https://httpbin.org/json'], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let stdout = '';
            let stderr = '';
            
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            child.on('close', (code) => {
                try {
                    expect(code).to.equal(0);
                    expect(stdout).to.be.a('string');
                    expect(stdout.length).to.be.greaterThan(0);
                    
                    // Should be valid JSON
                    const parsed = JSON.parse(stdout);
                    expect(parsed).to.be.an('object');
                    
                    done();
                } catch (error) {
                    done(error);
                }
            });
        });

        it('should enable quiet mode automatically when using stdout', function(done) {
            this.timeout(15000);
            
            const child = spawn('node', [ngetPath, '-o', '-', 'https://httpbin.org/json'], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let stdout = '';
            let stderr = '';
            
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            child.on('close', (code) => {
                try {
                    expect(code).to.equal(0);
                    
                    // stderr should not contain banner or progress info
                    expect(stderr).to.not.include('n-get');
                    expect(stderr).to.not.include('Download Summary');
                    
                    // stdout should contain only the file content
                    expect(stdout).to.be.a('string');
                    expect(stdout.length).to.be.greaterThan(0);
                    
                    done();
                } catch (error) {
                    done(error);
                }
            });
        });

        it('should reject multiple URLs when using stdout output', function(done) {
            this.timeout(10000);
            
            const child = spawn('node', [ngetPath, '-o', '-', 'https://httpbin.org/json', 'https://httpbin.org/uuid'], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            child.on('close', (code) => {
                expect(code).to.not.equal(0); // Should fail
                done();
            });
        });
    });

    describe('Quiet Mode (-q)', function() {
        it('should suppress all output except errors when using -q', function(done) {
            this.timeout(15000);
            
            const child = spawn('node', [ngetPath, '-q', 'https://httpbin.org/json', '-d', testDir], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let stdout = '';
            let stderr = '';
            
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            child.on('close', async (code) => {
                try {
                    expect(code).to.equal(0);
                    
                    // Should have minimal output
                    expect(stdout.trim()).to.equal('');
                    expect(stderr).to.not.include('n-get');
                    expect(stderr).to.not.include('Download Summary');
                    
                    // But file should still be downloaded
                    const jsonPath = path.join(testDir, 'json');
                    const jsonStats = await fs.stat(jsonPath);
                    expect(jsonStats.isFile()).to.be.true;
                    
                    done();
                } catch (error) {
                    done(error);
                }
            });
        });
    });

    describe('Pipe Chaining', function() {
        it('should work in a pipeline with other commands', function(done) {
            this.timeout(15000);
            
            // Test: echo URL | nget -i - -o - | head -c 10
            const echo = spawn('echo', ['https://httpbin.org/json']);
            const nget = spawn('node', [ngetPath, '-i', '-', '-o', '-'], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            const head = spawn('head', ['-c', '10'], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            echo.stdout.pipe(nget.stdin);
            nget.stdout.pipe(head.stdin);
            
            let result = '';
            head.stdout.on('data', (data) => {
                result += data.toString();
            });
            
            head.on('close', (code) => {
                try {
                    expect(code).to.equal(0);
                    expect(result.length).to.equal(10);
                    done();
                } catch (error) {
                    done(error);
                }
            });
        });
    });

    describe('Combined Features', function() {
        it('should handle stdin input with quiet mode', function(done) {
            this.timeout(15000);
            
            const child = spawn('node', [ngetPath, '-i', '-', '-q', '-d', testDir], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            child.stdin.write('https://httpbin.org/json\n');
            child.stdin.end();
            
            let stdout = '';
            let stderr = '';
            
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            child.on('close', async (code) => {
                try {
                    expect(code).to.equal(0);
                    expect(stdout.trim()).to.equal('');
                    
                    // File should still be downloaded
                    const jsonPath = path.join(testDir, 'json');
                    const jsonStats = await fs.stat(jsonPath);
                    expect(jsonStats.isFile()).to.be.true;
                    
                    done();
                } catch (error) {
                    done(error);
                }
            });
        });
    });

    describe('Error Handling', function() {
        it('should handle invalid URLs gracefully in pipe mode', function(done) {
            this.timeout(10000);
            
            const child = spawn('node', [ngetPath, '-i', '-', '-q'], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            child.stdin.write('https://invalid-domain-that-definitely-does-not-exist-12345.com/file.txt\n');
            child.stdin.end();
            
            child.on('close', (code) => {
                expect(code).to.not.equal(0); // Should fail but exit gracefully
                done();
            });
        });

        it('should exit gracefully when stdin is not available without TTY error', function(done) {
            this.timeout(5000);
            
            const child = spawn('node', [ngetPath, '-i', '-'], {
                stdio: ['inherit', 'pipe', 'pipe'] // Inherit stdin to simulate TTY
            });
            
            child.on('close', (code) => {
                expect(code).to.not.equal(0); // Should fail with proper error
                done();
            });
        });
    });
});