'use strict';
/**
 * @fileoverview Tests for the `nget instructions` subcommand.
 *
 * Confirms the CLI prints AGENTS.md byte-for-byte to stdout and exits 0.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { expect } = require('chai');

const projectRoot = path.join(__dirname, '..');
const cli = path.join(projectRoot, 'index.js');
const agentsMd = path.join(projectRoot, 'AGENTS.md');

describe('nget instructions subcommand', () => {

    it('prints AGENTS.md content to stdout and exits 0', () => {
        const onDisk = fs.readFileSync(agentsMd, 'utf8');
        const stdout = execFileSync(process.execPath, [cli, 'instructions'], {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
        expect(stdout).to.equal(onDisk);
    });

    it('output starts with the n-get Markdown header', () => {
        const stdout = execFileSync(process.execPath, [cli, 'instructions'], {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
        expect(stdout).to.match(/^# n-get/);
    });
});
