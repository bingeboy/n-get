const { expect } = require('chai');
const path = require('path');
const chdir = require('../lib/chdir.js');

describe('Destination handling', function() {
    let originalCwd;

    beforeEach(function() {
        originalCwd = process.cwd();
    });

    afterEach(function() {
        // Restore original working directory
        process.chdir(originalCwd);
    });

    it('should handle valid destination directory', function() {
        const tempDir = path.join(__dirname, '..', 'temp');
        const result = chdir(tempDir);
        expect(result).to.equal(tempDir);
        expect(process.cwd()).to.equal(tempDir);
    });
});
