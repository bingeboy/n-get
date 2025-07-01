const { expect } = require('chai');
const fs = require('fs').promises;
const path = require('path');
const chdir = require('../lib/chdir');

describe('Chdir Module', function() {
    let originalCwd;

    beforeEach(function() {
        originalCwd = process.cwd();
    });

    afterEach(function() {
        // Restore original working directory
        process.chdir(originalCwd);
    });

    describe('#chdir()', function() {
        it('should change to valid directory and return new path', function() {
            const tempDir = path.join(__dirname, '..', 'temp');
            const result = chdir(tempDir);
            
            expect(result).to.equal(tempDir);
            expect(process.cwd()).to.equal(tempDir);
        });

        it('should throw error for invalid directory', function() {
            const invalidDir = '/nonexistent/directory';
            
            expect(() => chdir(invalidDir)).to.throw();
        });

        it('should handle relative paths', function() {
            const tempDir = './temp';
            const result = chdir(tempDir);
            
            expect(result).to.include('temp');
            expect(process.cwd()).to.include('temp');
        });
    });
});