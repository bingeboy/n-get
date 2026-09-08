'use strict';
/**
 * @fileoverview Regression tests for the removal of security.certificateValidation
 * (issue #164).
 *
 * The key was documented in config/default.yaml, accepted by the Joi schema,
 * exposed through the dotted-path alias map, and defaulted to true -- but it was
 * read in exactly one place: getSecurityLevel(), which turns it into a cosmetic
 * 'high' / 'medium' / 'low' label. It never reached the download path. Setting it
 * to false changed a string and nothing else; TLS verification stayed on.
 *
 * Rather than wire it up -- which would mean shipping a supported way to disable
 * certificate verification in a tool agents drive unattended -- the key is gone.
 * Node's fetch validates certificates unconditionally, and NODE_TLS_REJECT_UNAUTHORIZED
 * remains the standard, loud escape hatch for the self-signed-dev-host case.
 *
 * Contracts covered here:
 * - the key is no longer part of the config schema
 * - an existing config that still sets it is silently stripped, not rejected,
 *   so upgrading does not hard-fail a user's config file
 * - dropping the term from getSecurityLevel() left every level unchanged
 * - the shipped config files no longer advertise the key
 * - the honest capability claim ("this tool validates certificates") survives
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const yaml = require('js-yaml');

const ConfigManager = require('../lib/config/ConfigManager');
const CapabilitiesService = require('../lib/services/CapabilitiesService');

const REPO_ROOT = path.join(__dirname, '..');

describe('security.certificateValidation removal (#164)', () => {
    let tempDir;
    let configDir;
    let originalEnv;

    beforeEach(() => {
        originalEnv = {...process.env};
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-certval-'));
        configDir = path.join(tempDir, 'config');
        fs.mkdirSync(configDir, {recursive: true});
        for (const key of Object.keys(process.env)) {
            if (key.startsWith('NGET_')) { delete process.env[key]; }
        }
    });

    afterEach(() => {
        process.env = originalEnv;
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    /** Write a default.yaml and load it. */
    function loadWith(securitySection) {
        fs.writeFileSync(
            path.join(configDir, 'default.yaml'),
            yaml.dump({version: '3.0.0', security: securitySection}),
        );
        return new ConfigManager({environment: 'test', enableHotReload: false, configDir});
    }

    describe('the key is gone from the schema', () => {

        it('does not resolve security.certificateValidation to a value', () => {
            const config = loadWith({blockLocalhost: true});
            expect(config.get('security.certificateValidation')).to.equal(undefined);
        });

        it('does not reintroduce the key as a schema default', () => {
            const config = loadWith({blockLocalhost: true});
            expect(config.getConfig().security).to.not.have.property('certificateValidation');
        });
    });

    describe('upgrade path for configs that still set it', () => {

        it('strips the key instead of rejecting the whole config', () => {
            // The whole point: a 2.x config file must still load on 3.x.
            const config = loadWith({
                blockLocalhost: true,
                blockPrivateNetworks: true,
                certificateValidation: false,
            });

            // Config loaded, other keys intact...
            expect(config.get('security.blockLocalhost')).to.be.true;
            expect(config.get('security.blockPrivateNetworks')).to.be.true;
            // ...and the removed key simply is not there.
            expect(config.get('security.certificateValidation')).to.equal(undefined);
        });

        it('does not let a stale certificateValidation:false weaken anything', () => {
            // Under the old code this config reported 'low'. The key was a lie:
            // certificates were validated regardless, so 'low' was the wrong label.
            const config = loadWith({
                blockLocalhost: true,
                blockPrivateNetworks: true,
                certificateValidation: false,
                rateLimiting: {enabled: true},
            });

            const summary = config.getAIConfigSummary();
            expect(summary.keySettings.securityLevel).to.equal('high');
        });
    });

    describe('getSecurityLevel() still grades correctly without the term', () => {

        function levelFor(securitySection) {
            return loadWith(securitySection).getAIConfigSummary().keySettings.securityLevel;
        }

        it('reports high when private networks, localhost and rate limiting are all locked down', () => {
            expect(levelFor({
                blockPrivateNetworks: true,
                blockLocalhost: true,
                rateLimiting: {enabled: true},
            })).to.equal('high');
        });

        it('reports medium when only rate limiting is on', () => {
            expect(levelFor({
                blockPrivateNetworks: false,
                blockLocalhost: false,
                rateLimiting: {enabled: true},
            })).to.equal('medium');
        });

        it('reports low when rate limiting is off', () => {
            expect(levelFor({
                blockPrivateNetworks: true,
                blockLocalhost: true,
                rateLimiting: {enabled: false},
            })).to.equal('low');
        });
    });

    describe('shipped config files no longer advertise the key', () => {

        for (const file of ['config/default.yaml', 'config/production.yaml']) {
            it(`${file} does not mention certificateValidation`, () => {
                const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
                expect(text).to.not.match(/certificateValidation/);
            });
        }

        it('the secure profile still exists after losing the key', () => {
            const parsed = yaml.load(fs.readFileSync(path.join(REPO_ROOT, 'config/default.yaml'), 'utf8'));
            expect(parsed.ai.profiles.definitions ?? parsed.profiles).to.be.an('object');
        });
    });

    describe('the honest capability claim survives', () => {

        it('still reports that HTTPS certificates are validated', () => {
            // Removing the inert *config key* must not remove the accurate
            // *statement of fact* -- Node validates certificates, and agents
            // reading --capabilities are entitled to know it.
            const caps = new CapabilitiesService().getCapabilities();
            expect(caps.protocols.https.certificateValidation).to.be.true;
            expect(caps.authentication.https.certificateValidation).to.be.true;
        });
    });
});
