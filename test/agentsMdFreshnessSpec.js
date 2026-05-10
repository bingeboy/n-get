'use strict';
/**
 * @fileoverview Drift guard for AGENTS.md.
 *
 * AGENTS.md is auto-generated from CapabilitiesService.toMarkdown().
 * If they ever drift, regenerate with `npm run build:docs` and commit.
 *
 * Line endings are normalized (CRLF → LF) before comparison so Windows
 * checkouts with autocrlf=true don't fail the drift guard for purely
 * cosmetic reasons. The contract is content, not bytes.
 */

const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('chai');

const CapabilitiesService = require('../lib/services/CapabilitiesService');

const normalize = s => s.replace(/\r\n/g, '\n');

describe('AGENTS.md freshness', () => {

    it('content matches CapabilitiesService.toMarkdown() (line-ending tolerant)', () => {
        const target = path.join(__dirname, '..', 'AGENTS.md');
        const onDisk = normalize(fs.readFileSync(target, 'utf8'));

        const svc = new CapabilitiesService({
            logger: { info() {}, debug() {}, warn() {}, error() {} }
        });
        const generated = normalize(svc.toMarkdown());

        expect(onDisk).to.equal(
            generated,
            'AGENTS.md is stale. Run `npm run build:docs` and commit the result.'
        );
    });
});
