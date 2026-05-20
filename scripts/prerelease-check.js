#!/usr/bin/env node
/**
 * Pre-release guard — runs as the `preversion` npm lifecycle hook.
 * Fails fast with clear messages before npm touches anything.
 *
 * Recovery if a release gets stuck mid-way:
 *   git checkout package.json     # revert accidental version bump
 *   git tag -d v<version>         # remove stale local tag if created
 */
'use strict';
const { execSync } = require('node:child_process');
const { version }  = require('../package.json');

function run(cmd) {
    return execSync(cmd, { encoding: 'utf8' }).trim();
}

function fail(msg, hint) {
    console.error(`\n  ✖  ${msg}`);
    if (hint) console.error(`     ${hint}`);
    console.error('');
    process.exit(1);
}

// 1. Must be on master
const branch = run('git branch --show-current');
if (branch !== 'master') {
    fail(`Must release from master (currently on "${branch}")`,
         'Run: git checkout master');
}

// 2. Working tree must be clean
try {
    run('git diff --quiet');
    run('git diff --cached --quiet');
} catch {
    fail('Working tree has uncommitted changes',
         'Commit or stash your changes first');
}

// 3. Must be in sync with origin/master
try {
    run('git fetch origin');
    run('git diff --quiet HEAD origin/master');
} catch {
    fail('Local master is out of sync with origin/master',
         'Run: git pull origin master');
}

// 4. Current version tag must not already exist locally
try {
    run(`git rev-parse --verify refs/tags/v${version}`);
    // If we get here, the tag exists — that's bad
    fail(`Tag v${version} already exists locally`,
         `Run: git tag -d v${version}  (then re-run npm version)`);
} catch (e) {
    // rev-parse throws when tag doesn't exist — that's what we want
    if (e.status === 0) process.exit(1); // re-throw the fail() above
}

console.log(`  ✓  prerelease checks passed (current: v${version})`);
