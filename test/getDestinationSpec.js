'use strict';
/**
 * @fileoverview Tests for lib/getDestination.js
 *
 * getDestination() resolves the download destination and, for a real path,
 * changes the process working directory as a side effect. Every test here
 * restores the original cwd in afterEach — leaking a cwd change would
 * corrupt every spec that runs afterwards, since Vitest shares a process
 * per worker.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const getDestination = require('../lib/getDestination.js');

describe('getDestination', () => {

    let originalCwd;
    let tempDir;

    beforeEach(() => {
        originalCwd = process.cwd();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-dest-'));
    });

    afterEach(() => {
        process.chdir(originalCwd);
        try {
            fs.rmSync(tempDir, {recursive: true, force: true});
        } catch {
            // best effort
        }
    });

    describe('falsy and sentinel values resolve to the current directory', () => {

        // The implementation special-cases these rather than treating them as
        // paths. './' and ' ' are explicit sentinels, not incidental.
        for (const [label, value] of [
            ['undefined', undefined],
            ['null', null],
            ['empty string', ''],
            ['"./"', './'],
            ['single space', ' '],
        ]) {
            it(`${label} returns process.cwd() without changing directory`, () => {
                const before = process.cwd();
                expect(getDestination(value)).to.equal(before);
                expect(process.cwd(), 'cwd must not change').to.equal(before);
            });
        }
    });

    describe('a real directory', () => {

        it('changes into it and returns its resolved path', () => {
            const result = getDestination(tempDir);
            // Compare realpath: macOS reports /var as /private/var, and Windows
            // may differ in short-name form, so string equality on the input
            // would be flaky across platforms.
            expect(result).to.equal(fs.realpathSync(tempDir));
            expect(process.cwd()).to.equal(fs.realpathSync(tempDir));
        });

        it('is idempotent when called twice with the same directory', () => {
            const first = getDestination(tempDir);
            const second = getDestination(tempDir);
            expect(second).to.equal(first);
        });

        it('resolves a relative path against the current directory', () => {
            const child = path.join(tempDir, 'nested');
            fs.mkdirSync(child);

            process.chdir(tempDir);
            const result = getDestination('nested');

            expect(result).to.equal(fs.realpathSync(child));
        });
    });

    describe('a missing directory', () => {

        it('throws rather than silently falling back to cwd', () => {
            const missing = path.join(tempDir, 'does-not-exist');
            let threw = false;
            try {
                getDestination(missing);
            } catch {
                threw = true;
            }
            // Silently downloading into the wrong directory would be worse than
            // failing, so the throw is the contract.
            expect(threw, 'expected getDestination to throw for a missing path').to.be.true;
        });

        it('leaves the working directory untouched when it throws', () => {
            const before = process.cwd();
            try {
                getDestination(path.join(tempDir, 'nope'));
            } catch {
                // expected
            }
            expect(process.cwd()).to.equal(before);
        });
    });
});
