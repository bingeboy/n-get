const {expect} = require('chai');
const path = require('path');
const chdir = require('../lib/chdir');

describe('Chdir Module', () => {
    let originalCwd;

    beforeEach(() => {
        originalCwd = process.cwd();
    });

    afterEach(() => {
        // Restore original working directory
        process.chdir(originalCwd);
    });

    describe('#chdir()', () => {
        it('should change to valid directory and return new path', () => {
            const tempDir = path.join(__dirname, '..', 'temp');
            const result = chdir(tempDir);

            expect(result).to.equal(tempDir);
            expect(process.cwd()).to.equal(tempDir);
        });

        it('should throw error for invalid directory', () => {
            const invalidDir = '/nonexistent/directory';

            expect(() => chdir(invalidDir)).to.throw();
        });

        it('should handle relative paths', () => {
            const tempDir = './temp';
            const result = chdir(tempDir);

            expect(result).to.include('temp');
            expect(process.cwd()).to.include('temp');
        });
    });
});
