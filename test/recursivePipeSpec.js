
const { expect } = require('chai');
const fs = require('fs').promises;
const path = require('path');
const recursivePipe = require('../lib/recursivePipe');

describe('Recursive Pipe Module', function() {
    const testDir = path.join(__dirname, 'temp');
    
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
                if (file.startsWith('test_') || file === 'json' || file === 'uuid') {
                    await fs.unlink(path.join(testDir, file));
                }
            }
        } catch (err) {
            // Ignore cleanup errors
        }
    });

    describe('#recursivePipe()', function() {
        it('should download a single file successfully', async function() {
            this.timeout(10000); // Increase timeout for network requests
            
            const urls = ['https://httpbin.org/json'];
            const results = await recursivePipe(urls, testDir);
            
            expect(results).to.have.length(1);
            expect(results[0].success).to.be.true;
            expect(results[0].url).to.equal(urls[0]);
            
            // Check file exists
            const filePath = path.join(testDir, 'json');
            const stats = await fs.stat(filePath);
            expect(stats.isFile()).to.be.true;
            expect(stats.size).to.be.greaterThan(0);
        });

        it('should download multiple files successfully', async function() {
            this.timeout(15000);
            
            const urls = [
                'https://httpbin.org/uuid',
                'https://httpbin.org/json'
            ];
            const results = await recursivePipe(urls, testDir);
            
            expect(results).to.have.length(2);
            expect(results.every(r => r.success)).to.be.true;
            
            // Check both files exist
            const uuidPath = path.join(testDir, 'uuid');
            const jsonPath = path.join(testDir, 'json');
            
            const uuidStats = await fs.stat(uuidPath);
            const jsonStats = await fs.stat(jsonPath);
            
            expect(uuidStats.isFile()).to.be.true;
            expect(jsonStats.isFile()).to.be.true;
        });

        it('should handle invalid URLs gracefully', async function() {
            this.timeout(10000);
            
            const urls = ['https://invalid-domain-that-should-not-exist.com/file.txt'];
            const results = await recursivePipe(urls, testDir);
            
            expect(results).to.have.length(1);
            expect(results[0].success).to.be.false;
            expect(results[0].error).to.exist;
        });

        it('should handle empty URL array', async function() {
            try {
                await recursivePipe([], testDir);
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.equal('No URLs provided');
            }
        });

        it('should handle mix of valid and invalid URLs', async function() {
            this.timeout(15000);
            
            const urls = [
                'https://httpbin.org/json',
                'https://invalid-domain-that-should-not-exist.com/file.txt'
            ];
            const results = await recursivePipe(urls, testDir);
            
            expect(results).to.have.length(2);
            expect(results[0].success).to.be.true;
            expect(results[1].success).to.be.false;
        });

        it('should handle 404 errors', async function() {
            this.timeout(10000);
            
            const urls = ['https://httpbin.org/status/404'];
            const results = await recursivePipe(urls, testDir);
            
            expect(results).to.have.length(1);
            expect(results[0].success).to.be.false;
            expect(results[0].error).to.include('404');
        });

        it('should handle duplicate filenames with incremental postfix', async function() {
            this.timeout(15000);
            
            // First, download a file normally
            const urls = ['https://httpbin.org/json'];
            const firstResult = await recursivePipe(urls, testDir);
            
            expect(firstResult).to.have.length(1);
            expect(firstResult[0].success).to.be.true;
            
            // Check first file exists
            const originalPath = path.join(testDir, 'json');
            const originalStats = await fs.stat(originalPath);
            expect(originalStats.isFile()).to.be.true;
            
            // Download the same file again (should get renamed)
            const secondResult = await recursivePipe(urls, testDir, false); // Disable resume to force duplication
            
            expect(secondResult).to.have.length(1);
            expect(secondResult[0].success).to.be.true;
            
            // Check second file exists with .1 postfix
            const duplicatePath = path.join(testDir, 'json.1');
            const duplicateStats = await fs.stat(duplicatePath);
            expect(duplicateStats.isFile()).to.be.true;
            
            // Download again (should get .2 postfix)
            const thirdResult = await recursivePipe(urls, testDir, false);
            
            expect(thirdResult).to.have.length(1);
            expect(thirdResult[0].success).to.be.true;
            
            // Check third file exists with .2 postfix
            const secondDuplicatePath = path.join(testDir, 'json.2');
            const secondDuplicateStats = await fs.stat(secondDuplicatePath);
            expect(secondDuplicateStats.isFile()).to.be.true;
            
            // Clean up test files
            await fs.unlink(originalPath);
            await fs.unlink(duplicatePath);
            await fs.unlink(secondDuplicatePath);
        });
    });
});
