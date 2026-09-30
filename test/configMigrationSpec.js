'use strict';
/**
 * @fileoverview Tests for renamed-key migration.
 *
 * Validation runs with stripUnknown, which is correct for keys removed because
 * they did nothing — a stale entry is dropped and nothing changes. It is wrong
 * for a key that was renamed while still enforcing something: dropping
 * `security.blockPrivateNetworks` silently would turn off a security control on
 * upgrade and say nothing about it.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const yaml = require('js-yaml');

const ConfigManager = require('../lib/config/ConfigManager');

describe('renamed config keys', () => {
    let tempDir;
    let configDir;
    let warnings;
    let logger;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-migrate-'));
        configDir = path.join(tempDir, 'config');
        fs.mkdirSync(configDir, {recursive: true});
        warnings = [];
        logger = {info() {}, debug() {}, error() {}, warn(message) { warnings.push(message); }};
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 50});
        } catch { /* Windows can hold brief locks */ }
    });

    /**
     * @param {object} doc - config document
     * @returns {ConfigManager}
     */
    function loadWith(doc) {
        fs.writeFileSync(path.join(configDir, 'default.yaml'), yaml.dump({version: '3.0.0', ...doc}));
        return new ConfigManager({environment: 'test', enableHotReload: false, configDir, logger});
    }

    describe('security.blockPrivateNetworks -> blockPrivateIpLiterals', () => {

        it('carries the old value forward rather than dropping it', () => {
            // The upgrade hazard: a dropped key means the control silently
            // reverts to its default, which is false.
            const config = loadWith({security: {blockPrivateNetworks: true}});
            expect(config.get('security.blockPrivateIpLiterals')).to.be.true;
        });

        it('warns once, naming both keys', () => {
            loadWith({security: {blockPrivateNetworks: true}});
            expect(warnings).to.have.length(1);
            expect(warnings[0]).to.include('security.blockPrivateNetworks');
            expect(warnings[0]).to.include('security.blockPrivateIpLiterals');
        });

        it('carries a false value forward too', () => {
            // An explicit false is a decision, not an absence.
            const config = loadWith({security: {blockPrivateNetworks: false}});
            expect(config.get('security.blockPrivateIpLiterals')).to.be.false;
            expect(warnings).to.have.length(1);
        });

        it('lets the new key win when both are set', () => {
            const config = loadWith({
                security: {blockPrivateNetworks: false, blockPrivateIpLiterals: true},
            });
            expect(config.get('security.blockPrivateIpLiterals')).to.be.true;
            expect(warnings[0]).to.include('Both are set');
        });

        it('says nothing when only the new key is used', () => {
            const config = loadWith({security: {blockPrivateIpLiterals: true}});
            expect(config.get('security.blockPrivateIpLiterals')).to.be.true;
            expect(warnings).to.deep.equal([]);
        });

        it('says nothing when neither is set', () => {
            loadWith({});
            expect(warnings).to.deep.equal([]);
        });

        it('leaves no trace of the old key in the resolved config', () => {
            const config = loadWith({security: {blockPrivateNetworks: true}});
            expect(config.get('security.blockPrivateNetworks')).to.equal(undefined);
        });
    });
});
