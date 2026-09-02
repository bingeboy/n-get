const fs = require('node:fs').promises;
const path = require('node:path');
const HistoryManager = require('../lib/services/HistoryManager');

describe('HistoryManager', () => {
    const testDir = path.join(__dirname, 'temp_history');
    let historyManager;

    before(async() => {
        // Create temp directory for tests
        try {
            await fs.mkdir(testDir, {recursive: true});
        } catch {
            // Directory might already exist
        }
    });

    beforeEach(async() => {
        historyManager = new HistoryManager();
        
        // Clear any existing history before each test
        try {
            await historyManager.clearHistory(testDir);
        } catch {
            // Ignore if history doesn't exist
        }
    });

    after(async() => {
        // Clean up test files
        try {
            const files = await fs.readdir(testDir);
            for (const file of files) {
                if (file.startsWith('.nget') || file.includes('history')) {
                    await fs.rm(path.join(testDir, file), {recursive: true, force: true});
                }
            }
            await fs.rmdir(testDir);
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('History Directory Management', () => {
        it('should create history directory if it does not exist', async() => {
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
        it('should log successful download', async() => {
            const entry = {
                url: 'https://example.com/file.zip',
                filePath: path.join(testDir, 'file.zip'),
                status: 'success',
                size: 1024,
                duration: 2500,
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

        it('should log failed download', async() => {
            const entry = {
                url: 'https://example.com/missing.zip',
                filePath: path.join(testDir, 'missing.zip'),
                status: 'failed',
                error: 'HTTP 404 Not Found',
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

        it('should log download with metadata', async() => {
            const entry = {
                url: 'https://example.com/file.zip',
                filePath: path.join(testDir, 'file.zip'),
                status: 'success',
                size: 2048,
                duration: 1500,
                metadata: {
                    resumed: true,
                    speed: 1365.33,
                },
            };

            await historyManager.logDownload(entry);

            const history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(1);
            
            const loggedEntry = history[0];
            expect(loggedEntry.metadata).to.deep.equal(entry.metadata);
        });

        it('should sanitize URLs with credentials', async() => {
            const entry = {
                url: 'https://user:password@example.com/file.zip',
                filePath: path.join(testDir, 'file.zip'),
                status: 'success',
                size: 1024,
            };

            await historyManager.logDownload(entry);

            const history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(1);
            
            const loggedEntry = history[0];
            expect(loggedEntry.url).to.equal('https://example.com/file.zip');
        });
    });

    describe('History Retrieval', () => {
        beforeEach(async() => {
            // Add some test entries
            const entries = [
                {
                    url: 'https://example.com/file1.zip',
                    filePath: path.join(testDir, 'file1.zip'),
                    status: 'success',
                    size: 1024,
                    duration: 2000,
                    timestamp: '2026-01-01T00:00:02.000Z',
                },
                {
                    url: 'https://example.com/file2.pdf',
                    filePath: path.join(testDir, 'file2.pdf'),
                    status: 'failed',
                    error: 'Connection timeout',
                    timestamp: '2026-01-01T00:00:01.000Z',
                },
                {
                    url: 'https://test.com/document.doc',
                    filePath: path.join(testDir, 'document.doc'),
                    status: 'success',
                    size: 2048,
                    duration: 3000,
                    timestamp: '2026-01-01T00:00:00.000Z',
                },
            ];

            for (const entry of entries) {
                await historyManager.logDownload(entry);
            }
        });

        it('should retrieve all history entries', async() => {
            const history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(3);
            
            // Should be sorted by timestamp (newest first)
            const timestamps = history.map(entry => new Date(entry.timestamp));
            for (let i = 1; i < timestamps.length; i++) {
                expect(timestamps[i - 1] >= timestamps[i]).to.be.true;
            }
        });

        it('should limit number of entries returned', async() => {
            const history = await historyManager.getHistory(testDir, {limit: 2});
            expect(history).to.have.length(2);
        });

        it('should filter by status', async() => {
            const successHistory = await historyManager.getHistory(testDir, {status: 'success'});
            expect(successHistory).to.have.length(2);
            expect(successHistory.every(entry => entry.status === 'success')).to.be.true;

            const failedHistory = await historyManager.getHistory(testDir, {status: 'failed'});
            expect(failedHistory).to.have.length(1);
            expect(failedHistory[0].status).to.equal('failed');
        });

        it('should filter by search term', async() => {
            const searchResults = await historyManager.getHistory(testDir, {search: 'example.com'});
            expect(searchResults).to.have.length(2);
            expect(searchResults.every(entry => entry.url.includes('example.com'))).to.be.true;

            const docResults = await historyManager.getHistory(testDir, {search: 'document'});
            expect(docResults).to.have.length(1);
            expect(docResults[0].filePath).to.include('document.doc');
        });

        it('should handle empty history file', async() => {
            const emptyDir = path.join(testDir, 'empty');
            await fs.mkdir(emptyDir, {recursive: true});

            const history = await historyManager.getHistory(emptyDir);
            expect(history).to.have.length(0);
        });
    });

    describe('History Statistics', () => {
        beforeEach(async() => {
            // Add test entries with different statuses
            const entries = [
                {url: 'https://example.com/file1.zip', filePath: path.join(testDir, 'file1.zip'), status: 'success', size: 1024, duration: 2000},
                {url: 'https://example.com/file2.zip', filePath: path.join(testDir, 'file2.zip'), status: 'success', size: 2048, duration: 1500},
                {url: 'https://example.com/file3.zip', filePath: path.join(testDir, 'file3.zip'), status: 'failed', error: 'HTTP 404'},
                {url: 'https://example.com/file4.zip', filePath: path.join(testDir, 'file4.zip'), status: 'failed', error: 'Connection timeout'},
                {url: 'https://example.com/file5.zip', filePath: path.join(testDir, 'file5.zip'), status: 'in_progress'},
            ];

            for (const entry of entries) {
                await historyManager.logDownload(entry);
            }
        });

        it('should calculate basic statistics', async() => {
            const stats = await historyManager.getStatistics(testDir);
            
            expect(stats.totalDownloads).to.equal(5);
            expect(stats.successfulDownloads).to.equal(2);
            expect(stats.failedDownloads).to.equal(2);
            expect(stats.inProgressDownloads).to.equal(1);
            expect(stats.successRate).to.equal('40.00');
        });

        it('should calculate size statistics', async() => {
            const stats = await historyManager.getStatistics(testDir);
            
            expect(stats.totalSize).to.equal(3072); // 1024 + 2048
            expect(stats.sizeSummary.smallest).to.equal(1024);
            expect(stats.sizeSummary.largest).to.equal(2048);
            expect(stats.sizeSummary.average).to.equal(1536);
        });

        it('should track error types', async() => {
            const stats = await historyManager.getStatistics(testDir);
            
            expect(stats.topErrors['HTTP 404']).to.equal(1);
            expect(stats.topErrors['Connection timeout']).to.equal(1);
        });

        it('should calculate average duration', async() => {
            const stats = await historyManager.getStatistics(testDir);
            
            expect(stats.averageDuration).to.equal(1750); // (2000 + 1500) / 2
        });
    });

    describe('History Export', () => {
        beforeEach(async() => {
            // Add test data
            const entries = [
                {url: 'https://example.com/file1.zip', filePath: path.join(testDir, 'file1.zip'), status: 'success', size: 1024},
                {url: 'https://example.com/file2.pdf', filePath: path.join(testDir, 'file2.pdf'), status: 'failed', error: 'HTTP 404'},
            ];

            for (const entry of entries) {
                await historyManager.logDownload(entry);
            }
        });

        it('should export history as JSON', async() => {
            const exported = await historyManager.exportHistory(testDir, 'json');
            const parsed = JSON.parse(exported);
            
            expect(parsed).to.be.an('array');
            expect(parsed).to.have.length(2);
            expect(parsed[0]).to.have.property('url');
            expect(parsed[0]).to.have.property('status');
            expect(parsed[0]).to.have.property('timestamp');
        });

        it('should export history as CSV', async() => {
            const exported = await historyManager.exportHistory(testDir, 'csv');
            const lines = exported.split('\n');
            
            expect(lines[0]).to.include('Timestamp,URL,File Path,Status');
            expect(lines).to.have.length.greaterThan(2); // Header + 2 data rows
            expect(exported).to.include('example.com/file1.zip');
            expect(exported).to.include('example.com/file2.pdf');
        });

        it('should handle unsupported export format', async() => {
            try {
                await historyManager.exportHistory(testDir, 'xml');
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.include('Unsupported export format');
            }
        });
    });

    describe('History Management', () => {
        beforeEach(async() => {
            // Add test data
            await historyManager.logDownload({
                url: 'https://example.com/file.zip',
                filePath: path.join(testDir, 'file.zip'),
                status: 'success',
                size: 1024,
            });
        });

        it('should clear history file', async() => {
            // Verify history exists
            let history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(1);

            // Clear history
            await historyManager.clearHistory(testDir);

            // Verify history is empty
            history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(0);
        });

        it('should handle clearing non-existent history', async() => {
            const emptyDir = path.join(testDir, 'empty2');
            await fs.mkdir(emptyDir, {recursive: true});

            // Should not throw error
            await historyManager.clearHistory(emptyDir);
        });
    });

    describe('Error Handling', () => {
        it('should not fail downloads if history logging fails', async() => {
            // Create a history manager with invalid directory
            const invalidManager = new HistoryManager();
            
            // This should not throw an error (it should warn instead)
            await invalidManager.logDownload({
                url: 'https://example.com/file.zip',
                filePath: '/invalid/path/file.zip', // Invalid path
                status: 'success',
                size: 1024,
            });
        });

        it('should handle malformed history entries gracefully', async() => {
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

    describe('sanitizeUrl', () => {
        it('returns original string when URL parsing fails', () => {
            const result = historyManager.sanitizeUrl('not-a-valid-url');
            expect(result).to.equal('not-a-valid-url');
        });

        it('strips credentials from valid URL', () => {
            const result = historyManager.sanitizeUrl('https://user:pass@example.com/file');
            expect(result).to.not.include('user');
            expect(result).to.not.include('pass');
        });

        it('leaves URLs without credentials unchanged', () => {
            const result = historyManager.sanitizeUrl('https://example.com/file.zip');
            expect(result).to.include('example.com');
        });
    });

    describe('cleanupOldEntries', () => {
        it('removes entries older than retentionDays', async() => {
            // Log a fresh entry
            await historyManager.logDownload({
                url: 'https://example.com/keep.zip',
                filePath: path.join(testDir, 'keep.zip'),
                status: 'success',
                size: 512,
            });

            // Set retentionDays to 0 so all existing entries fall outside the window
            historyManager.retentionDays = 0;
            await historyManager.cleanupOldEntries(testDir);

            // All entries were logged moments ago but cutoff is "now", so they are removed
            const history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(0);
        });

        it('does not rewrite file when all entries are within retention window', async() => {
            await historyManager.logDownload({
                url: 'https://example.com/fresh.zip',
                filePath: path.join(testDir, 'fresh.zip'),
                status: 'success',
                size: 256,
            });

            // 90-day window keeps recent entries
            historyManager.retentionDays = 90;
            await historyManager.cleanupOldEntries(testDir);

            const history = await historyManager.getHistory(testDir);
            expect(history).to.have.length.greaterThan(0);
        });

        it('handles error gracefully when destination is invalid', async() => {
            // Should not throw — just warns
            await historyManager.cleanupOldEntries('/nonexistent/path/xyz');
        });
    });

    describe('checkRotation', () => {
        it('handles stat failure gracefully when file does not exist', async() => {
            // Should not throw — stat fails, catch branch logs warning
            await historyManager.checkRotation('/nonexistent/path/nget.history');
        });
    });

    describe('rotateHistoryFile', () => {
        it('warns and does not throw when rename fails on nonexistent path', async() => {
            // Calling with a nonexistent path causes rename to fail; the catch branch just warns
            await historyManager.rotateHistoryFile('/nonexistent/path/nget.history');
        });

        it('rotates an existing history file', async() => {
            const historyPath = historyManager.getHistoryPath(testDir);
            await historyManager.ensureHistoryDir(testDir);
            await fs.writeFile(historyPath, '{"test":true}\n', 'utf8');

            await historyManager.rotateHistoryFile(historyPath);

            // Original file should be gone (renamed to archive)
            const files = await fs.readdir(path.dirname(historyPath));
            expect(files.some(f => f.includes('.history.'))).to.be.true;
        });
    });

    describe('Agent identity (provenance)', () => {
        const identity = {
            agentId: 'agent-alpha',
            sessionId: 'sess-123',
            requestId: 'req-456',
            conversationId: 'conv-789',
        };

        it('persists agentId, sessionId, requestId, conversationId on entries', async() => {
            await historyManager.logDownload({
                url: 'https://example.com/tracked.zip',
                filePath: path.join(testDir, 'tracked.zip'),
                status: 'success',
                size: 100,
                ...identity,
            });

            const history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(1);
            expect(history[0].agentId).to.equal('agent-alpha');
            expect(history[0].sessionId).to.equal('sess-123');
            expect(history[0].requestId).to.equal('req-456');
            expect(history[0].conversationId).to.equal('conv-789');
        });

        it('defaults identity fields to null when not supplied', async() => {
            await historyManager.logDownload({
                url: 'https://example.com/anon.zip',
                filePath: path.join(testDir, 'anon.zip'),
                status: 'success',
                size: 100,
            });

            const history = await historyManager.getHistory(testDir);
            expect(history[0].agentId).to.be.null;
            expect(history[0].sessionId).to.be.null;
            expect(history[0].requestId).to.be.null;
            expect(history[0].conversationId).to.be.null;
        });

        describe('filtering', () => {
            beforeEach(async() => {
                await historyManager.logDownload({
                    url: 'https://example.com/a.zip',
                    filePath: path.join(testDir, 'a.zip'),
                    status: 'success',
                    ...identity,
                });
                await historyManager.logDownload({
                    url: 'https://example.com/b.zip',
                    filePath: path.join(testDir, 'b.zip'),
                    status: 'success',
                    agentId: 'agent-beta',
                    sessionId: 'sess-999',
                });
                await historyManager.logDownload({
                    url: 'https://example.com/c.zip',
                    filePath: path.join(testDir, 'c.zip'),
                    status: 'success',
                });
            });

            it('filters by agentId (exact match)', async() => {
                const results = await historyManager.getHistory(testDir, {agentId: 'agent-alpha'});
                expect(results).to.have.length(1);
                expect(results[0].url).to.include('a.zip');
            });

            it('filters by sessionId', async() => {
                const results = await historyManager.getHistory(testDir, {sessionId: 'sess-999'});
                expect(results).to.have.length(1);
                expect(results[0].agentId).to.equal('agent-beta');
            });

            it('filters by requestId', async() => {
                const results = await historyManager.getHistory(testDir, {requestId: 'req-456'});
                expect(results).to.have.length(1);
                expect(results[0].url).to.include('a.zip');
            });

            it('filters by conversationId', async() => {
                const results = await historyManager.getHistory(testDir, {conversationId: 'conv-789'});
                expect(results).to.have.length(1);
                expect(results[0].url).to.include('a.zip');
            });

            it('combines identity filters with status filter', async() => {
                const results = await historyManager.getHistory(testDir, {agentId: 'agent-alpha', status: 'success'});
                expect(results).to.have.length(1);
                const none = await historyManager.getHistory(testDir, {agentId: 'agent-alpha', status: 'failed'});
                expect(none).to.have.length(0);
            });

            it('excludes entries without identity when a filter is set', async() => {
                const results = await historyManager.getHistory(testDir, {agentId: 'agent-alpha'});
                expect(results.every(e => e.agentId === 'agent-alpha')).to.be.true;
            });

            it('returns all entries when no identity filter is set', async() => {
                const results = await historyManager.getHistory(testDir);
                expect(results).to.have.length(3);
            });
        });

        describe('legacy entries (pre-identity format)', () => {
            beforeEach(async() => {
                // Write a raw legacy-shaped line exactly as older versions did:
                // no agentId/sessionId/requestId/conversationId fields at all.
                await historyManager.ensureHistoryDir(testDir);
                const legacyEntry = {
                    timestamp: '2026-01-01T00:00:00.000Z',
                    url: 'https://example.com/legacy.zip',
                    filePath: path.join(testDir, 'legacy.zip'),
                    status: 'success',
                    size: 512,
                    duration: 1000,
                    error: null,
                    correlationId: 'hist-legacy-0001',
                    metadata: {},
                    version: '1.0',
                };
                await fs.appendFile(
                    historyManager.getHistoryPath(testDir),
                    JSON.stringify(legacyEntry) + '\n',
                    'utf8',
                );
            });

            it('reads legacy entries without throwing', async() => {
                const history = await historyManager.getHistory(testDir);
                expect(history).to.have.length(1);
                expect(history[0].url).to.include('legacy.zip');
            });

            it('treats missing identity as no-match when filtering', async() => {
                const results = await historyManager.getHistory(testDir, {agentId: 'agent-alpha'});
                expect(results).to.have.length(0);
                const bySession = await historyManager.getHistory(testDir, {sessionId: 'sess-123'});
                expect(bySession).to.have.length(0);
            });

            it('includes legacy entries when no identity filter is set', async() => {
                await historyManager.logDownload({
                    url: 'https://example.com/new.zip',
                    filePath: path.join(testDir, 'new.zip'),
                    status: 'success',
                    ...identity,
                });
                const history = await historyManager.getHistory(testDir);
                expect(history).to.have.length(2);
            });

            it('exports legacy entries to CSV with blank identity columns', async() => {
                const exported = await historyManager.exportHistory(testDir, 'csv');
                const lines = exported.split('\n');
                expect(lines[0]).to.include('Agent ID,Session ID,Request ID,Conversation ID');
                // Legacy data row ends with four empty columns
                expect(lines[1]).to.match(/,,,$/);
            });
        });

        describe('export', () => {
            beforeEach(async() => {
                await historyManager.logDownload({
                    url: 'https://example.com/tracked.zip',
                    filePath: path.join(testDir, 'tracked.zip'),
                    status: 'success',
                    size: 100,
                    ...identity,
                });
            });

            it('includes identity fields in JSON export', async() => {
                const exported = await historyManager.exportHistory(testDir, 'json');
                const parsed = JSON.parse(exported);
                expect(parsed[0].agentId).to.equal('agent-alpha');
                expect(parsed[0].sessionId).to.equal('sess-123');
                expect(parsed[0].requestId).to.equal('req-456');
                expect(parsed[0].conversationId).to.equal('conv-789');
            });

            it('includes identity columns in CSV export', async() => {
                const exported = await historyManager.exportHistory(testDir, 'csv');
                const lines = exported.split('\n');
                expect(lines[0]).to.include('Agent ID');
                expect(lines[0]).to.include('Session ID');
                expect(lines[0]).to.include('Request ID');
                expect(lines[0]).to.include('Conversation ID');
                expect(lines[1]).to.include('"agent-alpha"');
                expect(lines[1]).to.include('"sess-123"');
                expect(lines[1]).to.include('"req-456"');
                expect(lines[1]).to.include('"conv-789"');
            });

            it('filters exports by identity', async() => {
                const exported = await historyManager.exportHistory(testDir, 'json', {agentId: 'someone-else'});
                expect(JSON.parse(exported)).to.have.length(0);
            });
        });

        describe('statistics', () => {
            it('counts downloads by agent, omitting entries without one', async() => {
                await historyManager.logDownload({
                    url: 'https://example.com/1.zip', filePath: path.join(testDir, '1.zip'),
                    status: 'success', agentId: 'agent-alpha',
                });
                await historyManager.logDownload({
                    url: 'https://example.com/2.zip', filePath: path.join(testDir, '2.zip'),
                    status: 'success', agentId: 'agent-alpha',
                });
                await historyManager.logDownload({
                    url: 'https://example.com/3.zip', filePath: path.join(testDir, '3.zip'),
                    status: 'failed', error: 'boom', agentId: 'agent-beta',
                });
                await historyManager.logDownload({
                    url: 'https://example.com/4.zip', filePath: path.join(testDir, '4.zip'),
                    status: 'success',
                });

                const stats = await historyManager.getStatistics(testDir);
                expect(stats.downloadsByAgent['agent-alpha']).to.equal(2);
                expect(stats.downloadsByAgent['agent-beta']).to.equal(1);
                expect(Object.keys(stats.downloadsByAgent)).to.have.length(2);
            });
        });
    });
});