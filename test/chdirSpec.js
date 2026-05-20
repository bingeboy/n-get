'use strict';
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const chdir = require('../lib/chdir');

describe('Chdir Module', () => {
    let originalCwd;
    let tempDir;

    beforeEach(() => {
        originalCwd = process.cwd();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-chdir-'));
    });

    afterEach(() => {
        process.chdir(originalCwd);
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    describe('#chdir()', () => {
        it('should change to valid directory and return new path', () => {
            const result = chdir(tempDir, true);
            expect(result).to.equal(tempDir);
            expect(process.cwd()).to.equal(tempDir);
        });

        it('should throw error for invalid directory', () => {
            expect(() => chdir('/nonexistent/directory/xyz', true)).to.throw();
        });

        it('should handle relative paths', () => {
            process.chdir(tempDir);
            const subDir = fs.mkdtempSync(path.join(tempDir, 'sub-'));
            const rel = path.relative(process.cwd(), subDir);
            const result = chdir(rel, true);
            expect(result).to.include('sub-');
            expect(process.cwd()).to.include('sub-');
        });
    });
});
