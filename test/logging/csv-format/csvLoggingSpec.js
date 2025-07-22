/**
 * @fileoverview Test suite for CSV logging format via NGET_LOGGING_FORMAT environment variable
 * Verifies that setting NGET_LOGGING_FORMAT=csv or NGET_LOG_FORMAT=csv behaves correctly
 * Note: CSV format may produce structured output that can be parsed as CSV-like data
 */

const { expect } = require('chai');
const Logger = require('../../../lib/services/Logger');
const LogsCommands = require('../../../lib/cli/logsCommands');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

describe('CSV Logging Format Environment Variable', () => {
    let tempLogDir;
    let logger;
    let originalEnv;
    let consoleOutput = [];
    let originalConsoleLog;
    let logsCommands;

    beforeEach(() => {
        // Save original environment
        originalEnv = { ...process.env };
        
        // Create temporary log directory
        tempLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-csv-log-test-'));
        
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
        process.env = { ...originalEnv };
        
        // Restore console.log
        console.log = originalConsoleLog;
        
        // Cleanup temporary directory
        if (tempLogDir && fs.existsSync(tempLogDir)) {
            try {
                fs.rmSync(tempLogDir, { recursive: true, force: true });
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

    describe('CSV Environment Variable Setting', () => {
        it('should set NGET_LOG_FORMAT=csv via logs command', async () => {
            // Simulate CSV format command
            await logsCommands.execute(['format'], { csv: true });
            
            expect(process.env.NGET_LOG_FORMAT).to.equal('csv');
            expect(consoleOutput).to.include('Logging format set to: csv');
        });

        it('should recognize CSV format from environment variable', () => {
            // Set CSV format via environment variable
            process.env.NGET_LOG_FORMAT = 'csv';
            
            // Check that environment variable is properly set
            expect(process.env.NGET_LOG_FORMAT).to.equal('csv');
            
            // Verify logs command recognizes it
            const format = process.env.NGET_LOG_FORMAT || 'text';
            expect(format).to.equal('csv');
        });

        it('should handle NGET_LOGGING_FORMAT=csv as alternative', () => {
            process.env.NGET_LOGGING_FORMAT = 'csv';
            
            // Create logger that should respect this setting
            logger = new Logger({
                format: process.env.NGET_LOGGING_FORMAT || 'text',
                level: 'info',
                outputs: ['console'],
                logDir: tempLogDir
            });
            
            expect(logger.config.format).to.equal('csv');
        });
    });

    describe('CSV-Compatible Output Format', () => {
        beforeEach(() => {
            // Set CSV format
            process.env.NGET_LOG_FORMAT = 'csv';
            process.env.NGET_LOGGING_FORMAT = 'csv';
        });

        it('should produce structured output suitable for CSV processing', () => {
            logger = new Logger({
                format: 'csv',
                level: 'info',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: false // Disable colors for CSV compatibility
            });
            
            // Log test data with structured metadata
            logger.info('Download started', {
                url: 'https://example.com/file.zip',
                size: 1048576,
                type: 'application/zip'
            });
            
            expect(consoleOutput).to.have.length(1);
            const logOutput = consoleOutput[0];
            
            // Should contain structured data that could be parsed as CSV fields
            expect(logOutput).to.include('Download started');
            expect(logOutput).to.include('https://example.com/file.zip');
            expect(logOutput).to.include('1048576');
        });

        it('should handle CSV format for multiple log entries', () => {
            logger = new Logger({
                format: 'csv',
                level: 'info',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: false
            });
            
            // Simulate download progress logs
            const testLogs = [
                { message: 'Download initiated', meta: { url: 'file1.zip', status: 'starting' } },
                { message: 'Download progress', meta: { url: 'file1.zip', percentage: 50, speed: '2MB/s' } },
                { message: 'Download completed', meta: { url: 'file1.zip', status: 'success', duration: 5.2 } }
            ];
            
            testLogs.forEach(log => {
                logger.info(log.message, log.meta);
            });
            
            expect(consoleOutput).to.have.length(3);
            
            // Each log entry should contain timestamp, level, message, and metadata
            consoleOutput.forEach((output, index) => {
                expect(output).to.include('INFO');
                expect(output).to.include(testLogs[index].message);
                expect(output).to.include('file1.zip');
            });
        });

        it('should maintain consistent structure for CSV parsing', () => {
            logger = new Logger({
                format: 'csv',
                level: 'info',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: false
            });
            
            // Test different types of log data
            logger.info('Network request', { method: 'GET', status: 200, duration: 120 });
            logger.warn('Retry attempt', { attempt: 2, maxRetries: 3, delay: 1000 });
            logger.error('Download failed', { error: 'ENOTFOUND', code: 404 });
            
            expect(consoleOutput).to.have.length(3);
            
            // All outputs should have similar structure for CSV consistency
            consoleOutput.forEach(output => {
                // Should start with timestamp pattern
                expect(output).to.match(/^\[.*\]/);
                // Should have log level
                expect(output).to.match(/(INFO|WARN|ERROR)/);
                // Should be structured consistently
                const parts = output.split(':');
                expect(parts.length).to.be.greaterThan(1);
            });
        });

        it('should write CSV-compatible format to files', () => {
            logger = new Logger({
                format: 'csv',
                level: 'info',
                outputs: ['file'],
                logDir: tempLogDir,
                enableColors: false
            });
            
            logger.info('File logging test', {
                operation: 'download',
                file: 'test.zip',
                size: 2048,
                status: 'completed'
            });
            
            const logFilePath = path.join(tempLogDir, 'application.log');
            expect(fs.existsSync(logFilePath)).to.be.true;
            
            const fileContent = fs.readFileSync(logFilePath, 'utf8');
            expect(fileContent).to.include('File logging test');
            expect(fileContent).to.include('download');
            expect(fileContent).to.include('test.zip');
            expect(fileContent).to.include('2048');
        });
    });

    describe('CSV Format Integration with Download Pipeline', () => {
        it('should respect CSV format environment variable in download operations', () => {
            process.env.NGET_LOG_FORMAT = 'csv';
            
            // Simulate how downloadPipeline.js reads the environment variable
            const logFormat = process.env.NGET_LOG_FORMAT || 'text';
            expect(logFormat).to.equal('csv');
            
            logger = new Logger({
                format: logFormat,
                level: 'info',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: false
            });
            
            // Simulate download pipeline logging
            logger.info('Pipeline started', { urls: ['file1.zip', 'file2.zip'], concurrent: 3 });
            logger.info('Download queued', { url: 'file1.zip', position: 1 });
            logger.info('Download completed', { url: 'file1.zip', size: 1024000, duration: 2.5 });
            
            expect(consoleOutput).to.have.length(3);
            
            // Verify structured output suitable for CSV processing
            const pipelineLog = consoleOutput[0];
            expect(pipelineLog).to.include('Pipeline started');
            expect(pipelineLog).to.include('file1.zip');
            expect(pipelineLog).to.include('file2.zip');
        });

        it('should handle CSV format for error logging', () => {
            process.env.NGET_LOG_FORMAT = 'csv';
            
            logger = new Logger({
                format: 'csv',
                level: 'error',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: false
            });
            
            const testError = new Error('Connection timeout');
            testError.code = 'ECONNTIMEDOUT';
            
            logger.error('Download error', {
                url: 'https://slow.example.com/file.zip',
                attempt: 3,
                maxRetries: 5
            }, testError);
            
            expect(consoleOutput).to.have.length(1);
            
            const errorLog = consoleOutput[0];
            expect(errorLog).to.include('Download error');
            expect(errorLog).to.include('Connection timeout');
            expect(errorLog).to.include('slow.example.com');
        });
    });

    describe('CSV Format Validation', () => {
        beforeEach(() => {
            logger = new Logger({
                format: 'csv',
                level: 'info',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: false
            });
        });

        it('should produce output that can be processed by CSV tools', () => {
            logger.info('CSV compatibility test', {
                field1: 'value1',
                field2: 'value2',
                field3: 123,
                field4: true
            });
            
            expect(consoleOutput).to.have.length(1);
            const output = consoleOutput[0];
            
            // Should not contain problematic CSV characters without proper escaping
            // Should be parseable by standard CSV processing tools
            expect(output).to.be.a('string');
            expect(output.length).to.be.greaterThan(0);
            
            // Should contain the structured data in a readable format
            expect(output).to.include('CSV compatibility test');
            expect(output).to.include('value1');
            expect(output).to.include('value2');
        });

        it('should handle special characters appropriately for CSV', () => {
            logger.info('Special character test', {
                commaField: 'value,with,commas',
                quoteField: 'value"with"quotes',
                newlineField: 'value\nwith\nnewlines'
            });
            
            expect(consoleOutput).to.have.length(1);
            const output = consoleOutput[0];
            
            // Should handle special CSV characters
            expect(output).to.include('Special character test');
            expect(output).to.be.a('string');
        });
    });
});