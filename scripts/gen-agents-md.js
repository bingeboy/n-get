#!/usr/bin/env node
/**
 * @fileoverview Regenerate AGENTS.md from CapabilitiesService.toMarkdown().
 *
 * Run via `npm run build:docs` or as part of `npm run build`. Single source
 * of truth: edits go to CapabilitiesService.js, never to AGENTS.md directly.
 * The agentsMdFreshnessSpec test fails CI if AGENTS.md drifts from this output.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CapabilitiesService = require('../lib/services/CapabilitiesService');

const svc = new CapabilitiesService({
    logger: { info() {}, debug() {}, warn() {}, error() {} }
});

const target = path.join(__dirname, '..', 'AGENTS.md');
fs.writeFileSync(target, svc.toMarkdown(), 'utf8');

const stat = fs.statSync(target);
console.log(`AGENTS.md regenerated (${stat.size} bytes)`);
