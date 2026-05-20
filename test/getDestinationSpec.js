'use strict';
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const chdir = require('../lib/chdir.js');

describe('Destination handling', () => {
    let originalCwd;
    let tempDir;

    beforeEach(() => {
        originalCwd = process.cwd();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-dest-'));
    });

    afterEach(() => {
        process.chdir(originalCwd);
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('should handle valid destination directory', () => {
        const result = chdir(tempDir, true);
        expect(result).to.equal(tempDir);
        expect(process.cwd()).to.equal(tempDir);
    });
});
