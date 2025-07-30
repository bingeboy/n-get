const {expect} = require('chai');
const fs = require('node:fs').promises;
const path = require('node:path');
const HistoryCommands = require('../lib/cli/historyCommands');
const HistoryManager = require('../lib/services/HistoryManager');

describe('HistoryCommands CLI', () => {
    const testDir = path.join(__dirname, 'temp_history_cli');
    let historyCommands;
    let historyManager;
    let originalLog;
    let consoleOutput;

    before(async() => {
        // Create temp directory for tests
        try {
            await fs.mkdir(testDir, {recursive: true});
        } catch {
            // Directory might already exist
        }
    });

    beforeEach(async() => {
        historyCommands = new HistoryCommands();
        historyManager = new HistoryManager();
        
        // Capture console output
        consoleOutput = [];
        originalLog = console.log;
        const originalError = console.error;
        
        console.log = (...args) => {
            consoleOutput.push(args.join(' '));
        };
        console.error = (...args) => {
            consoleOutput.push(args.join(' '));
        };
        
        // Restore console.error in afterEach
        this.originalError = originalError;
        
        // Clear any existing history before each test
        try {
            await historyManager.clearHistory(testDir);
        } catch {
            // Ignore if history doesn't exist
        }
    });

    afterEach(function() {
        // Restore console methods
        console.log = originalLog;
        if (this.originalError) {
            console.error = this.originalError;
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

    describe('Help Command', () => {
        it('should show help when no arguments provided', async() => {
            await historyCommands.execute([], {});
            
            expect(consoleOutput.join('\n')).to.include('History Commands:');
            expect(consoleOutput.join('\n')).to.include('show');
            expect(consoleOutput.join('\n')).to.include('clear');
            expect(consoleOutput.join('\n')).to.include('search');
            expect(consoleOutput.join('\n')).to.include('stats');
            expect(consoleOutput.join('\n')).to.include('export');
        });
    });

    describe('Show Command', () => {
        beforeEach(async() => {
            // Add test history entries
            const entries = [
                {
                    url: 'https://example.com/file1.zip',
                    filePath: path.join(testDir, 'file1.zip'),
                    status: 'success',
                    size: 1024,
                    duration: 2000,
                },
                {
                    url: 'https://example.com/file2.pdf',
                    filePath: path.join(testDir, 'file2.pdf'),
                    status: 'failed',
                    error: 'HTTP 404 Not Found',
                },
            ];

            for (const entry of entries) {
                await historyManager.logDownload(entry);
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        });

        it('should show history entries', async() => {
            const argv = {destination: testDir};
            await historyCommands.execute(['show'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('Download History (2 entries)');
            expect(output).to.include('✅ Success file1.zip');
            expect(output).to.include('❌ Failed file2.pdf');
            expect(output).to.include('https://example.com/file1.zip');
            expect(output).to.include('HTTP 404 Not Found');
        });

        it('should handle empty history', async() => {
            const emptyDir = path.join(testDir, 'empty');
            await fs.mkdir(emptyDir, {recursive: true});
            
            const argv = {destination: emptyDir};
            await historyCommands.execute(['show'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('No download history found');
        });

        it('should respect limit option', async() => {
            const argv = {destination: testDir, limit: '1'};
            await historyCommands.execute(['show'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('Download History (1 entries)');
        });

        it('should filter by status', async() => {
            const argv = {destination: testDir, status: 'success'};
            await historyCommands.execute(['show'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('✅ Success file1.zip');
            expect(output).to.not.include('❌ Failed file2.pdf');
        });
    });

    describe('Search Command', () => {
        beforeEach(async() => {
            // Add test history entries
            const entries = [
                {
                    url: 'https://example.com/document.pdf',
                    filePath: path.join(testDir, 'document.pdf'),
                    status: 'success',
                    size: 2048,
                },
                {
                    url: 'https://test.com/archive.zip',
                    filePath: path.join(testDir, 'archive.zip'),
                    status: 'success',
                    size: 4096,
                },
            ];

            for (const entry of entries) {
                await historyManager.logDownload(entry);
            }
        });

        it('should search by URL', async() => {
            const argv = {destination: testDir};
            await historyCommands.execute(['search', 'example.com'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('Search Results for "example.com"');
            expect(output).to.include('document.pdf');
            expect(output).to.not.include('archive.zip');
        });

        it('should search by filename', async() => {
            const argv = {destination: testDir};
            await historyCommands.execute(['search', 'archive'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('Search Results for "archive"');
            expect(output).to.include('archive.zip');
            expect(output).to.not.include('document.pdf');
        });

        it('should handle no search results', async() => {
            const argv = {destination: testDir};
            await historyCommands.execute(['search', 'nonexistent'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('No downloads found matching: "nonexistent"');
        });

        it('should require search term', async() => {
            const argv = {destination: testDir};
            await historyCommands.execute(['search'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('Search term is required');
        });
    });

    describe('Stats Command', () => {
        beforeEach(async() => {
            // Add test history entries with different statuses
            const entries = [
                {url: 'https://example.com/file1.zip', filePath: path.join(testDir, 'file1.zip'), status: 'success', size: 1024, duration: 2000},
                {url: 'https://example.com/file2.zip', filePath: path.join(testDir, 'file2.zip'), status: 'success', size: 2048, duration: 1500},
                {url: 'https://example.com/file3.zip', filePath: path.join(testDir, 'file3.zip'), status: 'failed', error: 'HTTP 404'},
                {url: 'https://example.com/file4.zip', filePath: path.join(testDir, 'file4.zip'), status: 'failed', error: 'Connection timeout'},
            ];

            for (const entry of entries) {
                await historyManager.logDownload(entry);
            }
        });

        it('should show download statistics', async() => {
            const argv = {destination: testDir};
            await historyCommands.execute(['stats'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('Download Statistics (Last 30 days)');
            expect(output).to.include('📊 Total Downloads: 4');
            expect(output).to.include('✅ Successful: 2 (50.00%)');
            expect(output).to.include('❌ Failed: 2');
            expect(output).to.include('📏 Total Size: 3.0 KB');
            expect(output).to.include('Top Errors:');
            expect(output).to.include('HTTP 404');
            expect(output).to.include('Connection timeout');
        });

        it('should respect days option', async() => {
            const argv = {destination: testDir, days: '7'};
            await historyCommands.execute(['stats'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('Download Statistics (Last 7 days)');
        });
    });

    describe('Export Command', () => {
        beforeEach(async() => {
            // Add test history entry
            await historyManager.logDownload({
                url: 'https://example.com/file.zip',
                filePath: path.join(testDir, 'file.zip'),
                status: 'success',
                size: 1024,
                duration: 2000,
            });
        });

        it('should export history as JSON to stdout', async() => {
            const argv = {destination: testDir, json: true, output: '-'};
            await historyCommands.execute(['export'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('"url": "https://example.com/file.zip"');
            expect(output).to.include('"status": "success"');
            expect(output).to.include('"size": 1024');
        });

        it('should export history as CSV to stdout', async() => {
            const argv = {destination: testDir, csv: true, output: '-'};
            await historyCommands.execute(['export'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('Timestamp,URL,File Path,Status,Size (bytes)');
            expect(output).to.include('https://example.com/file.zip');
            expect(output).to.include('success');
            expect(output).to.include('1024');
        });

        it('should export history to file', async() => {
            const outputFile = path.join(testDir, 'export.json');
            const argv = {destination: testDir, json: true, output: outputFile};
            
            await historyCommands.execute(['export'], argv);

            // Check that file was created
            const stats = await fs.stat(outputFile);
            expect(stats.isFile()).to.be.true;

            // Check file content
            const content = await fs.readFile(outputFile, 'utf8');
            const parsed = JSON.parse(content);
            expect(parsed).to.be.an('array');
            expect(parsed[0].url).to.equal('https://example.com/file.zip');

            // Clean up
            await fs.unlink(outputFile);
        });

        it('should show export progress message', async() => {
            const argv = {destination: testDir, json: true, output: '-'};
            await historyCommands.execute(['export'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('📤 Exporting history to JSON format');
        });
    });

    describe('Clear Command', () => {
        beforeEach(async() => {
            // Add test history entry
            await historyManager.logDownload({
                url: 'https://example.com/file.zip',
                filePath: path.join(testDir, 'file.zip'),
                status: 'success',
                size: 1024,
            });
        });

        it('should warn when no confirmation flag provided', async() => {
            const argv = {destination: testDir};
            await historyCommands.execute(['clear'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('This will permanently delete all download history');
            expect(output).to.include('Use --confirm to proceed');
        });

        it('should clear history with confirm flag', async() => {
            const argv = {destination: testDir, confirm: true};
            await historyCommands.execute(['clear'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('✅ Download history cleared successfully');

            // Verify history is actually cleared
            const history = await historyManager.getHistory(testDir);
            expect(history).to.have.length(0);
        });

        it('should clear history with force flag', async() => {
            const argv = {destination: testDir, force: true};
            await historyCommands.execute(['clear'], argv);

            const output = consoleOutput.join('\n');
            expect(output).to.include('✅ Download history cleared successfully');
        });
    });

    describe('Error Handling', () => {
        it('should handle unknown commands', async() => {
            let exitCode;
            const originalExit = process.exit;
            process.exit = (code) => { exitCode = code; };

            try {
                await historyCommands.execute(['unknown'], {destination: testDir});
                expect(exitCode).to.equal(1);
                
                const output = consoleOutput.join('\n');
                expect(output).to.include('Unknown history command: unknown');
            } finally {
                process.exit = originalExit;
            }
        });
    });

    describe('Formatting Helpers', () => {
        it('should format status correctly', () => {
            expect(historyCommands.formatStatus('success')).to.equal('✅ Success');
            expect(historyCommands.formatStatus('failed')).to.equal('❌ Failed');
            expect(historyCommands.formatStatus('in_progress')).to.equal('⏳ In Progress');
            expect(historyCommands.formatStatus('unknown')).to.equal('❓ unknown');
        });

        it('should format file sizes correctly', () => {
            expect(historyCommands.formatSize(0)).to.equal('0 B');
            expect(historyCommands.formatSize(1024)).to.equal('1.0 KB');
            expect(historyCommands.formatSize(1048576)).to.equal('1.0 MB');
            expect(historyCommands.formatSize(1073741824)).to.equal('1.0 GB');
        });
    });
});