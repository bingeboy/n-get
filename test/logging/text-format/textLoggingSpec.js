/**
 * @fileoverview Test suite for text logging format via NGET_LOGGING_FORMAT environment variable
 * Verifies that setting NGET_LOGGING_FORMAT=text produces human-readable text logs (default format)
 */

const {expect} = require('chai');
const Logger = require('../../../lib/services/Logger');
const LogsCommands = require('../../../lib/cli/logsCommands');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

describe('Text Logging Format Environment Variable', () => {
    let tempLogDir;
    let logger;
    let originalEnv;
    let consoleOutput = [];
    let originalConsoleLog;
    let logsCommands;

    beforeEach(() => {
        // Save original environment
        originalEnv = {...process.env};
        
        // Set text format via environment variable (default)
        process.env.NGET_LOGGING_FORMAT = 'text';
        process.env.NGET_LOG_FORMAT = 'text';
        
        // Create temporary log directory
        tempLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-text-log-test-'));
        
        // Capture console output
        consoleOutput = [];
        originalConsoleLog = console.log;
        console.log = (message) => {
            consoleOutput.push(message);
        };
        
        // Initialize logs commands handler
        logsCommands = new LogsCommands();
    });

    afterEach(() => {
        // Restore environment
        process.env = {...originalEnv};
        
        // Restore console.log
        console.log = originalConsoleLog;
        
        // Cleanup temporary directory
        if (tempLogDir && fs.existsSync(tempLogDir)) {
            try {
                fs.rmSync(tempLogDir, {recursive: true, force: true});
            } catch (error) {
                // Ignore cleanup errors
            }
        }
        
        // Cleanup logger
        if (logger && typeof logger.shutdown === 'function') {
            try {
                logger.shutdown();
            } catch (error) {
                // Ignore cleanup errors
            }
        }
    });

    describe('Environment Variable Integration', () => {
        it('should respect NGET_LOGGING_FORMAT=text environment variable', () => {
            logger = new Logger({
                level: 'info',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: false, // Disable colors for consistent testing
            });
            
            logger.info('Test text message', { 
                testData: 'sample data',
                number: 42,
                boolean: true,
            });
            
            expect(consoleOutput).to.have.length(1);
            
            const logOutput = consoleOutput[0];
            
            // Should NOT be JSON
            expect(() => JSON.parse(logOutput)).to.throw();
            
            // Should be human-readable text format
            expect(logOutput).to.match(/^\[.*\] INFO: Test text message/);
            expect(logOutput).to.include('Test text message');
            expect(logOutput).to.include('"testData":"sample data"');
            expect(logOutput).to.include('"number":42');
            expect(logOutput).to.include('"boolean":true');
        });

        it('should set text format via logs command', async() => {
            await logsCommands.execute(['format'], {text: true});
            
            expect(process.env.NGET_LOG_FORMAT).to.equal('text');
            expect(consoleOutput).to.include('Logging format set to: text');
        });

        it('should default to text format when no environment variable is set', () => {
            // Clear format environment variables
            delete process.env.NGET_LOG_FORMAT;
            delete process.env.NGET_LOGGING_FORMAT;
            
            logger = new Logger({
                level: 'info',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: false,
            });
            
            // Default should be text format
            expect(logger.config.format).to.equal('text');
            
            logger.info('Default format test');
            
            expect(consoleOutput).to.have.length(1);
            const logOutput = consoleOutput[0];
            
            // Should be text format
            expect(logOutput).to.match(/^\[.*\] INFO: Default format test$/);
            expect(() => JSON.parse(logOutput)).to.throw();
        });
    });

    describe('Text Format Structure', () => {
        beforeEach(() => {
            logger = new Logger({
                level: 'trace',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: false,
            });
        });

        it('should produce human-readable text for different log levels', () => {
            // Test different log levels
            logger.error('Error message', {errorCode: 500});
            logger.warn('Warning message', {warningType: 'deprecation'});
            logger.info('Info message', {operation: 'download'});
            logger.debug('Debug message', {debugInfo: 'detailed'});
            logger.trace('Trace message', {traceId: 'trace123'});
            
            expect(consoleOutput).to.have.length(5);
            
            // Verify text format for each level
            expect(consoleOutput[0]).to.match(/^\[.*\] ERROR: Error message/);
            expect(consoleOutput[1]).to.match(/^\[.*\] WARN: Warning message/);
            expect(consoleOutput[2]).to.match(/^\[.*\] INFO: Info message/);
            expect(consoleOutput[3]).to.match(/^\[.*\] DEBUG: Debug message/);
            expect(consoleOutput[4]).to.match(/^\[.*\] TRACE: Trace message/);
            
            // Each should include metadata in JSON format within text
            consoleOutput.forEach(output => {
                expect(output).to.include('{');
                expect(output).to.include('}');
            });
        });

        it('should format timestamps in ISO format', () => {
            logger.info('Timestamp test');
            
            expect(consoleOutput).to.have.length(1);
            const logOutput = consoleOutput[0];
            
            // Extract timestamp from text format [timestamp]
            const timestampMatch = logOutput.match(/^\[([^\]]+)\]/);
            expect(timestampMatch).to.not.be.null;
            
            const timestamp = timestampMatch[1];
            expect(() => new Date(timestamp)).to.not.throw();
            expect(new Date(timestamp).toISOString()).to.equal(timestamp);
        });

        it('should handle metadata formatting in text logs', () => {
            const complexMeta = {
                downloadUrl: 'https://example.com/file.zip',
                fileSize: 1048576,
                progress: {
                    percentage: 75.5,
                    speed: '2.5 MB/s',
                    eta: '30s',
                },
                array: ['item1', 'item2', 'item3'],
            };
            
            logger.info('Complex metadata test', complexMeta);
            
            expect(consoleOutput).to.have.length(1);
            const logOutput = consoleOutput[0];
            
            // Should contain the metadata as JSON string within text
            expect(logOutput).to.include('Complex metadata test');
            expect(logOutput).to.include('https://example.com/file.zip');
            expect(logOutput).to.include('1048576');
            expect(logOutput).to.include('75.5');
            expect(logOutput).to.include('2.5 MB/s');
            expect(logOutput).to.include('["item1","item2","item3"]');
        });

        it('should handle error objects in text format', () => {
            const testError = new Error('Test download error');
            testError.code = 'DOWNLOAD_FAILED';
            testError.statusCode = 404;
            
            logger.error('Download failed', { 
                url: 'https://example.com/missing.zip',
                attempt: 3, 
            }, testError);
            
            expect(consoleOutput).to.have.length(1);
            const logOutput = consoleOutput[0];
            
            expect(logOutput).to.match(/^\[.*\] ERROR: Download failed/);
            expect(logOutput).to.include('https://example.com/missing.zip');
            expect(logOutput).to.include('"attempt":3');
            expect(logOutput).to.include('Error: Test download error');
        });

        it('should handle empty metadata gracefully', () => {
            logger.info('No metadata message');
            
            expect(consoleOutput).to.have.length(1);
            const logOutput = consoleOutput[0];
            
            // Should be clean text without metadata JSON
            expect(logOutput).to.match(/^\[.*\] INFO: No metadata message$/);
            expect(logOutput).to.not.include('{');
            expect(logOutput).to.not.include('}');
        });
    });

    describe('Text Format with Colors', () => {
        beforeEach(() => {
            logger = new Logger({
                level: 'trace',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: true,
            });
        });

        it('should include ANSI color codes when colors are enabled', () => {
            logger.error('Error with color');
            logger.warn('Warning with color');
            logger.info('Info with color');
            logger.debug('Debug with color');
            logger.trace('Trace with color');
            
            expect(consoleOutput).to.have.length(5);
            
            // Check for ANSI color codes
            expect(consoleOutput[0]).to.include('\x1b[31m'); // Red for error
            expect(consoleOutput[1]).to.include('\x1b[33m'); // Yellow for warn
            expect(consoleOutput[2]).to.include('\x1b[36m'); // Cyan for info
            expect(consoleOutput[3]).to.include('\x1b[35m'); // Magenta for debug
            expect(consoleOutput[4]).to.include('\x1b[90m'); // Bright black for trace
            
            // All should include reset code
            consoleOutput.forEach(output => {
                expect(output).to.include('\x1b[0m'); // Reset
            });
        });

        it('should not include color codes when colors are disabled', () => {
            logger = new Logger({
                level: 'info',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: false,
            });
            
            logger.error('Error without color');
            logger.info('Info without color');
            
            expect(consoleOutput).to.have.length(2);
            
            // Should not contain ANSI color codes
            consoleOutput.forEach(output => {
                expect(output).to.not.include('\x1b[');
            });
        });
    });

    describe('Text Format File Output', () => {
        it('should write text format to files', () => {
            logger = new Logger({
                level: 'info',
                outputs: ['console', 'file'],
                logDir: tempLogDir,
                enableColors: false,
            });
            
            logger.info('File logging test', { 
                testType: 'file-output',
                format: 'text',
            });
            
            // Check console output
            expect(consoleOutput).to.have.length(1);
            expect(consoleOutput[0]).to.match(/^\[.*\] INFO: File logging test/);
            
            // Check file output
            const logFilePath = path.join(tempLogDir, 'application.log');
            expect(fs.existsSync(logFilePath)).to.be.true;
            
            const fileContent = fs.readFileSync(logFilePath, 'utf8').trim();
            expect(fileContent).to.match(/^\[.*\] INFO: File logging test/);
            expect(fileContent).to.include('"testType":"file-output"');
            expect(fileContent).to.include('"format":"text"');
            
            // File should not contain color codes
            expect(fileContent).to.not.include('\x1b[');
        });

        it('should maintain consistent text formatting across multiple writes', () => {
            logger = new Logger({
                level: 'info',
                outputs: ['file'],
                logDir: tempLogDir,
            });
            
            // Simulate download progress logging
            logger.info('Download started', {url: 'file1.zip', size: 1024});
            logger.info('Download progress', {url: 'file1.zip', percentage: 50});
            logger.info('Download completed', {url: 'file1.zip', duration: 2.5});
            
            const logFilePath = path.join(tempLogDir, 'application.log');
            const fileContent = fs.readFileSync(logFilePath, 'utf8');
            const lines = fileContent.trim().split('\n');
            
            expect(lines).to.have.length(3);
            
            lines.forEach((line, index) => {
                expect(line).to.match(/^\[.*\] INFO: Download/);
                expect(line).to.include('file1.zip');
            });
        });
    });

    describe('Text Format Integration', () => {
        it('should work with download pipeline environment variable', () => {
            process.env.NGET_LOG_FORMAT = 'text';
            
            // Simulate how downloadPipeline.js uses the environment variable
            const logFormat = process.env.NGET_LOG_FORMAT || 'text';
            expect(logFormat).to.equal('text');
            
            logger = new Logger({
                format: logFormat,
                level: 'info',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: false,
            });
            
            // Simulate download pipeline operations
            logger.info('Pipeline initialization', { 
                urls: ['file1.zip', 'file2.zip'],
                maxConcurrent: 3,
                destination: './downloads',
            });
            
            logger.info('Download queued', { 
                url: 'file1.zip',
                queuePosition: 1,
            });
            
            logger.info('Download completed', { 
                url: 'file1.zip',
                size: 2048000,
                duration: 3.2,
                speed: '640 KB/s',
            });
            
            expect(consoleOutput).to.have.length(3);
            
            // All should be in human-readable text format
            consoleOutput.forEach((output, index) => {
                expect(output).to.match(/^\[.*\] INFO: /);
                expect(() => JSON.parse(output)).to.throw();
            });
            
            // Verify specific content
            expect(consoleOutput[0]).to.include('Pipeline initialization');
            expect(consoleOutput[1]).to.include('Download queued');
            expect(consoleOutput[2]).to.include('Download completed');
        });

        it('should handle text format for different n-get operations', () => {
            logger = new Logger({
                format: 'text',
                level: 'debug',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: false,
            });
            
            // Simulate various n-get operations
            logger.info('Configuration loaded', {profile: 'fast', concurrent: 10});
            logger.debug('Security validation', {url: 'https://example.com', protocol: 'https'});
            logger.info('Resume check', {file: 'partial.zip', resumable: true});
            logger.warn('Retry attempt', {url: 'slow.example.com', attempt: 2});
            logger.error('Download failed', {error: 'Network timeout'});
            
            expect(consoleOutput).to.have.length(5);
            
            // All should be properly formatted text
            const expectedPatterns = [
                /INFO: Configuration loaded/,
                /DEBUG: Security validation/,
                /INFO: Resume check/,
                /WARN: Retry attempt/,
                /ERROR: Download failed/,
            ];
            
            consoleOutput.forEach((output, index) => {
                expect(output).to.match(expectedPatterns[index]);
                expect(output).to.match(/^\[.*\]/); // Timestamp
            });
        });
    });
});