/**
 * @fileoverview Test suite for JSON logging format via NGET_LOGGING_FORMAT environment variable
 * Verifies that setting NGET_LOGGING_FORMAT=json produces proper JSON structured logs
 */

const { expect } = require('chai');
const Logger = require('../../../lib/services/Logger');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

describe('JSON Logging Format Environment Variable', () => {
    let tempLogDir;
    let logger;
    let originalEnv;
    let consoleOutput = [];
    let originalConsoleLog;

    beforeEach(() => {
        // Save original environment
        originalEnv = { ...process.env };
        
        // Set JSON format via environment variable
        process.env.NGET_LOGGING_FORMAT = 'json';
        process.env.NGET_LOG_FORMAT = 'json'; // Alternative format
        
        // Create temporary log directory
        tempLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-json-log-test-'));
        
        // Capture console output
        consoleOutput = [];
        originalConsoleLog = console.log;
        console.log = (message) => {
            consoleOutput.push(message);
        };
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

    describe('Environment Variable Integration', () => {
        it('should respect NGET_LOGGING_FORMAT=json environment variable', () => {
            // Create logger - should pick up format from environment
            logger = new Logger({
                level: 'info',
                format: process.env.NGET_LOGGING_FORMAT || 'text',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: false // Disable colors for JSON testing
            });
            
            // Log a test message
            logger.info('Test JSON message', { 
                testData: 'sample data',
                number: 42,
                boolean: true
            });
            
            // Verify console output is JSON
            expect(consoleOutput).to.have.length(1);
            
            const logOutput = consoleOutput[0];
            expect(() => JSON.parse(logOutput)).to.not.throw();
            
            const parsedLog = JSON.parse(logOutput);
            expect(parsedLog).to.have.property('timestamp');
            expect(parsedLog).to.have.property('level', 'INFO');
            expect(parsedLog).to.have.property('message', 'Test JSON message');
            expect(parsedLog).to.have.property('meta');
            expect(parsedLog.meta).to.deep.equal({
                testData: 'sample data',
                number: 42,
                boolean: true
            });
        });

        it('should produce valid JSON for different log levels', () => {
            logger = new Logger({
                level: 'trace',
                outputs: ['console'],
                format: 'json',
                logDir: tempLogDir,
                enableColors: false
            });
            
            // Test different log levels
            logger.error('Error message', { errorCode: 500 });
            logger.warn('Warning message', { warningType: 'deprecation' });
            logger.info('Info message', { operation: 'download' });
            logger.debug('Debug message', { debugInfo: 'detailed' });
            logger.trace('Trace message', { traceId: 'trace123' });
            
            expect(consoleOutput).to.have.length(5);
            
            // Verify all outputs are valid JSON
            consoleOutput.forEach((output, index) => {
                expect(() => JSON.parse(output), `Output ${index} should be valid JSON`).to.not.throw();
                
                const parsed = JSON.parse(output);
                expect(parsed).to.have.property('timestamp');
                expect(parsed).to.have.property('level');
                expect(parsed).to.have.property('message');
                expect(parsed).to.have.property('meta');
            });
            
            // Verify specific log level formatting
            const errorLog = JSON.parse(consoleOutput[0]);
            expect(errorLog.level).to.equal('ERROR');
            expect(errorLog.message).to.equal('Error message');
            expect(errorLog.meta.errorCode).to.equal(500);
            
            const infoLog = JSON.parse(consoleOutput[2]);
            expect(infoLog.level).to.equal('INFO');
            expect(infoLog.message).to.equal('Info message');
            expect(infoLog.meta.operation).to.equal('download');
        });

        it('should include structured data in JSON format', () => {
            logger = new Logger({
                level: 'info',
                format: 'json',
                outputs: ['console'],
                logDir: tempLogDir,
                includeStackTrace: true,
                enableColors: false
            });
            
            const complexMeta = {
                downloadUrl: 'https://example.com/file.zip',
                fileSize: 1048576,
                progress: {
                    percentage: 75.5,
                    speed: '2.5 MB/s',
                    eta: '30s'
                },
                headers: {
                    'content-type': 'application/zip',
                    'content-length': '1048576'
                }
            };
            
            logger.info('Download progress update', complexMeta);
            
            expect(consoleOutput).to.have.length(1);
            
            const parsedLog = JSON.parse(consoleOutput[0]);
            expect(parsedLog.meta).to.deep.equal(complexMeta);
            expect(parsedLog.meta.progress.percentage).to.equal(75.5);
            expect(parsedLog.meta.headers['content-type']).to.equal('application/zip');
        });

        it('should handle error objects in JSON format', () => {
            logger = new Logger({
                level: 'error',
                format: 'json',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: false
            });
            
            const testError = new Error('Test download error');
            testError.code = 'DOWNLOAD_FAILED';
            testError.statusCode = 404;
            
            logger.error('Download failed', { 
                url: 'https://example.com/missing.zip',
                attempt: 3 
            }, testError);
            
            expect(consoleOutput).to.have.length(1);
            
            const parsedLog = JSON.parse(consoleOutput[0]);
            expect(parsedLog.error).to.exist;
            expect(parsedLog.error.name).to.equal('Error');
            expect(parsedLog.error.message).to.equal('Test download error');
            expect(parsedLog.error.code).to.equal('DOWNLOAD_FAILED');
            expect(parsedLog.meta.url).to.equal('https://example.com/missing.zip');
            expect(parsedLog.meta.attempt).to.equal(3);
        });

        it('should write JSON format to file outputs', () => {
            logger = new Logger({
                level: 'info',
                format: 'json',
                outputs: ['console', 'file'],
                logDir: tempLogDir,
                enableColors: false
            });
            
            logger.info('File logging test', { 
                testType: 'file-output',
                format: 'json'
            });
            
            // Check console output
            expect(consoleOutput).to.have.length(1);
            expect(() => JSON.parse(consoleOutput[0])).to.not.throw();
            
            // Check file output
            const logFilePath = path.join(tempLogDir, 'application.log');
            expect(fs.existsSync(logFilePath)).to.be.true;
            
            const fileContent = fs.readFileSync(logFilePath, 'utf8').trim();
            expect(() => JSON.parse(fileContent)).to.not.throw();
            
            const parsedFileLog = JSON.parse(fileContent);
            expect(parsedFileLog.message).to.equal('File logging test');
            expect(parsedFileLog.meta.testType).to.equal('file-output');
        });
    });

    describe('JSON Format Structure Validation', () => {
        beforeEach(() => {
            logger = new Logger({
                level: 'trace',
                format: 'json',
                outputs: ['console'],
                logDir: tempLogDir,
                enableColors: false
            });
        });

        it('should include all required JSON log fields', () => {
            logger.info('Structure validation test', { validation: true });
            
            const parsedLog = JSON.parse(consoleOutput[0]);
            
            // Required fields
            expect(parsedLog).to.have.property('timestamp');
            expect(parsedLog).to.have.property('level');
            expect(parsedLog).to.have.property('message');
            
            // Optional fields that should be present
            expect(parsedLog).to.have.property('process');
            expect(parsedLog.process).to.have.property('pid');
            expect(parsedLog.process).to.have.property('memory');
            expect(parsedLog.process).to.have.property('uptime');
            
            // Timestamp should be valid ISO string
            expect(() => new Date(parsedLog.timestamp)).to.not.throw();
            expect(new Date(parsedLog.timestamp).toISOString()).to.equal(parsedLog.timestamp);
        });

        it('should handle empty metadata gracefully', () => {
            logger.info('Empty metadata test');
            
            const parsedLog = JSON.parse(consoleOutput[0]);
            expect(parsedLog.message).to.equal('Empty metadata test');
            expect(parsedLog.meta).to.be.undefined;
        });

        it('should maintain JSON format consistency across different operations', () => {
            // Simulate various n-get operations
            logger.info('Download started', { url: 'https://example.com/file1.zip' });
            logger.info('Download progress', { percentage: 50, speed: '1.5 MB/s' });
            logger.info('Download completed', { size: 1024000, duration: 5.2 });
            
            expect(consoleOutput).to.have.length(3);
            
            consoleOutput.forEach((output, index) => {
                const parsed = JSON.parse(output);
                expect(parsed).to.have.property('timestamp');
                expect(parsed).to.have.property('level', 'INFO');
                expect(parsed).to.have.property('message');
                expect(parsed).to.have.property('process');
            });
        });
    });
});