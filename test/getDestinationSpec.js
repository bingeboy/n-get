const path = require('path');
const {expect} = require('chai');
const chdir = require('../lib/chdir.js');

describe('Destination handling', () => {
    let originalCwd;

    beforeEach(() => {
        originalCwd = process.cwd();
    });

    afterEach(() => {
        // Restore original working directory
        process.chdir(originalCwd);
    });

    it('should handle valid destination directory', () => {
        const tempDir = path.join(__dirname, '..', 'temp');
        const result = chdir(tempDir);
        expect(result).to.equal(tempDir);
        expect(process.cwd()).to.equal(tempDir);
    });
});
