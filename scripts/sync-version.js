#!/usr/bin/env node
/**
 * Version sync — runs as part of the `version` npm lifecycle hook.
 * By the time this runs, package.json is already bumped by npm.
 * Updates version strings in site/index.html and README.md to match.
 */
'use strict';
const fs   = require('node:fs');
const path = require('node:path');

const { version } = require('../package.json');
const root = path.join(__dirname, '..');

const targets = [
    {
        file: path.join(root, 'site', 'index.html'),
        // Matches: <span>v1.2.3</span>  and  n-get v1.2.3 ·
        pattern: /v\d+\.\d+\.\d+/g,
    },
    {
        file: path.join(root, 'README.md'),
        // Only replace explicit version badges/lines, not URLs or code examples
        pattern: /(?<=n-get\s+)v\d+\.\d+\.\d+|(?<=version[:\s]+)v?\d+\.\d+\.\d+/gi,
    },
];

for (const { file, pattern } of targets) {
    if (!fs.existsSync(file)) continue;
    const original = fs.readFileSync(file, 'utf8');
    const updated  = original.replace(pattern, (match) => {
        // Preserve leading 'v' or lack thereof
        return match.startsWith('v') ? `v${version}` : version;
    });
    if (updated !== original) {
        fs.writeFileSync(file, updated, 'utf8');
        console.log(`  ✓  synced version in ${path.relative(root, file)}`);
    }
}
