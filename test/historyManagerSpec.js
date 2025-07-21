const {expect} = require('chai');
const fs = require('node:fs').promises;
const path = require('node:path');
const HistoryManager = require('../lib/services/HistoryManager');

describe('HistoryManager', () => {
    const testDir = path.join(__dirname, 'temp_history');
    let historyManager;

    before(async () => {
        // Create temp directory for tests
        try {
            await fs.mkdir(testDir, {recursive: true});
        } catch {
            // Directory might already exist
        }
    });

    beforeEach(async () => {
        historyManager = new HistoryManager();
        
        // Clear any existing history before each test
        try {
            await historyManager.clearHistory(testDir);
        } catch {
            // Ignore if history doesn't exist
        }
    });

    after(async () => {
        // Clean up test files
        try {
            const files = await fs.readdir(testDir);
            for (const file of files) {
                if (file.startsWith('.nget') || file.includes('history')) {
                    await fs.rm(path.join(testDir, file), { recursive: true, force: true });
                }
            }
            await fs.rmdir(testDir);
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('History Directory Management', () => {
        it('should create history directory if it does not exist', async () => {
            const historyDir = await historyManager.ensureHistoryDir(testDir);
            const expectedDir = path.join(testDir, '.nget');
            
            expect(historyDir).to.equal(expectedDir);
            
            // Check that directory exists
            const stats = await fs.stat(historyDir);
            expect(stats.isDirectory()).to.be.true;
        });

        it('should return correct history file path', () => {
            const historyPath = historyManager.getHistoryPath(testDir);
            const expectedPath = path.join(testDir, '.nget', 'nget.history');
            
            expect(historyPath).to.equal(expectedPath);
        });
    });

    describe('Download Logging', () => {
        it('should log successful download', async () => {
            const entry = {
                url: 'https://example.com/file.zip',
                filePath: path.join(testDir, 'file.zip'),
                status: 'success',
                size: 1024,
                duration: 2500
            };

            await historyManager.logDownload(entry);

            const history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(1);
            
            const loggedEntry = history[0];
            expect(loggedEntry.url).to.equal(entry.url);
            expect(loggedEntry.status).to.equal('success');
            expect(loggedEntry.size).to.equal(1024);
            expect(loggedEntry.duration).to.equal(2500);
            expect(loggedEntry.timestamp).to.be.a('string');
            expect(loggedEntry.correlationId).to.be.a('string');
        });

        it('should log failed download', async () => {
            const entry = {
                url: 'https://example.com/missing.zip',
                filePath: path.join(testDir, 'missing.zip'),
                status: 'failed',
                error: 'HTTP 404 Not Found'
            };

            await historyManager.logDownload(entry);

            const history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(1);
            
            const loggedEntry = history[0];
            expect(loggedEntry.url).to.equal(entry.url);
            expect(loggedEntry.status).to.equal('failed');
            expect(loggedEntry.error).to.equal('HTTP 404 Not Found');
            expect(loggedEntry.size).to.be.null;
            expect(loggedEntry.duration).to.be.null;
        });

        it('should log download with metadata', async () => {
            const entry = {
                url: 'https://example.com/file.zip',
                filePath: path.join(testDir, 'file.zip'),
                status: 'success',
                size: 2048,
                duration: 1500,
                metadata: {
                    resumed: true,
                    speed: 1365.33
                }
            };

            await historyManager.logDownload(entry);

            const history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(1);
            
            const loggedEntry = history[0];
            expect(loggedEntry.metadata).to.deep.equal(entry.metadata);
        });

        it('should sanitize URLs with credentials', async () => {
            const entry = {
                url: 'https://user:password@example.com/file.zip',
                filePath: path.join(testDir, 'file.zip'),
                status: 'success',
                size: 1024
            };

            await historyManager.logDownload(entry);

            const history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(1);
            
            const loggedEntry = history[0];
            expect(loggedEntry.url).to.equal('https://example.com/file.zip');
        });
    });

    describe('History Retrieval', () => {
        beforeEach(async () => {
            // Add some test entries
            const entries = [
                {
                    url: 'https://example.com/file1.zip',
                    filePath: path.join(testDir, 'file1.zip'),
                    status: 'success',
                    size: 1024,
                    duration: 2000
                },
                {
                    url: 'https://example.com/file2.pdf',
                    filePath: path.join(testDir, 'file2.pdf'),
                    status: 'failed',
                    error: 'Connection timeout'
                },
                {
                    url: 'https://test.com/document.doc',
                    filePath: path.join(testDir, 'document.doc'),
                    status: 'success',
                    size: 2048,
                    duration: 3000
                }
            ];

            for (const entry of entries) {
                await historyManager.logDownload(entry);
                // Small delay to ensure different timestamps
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        });

        it('should retrieve all history entries', async () => {
            const history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(3);
            
            // Should be sorted by timestamp (newest first)
            const timestamps = history.map(entry => new Date(entry.timestamp));
            for (let i = 1; i < timestamps.length; i++) {
                expect(timestamps[i-1] >= timestamps[i]).to.be.true;
            }
        });

        it('should limit number of entries returned', async () => {
            const history = await historyManager.getHistory(testDir, { limit: 2 });
            expect(history).to.have.length(2);
        });

        it('should filter by status', async () => {
            const successHistory = await historyManager.getHistory(testDir, { status: 'success' });
            expect(successHistory).to.have.length(2);
            expect(successHistory.every(entry => entry.status === 'success')).to.be.true;

            const failedHistory = await historyManager.getHistory(testDir, { status: 'failed' });
            expect(failedHistory).to.have.length(1);
            expect(failedHistory[0].status).to.equal('failed');
        });

        it('should filter by search term', async () => {
            const searchResults = await historyManager.getHistory(testDir, { search: 'example.com' });
            expect(searchResults).to.have.length(2);
            expect(searchResults.every(entry => entry.url.includes('example.com'))).to.be.true;

            const docResults = await historyManager.getHistory(testDir, { search: 'document' });
            expect(docResults).to.have.length(1);
            expect(docResults[0].filePath).to.include('document.doc');
        });

        it('should handle empty history file', async () => {
            const emptyDir = path.join(testDir, 'empty');
            await fs.mkdir(emptyDir, { recursive: true });

            const history = await historyManager.getHistory(emptyDir);
            expect(history).to.have.length(0);
        });
    });

    describe('History Statistics', () => {
        beforeEach(async () => {
            // Add test entries with different statuses
            const entries = [
                { url: 'https://example.com/file1.zip', filePath: path.join(testDir, 'file1.zip'), status: 'success', size: 1024, duration: 2000 },
                { url: 'https://example.com/file2.zip', filePath: path.join(testDir, 'file2.zip'), status: 'success', size: 2048, duration: 1500 },
                { url: 'https://example.com/file3.zip', filePath: path.join(testDir, 'file3.zip'), status: 'failed', error: 'HTTP 404' },
                { url: 'https://example.com/file4.zip', filePath: path.join(testDir, 'file4.zip'), status: 'failed', error: 'Connection timeout' },
                { url: 'https://example.com/file5.zip', filePath: path.join(testDir, 'file5.zip'), status: 'in_progress' }
            ];

            for (const entry of entries) {
                await historyManager.logDownload(entry);
            }
        });

        it('should calculate basic statistics', async () => {
            const stats = await historyManager.getStatistics(testDir);
            
            expect(stats.totalDownloads).to.equal(5);
            expect(stats.successfulDownloads).to.equal(2);
            expect(stats.failedDownloads).to.equal(2);
            expect(stats.inProgressDownloads).to.equal(1);
            expect(stats.successRate).to.equal('40.00');
        });

        it('should calculate size statistics', async () => {
            const stats = await historyManager.getStatistics(testDir);
            
            expect(stats.totalSize).to.equal(3072); // 1024 + 2048
            expect(stats.sizeSummary.smallest).to.equal(1024);
            expect(stats.sizeSummary.largest).to.equal(2048);
            expect(stats.sizeSummary.average).to.equal(1536);
        });

        it('should track error types', async () => {
            const stats = await historyManager.getStatistics(testDir);
            
            expect(stats.topErrors['HTTP 404']).to.equal(1);
            expect(stats.topErrors['Connection timeout']).to.equal(1);
        });

        it('should calculate average duration', async () => {
            const stats = await historyManager.getStatistics(testDir);
            
            expect(stats.averageDuration).to.equal(1750); // (2000 + 1500) / 2
        });
    });

    describe('History Export', () => {
        beforeEach(async () => {
            // Add test data
            const entries = [
                { url: 'https://example.com/file1.zip', filePath: path.join(testDir, 'file1.zip'), status: 'success', size: 1024 },
                { url: 'https://example.com/file2.pdf', filePath: path.join(testDir, 'file2.pdf'), status: 'failed', error: 'HTTP 404' }
            ];

            for (const entry of entries) {
                await historyManager.logDownload(entry);
            }
        });

        it('should export history as JSON', async () => {
            const exported = await historyManager.exportHistory(testDir, 'json');
            const parsed = JSON.parse(exported);
            
            expect(parsed).to.be.an('array');
            expect(parsed).to.have.length(2);
            expect(parsed[0]).to.have.property('url');
            expect(parsed[0]).to.have.property('status');
            expect(parsed[0]).to.have.property('timestamp');
        });

        it('should export history as CSV', async () => {
            const exported = await historyManager.exportHistory(testDir, 'csv');
            const lines = exported.split('\n');
            
            expect(lines[0]).to.include('Timestamp,URL,File Path,Status');
            expect(lines).to.have.length.greaterThan(2); // Header + 2 data rows
            expect(exported).to.include('example.com/file1.zip');
            expect(exported).to.include('example.com/file2.pdf');
        });

        it('should handle unsupported export format', async () => {
            try {
                await historyManager.exportHistory(testDir, 'xml');
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.include('Unsupported export format');
            }
        });
    });

    describe('History Management', () => {
        beforeEach(async () => {
            // Add test data
            await historyManager.logDownload({
                url: 'https://example.com/file.zip',
                filePath: path.join(testDir, 'file.zip'),
                status: 'success',
                size: 1024
            });
        });

        it('should clear history file', async () => {
            // Verify history exists
            let history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(1);

            // Clear history
            await historyManager.clearHistory(testDir);

            // Verify history is empty
            history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(0);
        });

        it('should handle clearing non-existent history', async () => {
            const emptyDir = path.join(testDir, 'empty2');
            await fs.mkdir(emptyDir, { recursive: true });

            // Should not throw error
            await historyManager.clearHistory(emptyDir);
        });
    });

    describe('Error Handling', () => {
        it('should not fail downloads if history logging fails', async () => {
            // Create a history manager with invalid directory
            const invalidManager = new HistoryManager();
            
            // This should not throw an error (it should warn instead)
            await invalidManager.logDownload({
                url: 'https://example.com/file.zip',
                filePath: '/invalid/path/file.zip', // Invalid path
                status: 'success',
                size: 1024
            });
        });

        it('should handle malformed history entries gracefully', async () => {
            // Write malformed JSON to history file
            const historyPath = historyManager.getHistoryPath(testDir);
            await historyManager.ensureHistoryDir(testDir);
            
            const malformedData = 'not-json\n{"valid":"json"}\nmore-invalid-json\n';
            await fs.writeFile(historyPath, malformedData, 'utf8');

            // Should return only valid entries
            const history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(1);
            expect(history[0].valid).to.equal('json');
        });
    });
});