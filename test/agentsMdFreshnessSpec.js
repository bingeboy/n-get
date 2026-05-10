'use strict';
/**
 * @fileoverview Drift guard for AGENTS.md.
 *
 * AGENTS.md is auto-generated from CapabilitiesService.toMarkdown().
 * If they ever drift, regenerate with `npm run build:docs` and commit.
 */

const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('chai');

const CapabilitiesService = require('../lib/services/CapabilitiesService');

describe('AGENTS.md freshness', () => {

    it('matches CapabilitiesService.toMarkdown() byte-for-byte', () => {
        const target = path.join(__dirname, '..', 'AGENTS.md');
        const onDisk = fs.readFileSync(target, 'utf8');

        const svc = new CapabilitiesService({
            logger: { info() {}, debug() {}, warn() {}, error() {} }
        });
        const generated = svc.toMarkdown();

        expect(onDisk).to.equal(
            generated,
            'AGENTS.md is stale. Run `npm run build:docs` and commit the result.'
        );
    });
});
