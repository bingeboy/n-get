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
    if (hint) {console.error(`     ${hint}`);}
    console.error('');
    process.exit(1);
}

// 1. Must be on master or a release branch
const branch = run('git branch --show-current');
if (branch !== 'master' && !branch.startsWith('release/')) {
    fail(`Must release from master or a release/* branch (currently on "${branch}")`,
         'Run: git checkout -b release/x.y.z master');
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

console.log(`  ✓  prerelease checks passed (current: v${version})`);
