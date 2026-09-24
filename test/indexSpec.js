
const {execSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs').promises;
const os = require('node:os');

// Local fixture server (test/fixtures/), started by globalSetup. Replaces
// httpbin.org so the suite does not fail when a third-party host is down.
const ORIGIN = require('./fixtures/origin').readOrigin();


/**
 * Extract the NDJSON event stream from CLI output.
 *
 * Default (non-TTY) output interleaves human status lines with the event
 * stream, so events are picked out by parseability rather than position.
 * These tests previously asserted on the human "Download Summary" block,
 * which is only produced in --human/text mode (#146).
 *
 * @param {string} output - raw stdout
 * @returns {object[]} parsed events, in order
 */
function events(output) {
    return output
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('{') && line.includes('"event"'))
        .map(line => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean);
}

/** Count events of a given type. */
function countEvents(output, type) {
    return events(output).filter(e => e.event === type).length;
}
// Returns a boolean rather than throwing, so callers can branch without
// wrapping expect.fail() in a try — an AssertionError thrown inside a try is
// caught by that try's own catch, which inverts the reported diagnosis.
async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

describe('Main CLI Application', () => {
    // An OS temp directory, not test/cli-test/ inside the repo. Downloads used
    // to land in the working tree, and the teardown below could not remove them:
    // it unlinked each entry individually, which throws on the .nget/
    // subdirectory the download path creates, and the swallowed error left
    // rmdir facing a non-empty directory. Successive runs accumulated files that
    // eventually got committed (#146).
    let testDir;

    before(async() => {
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nget-cli-'));
    });

    after(async() => {
        // Recursive, so the .nget/ metadata directory goes too.
        await fs.rm(testDir, {recursive: true, force: true});
    });

    describe('CLI argument parsing', () => {
        it('should show error message when no arguments provided', function() {

            try {
                execSync('node index.js', {cwd: path.join(__dirname, '..')});
                expect.fail('Should have exited with error');
            } catch (error) {
                expect(error.stderr.toString()).to.include('Error: No URLs provided');
                expect(error.stderr.toString()).to.include('nget --help');
            }
        });

        it('should handle single URL download', function() {

            const output = execSync(`node index.js ${ORIGIN}/json -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            expect(countEvents(output, 'download_complete')).to.equal(1);
            expect(countEvents(output, 'download_error')).to.equal(0);
        });

        it('should handle multiple URL downloads', function() {

            const output = execSync(`node index.js ${ORIGIN}/json ${ORIGIN}/uuid -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            expect(countEvents(output, 'download_complete')).to.equal(2);
            expect(countEvents(output, 'download_error')).to.equal(0);
        });

        it('should handle invalid destination gracefully', function() {

            try {
                execSync(`node index.js ${ORIGIN}/json -d /nonexistent/path`, {
                    cwd: path.join(__dirname, '..'),
                    encoding: 'utf8',
                });
                expect.fail('Should have exited with error');
            } catch (error) {
                const output = error.stderr ? error.stderr.toString() : error.stdout.toString();
                expect(output).to.include('Invalid destination path');
            }
        });
    });

    describe('Error handling', () => {
        it('should handle network errors gracefully', function() {

            try {
                execSync('node index.js https://invalid-domain-that-should-not-exist.com/file.txt', {
                    cwd: path.join(__dirname, '..'),
                    encoding: 'utf8',
                });
                expect.fail('Should have thrown an error');
            } catch (error) {
                // Should exit with non-zero code and show error summary
                expect(error.status).to.equal(1);
                expect(countEvents(error.stdout.toString(), 'download_error')).to.equal(1);
            }
        });

        it('should handle mixed valid and invalid URLs', function() {

            const output = execSync(`node index.js ${ORIGIN}/json https://invalid-domain.com/file.txt -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            expect(countEvents(output, 'download_complete')).to.equal(1);
            expect(countEvents(output, 'download_error')).to.equal(1);
        });
    });

    describe('Output filename (-o flag)', () => {
        it('should use custom filename when -o parameter is specified', async function() {

            const customFilename = 'test-custom-uuid.json';
            const customFilePath = path.join(testDir, customFilename);

            const output = execSync(`node index.js ${ORIGIN}/uuid -o ${customFilename} -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            expect(countEvents(output, 'download_complete')).to.equal(1);

            // Check that file exists with custom name
            if (!await exists(customFilePath)) {
                // Check if file was created with URL-extracted name instead (bug behavior)
                if (await exists(path.join(testDir, 'uuid'))) {
                    expect.fail(`Bug reproduced: File was created as 'uuid' instead of '${customFilename}'. The -o parameter was ignored.`);
                } else {
                    expect.fail(`Neither custom filename '${customFilename}' nor URL-extracted filename 'uuid' was found.`);
                }
            }
        });

        it('should use custom filename with different extension when -o parameter is specified', async function() {

            const customFilename = 'my-data.txt';
            const customFilePath = path.join(testDir, customFilename);

            const output = execSync(`node index.js ${ORIGIN}/json -o ${customFilename} -d ${testDir}`, {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            });

            expect(countEvents(output, 'download_complete')).to.equal(1);

            // Check that file exists with custom name
            if (!await exists(customFilePath)) {
                // Check if file was created with URL-extracted name instead (bug behavior)
                if (await exists(path.join(testDir, 'json'))) {
                    expect.fail(`Bug reproduced: File was created as 'json' instead of '${customFilename}'. The -o parameter was ignored.`);
                } else {
                    expect.fail(`Neither custom filename '${customFilename}' nor URL-extracted filename 'json' was found.`);
                }
            }
        });
    });
});
