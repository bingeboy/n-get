'use strict';
/**
 * @fileoverview Ratchet holding the `any` count down (#151).
 *
 * `strict: true` is on, so the type-checking half of the migration is done.
 * What remains is 124 explicit `any` annotations — a separate axis, since an
 * `any` type-checks fine and simply opts out.
 *
 * `@typescript-eslint/no-explicit-any` cannot be raised to error while they
 * exist, and flipping it later requires clearing all of them at once. This
 * asserts the count instead: it may fall, never rise. Lower the ceiling as you
 * remove them, and when it reaches zero the rule becomes an error and this
 * spec can go.
 *
 * @see docs/CONFIG-CONTRACT.md for the same pattern applied to config keys
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');

/**
 * Highest number of explicit `any` annotations allowed in TypeScript sources.
 *
 * Only ever edit this downwards. Raising it to make a build pass means new
 * `any` was introduced, which is the thing being prevented.
 */
const ANY_CEILING = 124;

/** Per-file ceilings, so a reduction in one file cannot mask growth in another. */
const PER_FILE_CEILING = {
    'lib/recursiveDownloader.ts': 37,
    'lib/mcp/server.ts': 21,
    'lib/cli/configCommands.ts': 20,
    'lib/sftpManager.ts': 13,
    'lib/cli/historyCommands.ts': 9,
    'lib/resumeManager.ts': 9,
    'lib/recursiveCrawler.ts': 8,
    'lib/services/SecurityService.ts': 3,
    'lib/downloader.ts': 2,
    'lib/ui.ts': 2,
};

/**
 * Count `no-explicit-any` reports per source file.
 *
 * Runs eslint rather than grepping: a comment or a string containing the word
 * would inflate a textual count, and the rule is what actually governs.
 *
 * @returns {{total: number, perFile: Record<string, number>}}
 */
function countAny() {
    let raw;
    try {
        // Lint the project rather than passing a glob. `shell: true` is needed
        // for npx on Windows, and a shell that expands globs gives a different
        // file set per platform — bash without globstar matches only one
        // directory level, so CI scanned fewer files than a local run and
        // reported live entries as stale. `.` is unambiguous everywhere, and
        // eslint.config.js already excludes compiled output.
        raw = execFileSync(
            'npx',
            ['eslint', '.', '-f', 'json'],
            {cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000, shell: true, maxBuffer: 32 * 1024 * 1024},
        );
    } catch (error) {
        // eslint exits non-zero when it reports problems; the JSON is still on stdout.
        raw = error.stdout?.toString() ?? '';
    }

    const results = JSON.parse(raw);
    const perFile = {};
    let total = 0;

    for (const file of results) {
        const relative = path.relative(REPO_ROOT, file.filePath).split(path.sep).join('/');
        if (!relative.endsWith('.ts') || relative.endsWith('.d.ts')) { continue; }

        for (const message of file.messages) {
            if (message.ruleId !== '@typescript-eslint/no-explicit-any') { continue; }
            perFile[relative] = (perFile[relative] || 0) + 1;
            total++;
        }
    }

    return {total, perFile};
}

describe('explicit any ratchet (#151)', () => {
    let counts;

    // Second argument is the hook timeout: eslint over the whole source tree
    // takes longer than the default.
    before(() => {
        counts = countAny();
    }, 150000);

    it('does not exceed the recorded ceiling', () => {
        expect(counts.total, [
            '',
            `Explicit \`any\` count is ${counts.total}, ceiling is ${ANY_CEILING}.`,
            '',
            'New `any` annotations were added. An `any` type-checks fine and opts',
            'out of the guarantees strict mode provides, so the count is held down',
            'deliberately rather than left to drift.',
            '',
            'Give the value a real type. Do not raise ANY_CEILING.',
            '',
        ].join('\n')).to.be.at.most(ANY_CEILING);
    });

    it('does not exceed any per-file ceiling', () => {
        const over = Object.entries(counts.perFile)
            .filter(([file, n]) => n > (PER_FILE_CEILING[file] ?? 0))
            .map(([file, n]) => `${file}: ${n} > ${PER_FILE_CEILING[file] ?? 0}`);

        expect(over, [
            '',
            'These files gained `any` annotations:',
            ...over.map(line => `    ${line}`),
            '',
            'Per-file ceilings exist so a cleanup in one file cannot hide growth',
            'in another. Give the value a real type rather than raising a ceiling.',
            '',
        ].join('\n')).to.deep.equal([]);
    });

    it('has no stale per-file entries', () => {
        // A file cleared to zero, or renamed, should leave the list.
        const stale = Object.keys(PER_FILE_CEILING).filter(file => !(file in counts.perFile));

        expect(stale, [
            '',
            'These files no longer contain any `any` annotations (or no longer exist):',
            ...stale.map(file => `    ${file}`),
            '',
            'Remove them from PER_FILE_CEILING — the ratchet only turns one way.',
            '',
        ].join('\n')).to.deep.equal([]);
    });

    it('detects the annotations at all', () => {
        // Guards against the scan silently returning nothing, which would make
        // every assertion above pass vacuously.
        expect(counts.total).to.be.greaterThan(0);
        expect(Object.keys(counts.perFile).length).to.be.greaterThan(0);
    });
});
