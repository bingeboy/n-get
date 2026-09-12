'use strict';
/**
 * @fileoverview Regression tests for the ssh and webhooks config sections (#175).
 *
 * Both sections shipped in config/default.yaml but were absent from the Joi
 * schema. Validation runs with stripUnknown, so both were deleted at load and
 * every consumer received undefined behind a `??` fallback — silently, with no
 * warning. Configuring webhooks or SSH through a config file had no effect.
 *
 * @see docs/CONFIG-CONTRACT.md
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const yaml = require('js-yaml');

const ConfigManager = require('../lib/config/ConfigManager');
const {DownloadSession} = require('../lib/core/DownloadSession');

describe('ssh and webhooks configuration sections (#175)', () => {
    let tempDir;
    let configDir;
    let originalEnv;

    beforeEach(() => {
        originalEnv = {...process.env};
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-sections-'));
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

    /**
     * Write a config file and load it.
     * @param {object} doc - config document to serialise
     * @returns {ConfigManager}
     */
    function loadWith(doc) {
        fs.writeFileSync(path.join(configDir, 'default.yaml'), yaml.dump({version: '3.0.0', ...doc}));
        return new ConfigManager({environment: 'test', enableHotReload: false, configDir});
    }

    describe('sections survive validation', () => {

        it('keeps the ssh section instead of stripping it', () => {
            const config = loadWith({ssh: {timeout: 45000}});
            expect(config.getConfig()).to.have.property('ssh');
        });

        it('keeps the webhooks section instead of stripping it', () => {
            const config = loadWith({webhooks: {secret: 's'}});
            expect(config.getConfig()).to.have.property('webhooks');
        });
    });

    describe('webhook values reach consumers', () => {

        it('resolves every path DownloadSession reads', () => {
            // These four are read at DownloadSession.ts:96-98 and :197. Each
            // returned undefined before the schema declared the section.
            const config = loadWith({
                webhooks: {
                    default: ['https://receiver.example.com/hook'],
                    secret: 'global-hmac-secret',
                    retry: {maxAttempts: 5, backoffMs: [0, 100, 200, 400, 800]},
                },
            });

            expect(config.get('webhooks.default')).to.deep.equal(['https://receiver.example.com/hook']);
            expect(config.get('webhooks.secret')).to.equal('global-hmac-secret');
            expect(config.get('webhooks.retry.maxAttempts')).to.equal(5);
            expect(config.get('webhooks.retry.backoffMs')).to.deep.equal([0, 100, 200, 400, 800]);
        });

        it('accepts the object entry form with per-url overrides', () => {
            const config = loadWith({
                webhooks: {
                    default: [{
                        url: 'https://other.example.com/hook',
                        secret: 'per-url-secret',
                        headers: {'X-Source': 'nget'},
                        events: ['download_complete'],
                    }],
                },
            });

            const [entry] = config.get('webhooks.default');
            expect(entry.url).to.equal('https://other.example.com/hook');
            expect(entry.secret).to.equal('per-url-secret');
            expect(entry.headers).to.deep.equal({'X-Source': 'nget'});
            expect(entry.events).to.deep.equal(['download_complete']);
        });

        it('accepts string and object entries in the same list', () => {
            const config = loadWith({
                webhooks: {
                    default: ['https://a.example.com/h', {url: 'https://b.example.com/h'}],
                },
            });
            expect(config.get('webhooks.default')).to.have.length(2);
        });

        it('rejects a malformed webhook url', () => {
            expect(() => loadWith({webhooks: {default: ['not-a-url']}})).to.throw();
        });

        it('rejects an entry object with no url', () => {
            expect(() => loadWith({webhooks: {default: [{secret: 'x'}]}})).to.throw();
        });

        it('defaults to no webhooks and no secret', () => {
            const config = loadWith({});
            expect(config.get('webhooks.default')).to.deep.equal([]);
            expect(config.get('webhooks.secret')).to.equal('');
            expect(config.get('webhooks.retry.maxAttempts')).to.equal(3);
        });
    });

    describe('ssh values reach sftpManager', () => {

        it('resolves the whole section, which is how sftpManager reads it', () => {
            // sftpManager.createConnectionConfig does configManager.get('ssh', {})
            // and falls back to hard-coded algorithms when the result is empty.
            const config = loadWith({
                ssh: {timeout: 45000, algorithms: {cipher: ['aes256-gcm']}},
            });

            const ssh = config.get('ssh');
            expect(ssh).to.be.an('object');
            expect(ssh.timeout).to.equal(45000);
            expect(ssh.algorithms.cipher).to.deep.equal(['aes256-gcm']);
        });

        it('resolves individual algorithm lists', () => {
            const config = loadWith({});
            expect(config.get('ssh.timeout')).to.equal(30000);
            expect(config.get('ssh.algorithms.kex')).to.include('ecdh-sha2-nistp256');
            expect(config.get('ssh.algorithms.serverHostKey')).to.include('rsa-sha2-512');
            expect(config.get('ssh.algorithms.hmac')).to.include('hmac-sha2-256');
        });

        it('rejects a timeout below the minimum', () => {
            expect(() => loadWith({ssh: {timeout: 10}})).to.throw();
        });
    });

    describe('config webhooks reach the event sink', () => {

        it('registers config-file webhooks on a real DownloadSession', () => {
            // The end-to-end assertion. Resolving the keys is necessary but not
            // sufficient — this is the wiring that was broken.
            const config = loadWith({
                webhooks: {
                    default: [
                        'https://receiver.example.com/hook',
                        {url: 'https://other.example.com/hook', secret: 'per-url-secret'},
                    ],
                    retry: {maxAttempts: 5, backoffMs: [0, 100, 200, 400, 800]},
                },
            });

            const session = new DownloadSession({configManager: config, pipeMode: true});
            const sink = session.emitter;

            expect(sink._webhooks.map(w => w.url)).to.deep.equal([
                'https://receiver.example.com/hook',
                'https://other.example.com/hook',
            ]);
            // The string form carries no secret; the object form keeps its own.
            expect(sink._webhooks[0].webhookSecret).to.equal(undefined);
            expect(sink._webhooks[1].webhookSecret).to.equal('per-url-secret');
            expect(sink._maxAttempts).to.equal(5);
            expect(sink._backoffMs).to.deep.equal([0, 100, 200, 400, 800]);
        });

        it('registers nothing when no webhooks are configured', () => {
            const session = new DownloadSession({configManager: loadWith({}), pipeMode: true});
            expect(session.emitter._webhooks).to.deep.equal([]);
        });
    });

    describe('the shipped default.yaml validates', () => {

        it('loads every section it declares, none stripped', () => {
            // The packaged config is the one users actually get; it silently
            // lost two whole sections before this fix.
            const config = new ConfigManager({environment: 'test', enableHotReload: false});
            const shipped = yaml.load(
                fs.readFileSync(path.join(__dirname, '..', 'config', 'default.yaml'), 'utf8'),
            );
            const resolved = config.getConfig();

            for (const section of Object.keys(shipped)) {
                expect(resolved, `section "${section}" was stripped at load`).to.have.property(section);
            }
        });
    });
});
