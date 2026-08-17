'use strict';
/**
 * @fileoverview Tests for config directory resolution and user overrides.
 *
 * The original bug: ConfigManager picked EITHER the packaged config directory
 * OR the user's ./config, and since the packaged one ships in files[] it always
 * won — so nothing a user wrote ever took effect.
 *
 * It survived because developing *in* this repo makes cwd the package root, so
 * both paths are identical and everything appears to work. These tests
 * therefore use explicit, distinct temp directories rather than the repo's own
 * config, which is the only way to observe the difference.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');

const ConfigManager = require('../lib/config/ConfigManager.js');

const silentLogger = {info() {}, debug() {}, warn() {}, error() {}};

function writeYaml(dir, filename, obj) {
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, filename), yaml.dump(obj));
}

describe('config resolution', () => {

    let packagedDir;
    let userDir;
    let roots;

    beforeEach(() => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-cfgres-'));
        roots = [root];
        packagedDir = path.join(root, 'packaged');
        userDir = path.join(root, 'user');

        // A minimal but schema-valid baseline standing in for the shipped
        // config. `version` is required by the Joi schema.
        writeYaml(packagedDir, 'default.yaml', {
            version: '1.0.0',
            http: {timeout: 30000, maxRetries: 3},
            security: {blockLocalhost: false, blockPrivateNetworks: false},
        });
    });

    afterEach(() => {
        for (const r of roots) {
            try { fs.rmSync(r, {recursive: true, force: true}); } catch { /* best effort */ }
        }
    });

    function build(extra = {}) {
        return new ConfigManager({
            configDir: packagedDir,
            userConfigDir: userDir,
            environment: 'development',
            enableHotReload: false,
            logger: silentLogger,
            ...extra,
        });
    }

    it('uses packaged defaults when the user directory has no files', () => {
        const cm = build();
        expect(cm.get('http.timeout')).to.equal(30000);
    });

    it('a user local.yaml overrides the packaged default', () => {
        writeYaml(userDir, 'local.yaml', {http: {timeout: 22222}});
        const cm = build();
        // This is the whole bug: before the fix this stayed at 30000.
        expect(cm.get('http.timeout')).to.equal(22222);
    });

    it('a user override can enable a security policy the package ships disabled', () => {
        writeYaml(userDir, 'local.yaml', {security: {blockLocalhost: true, blockPrivateNetworks: true}});
        const cm = build();
        expect(cm.get('security.blockLocalhost'), 'blockLocalhost').to.equal(true);
        expect(cm.get('security.blockPrivateNetworks'), 'blockPrivateNetworks').to.equal(true);
    });

    it('leaves untouched keys at their packaged values (merge, not replace)', () => {
        writeYaml(userDir, 'local.yaml', {http: {timeout: 22222}});
        const cm = build();
        expect(cm.get('http.maxRetries'), 'maxRetries should survive').to.equal(3);
    });

    it('applies user default.yaml, then environment file, then local.yaml in that order', () => {
        writeYaml(userDir, 'default.yaml', {http: {timeout: 11000}});
        writeYaml(userDir, 'development.yaml', {http: {timeout: 12000}});
        writeYaml(userDir, 'local.yaml', {http: {timeout: 13000}});
        expect(build().get('http.timeout')).to.equal(13000);
    });

    it('user environment file beats user default.yaml', () => {
        writeYaml(userDir, 'default.yaml', {http: {timeout: 11000}});
        writeYaml(userDir, 'development.yaml', {http: {timeout: 12000}});
        expect(build().get('http.timeout')).to.equal(12000);
    });

    it('does not load the same directory twice when user and packaged coincide', () => {
        // Running from inside the repo: both paths are the same directory. The
        // config must still load, and must not be applied twice.
        const cm = build({userConfigDir: packagedDir});
        expect(cm.get('http.timeout')).to.equal(30000);
    });

    it('an explicit configDir is used exactly — ./config is not silently layered on', () => {
        // Embedders (and tests) that name a directory mean that directory. If
        // cwd/config were layered on regardless, a fixture would be polluted by
        // whatever happened to sit beside the process.
        writeYaml(userDir, 'local.yaml', {http: {timeout: 22222}});
        const cm = new ConfigManager({
            configDir: packagedDir,          // explicit, no userConfigDir
            environment: 'development',
            enableHotReload: false,
            logger: silentLogger,
        });
        expect(cm.get('http.timeout')).to.equal(30000);
    });

    it('defaults the user directory to ./config relative to cwd', () => {
        // Exercises the real production path: no configDir at all, so the
        // packaged directory is resolved internally and cwd/config layers over
        // it. This is what an installed user actually gets.
        const cwdRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-cfgcwd-'));
        roots.push(cwdRoot);
        writeYaml(path.join(cwdRoot, 'config'), 'local.yaml', {http: {timeout: 24000}});

        const originalCwd = process.cwd();
        try {
            process.chdir(cwdRoot);
            const cm = new ConfigManager({
                environment: 'development',
                enableHotReload: false,
                logger: silentLogger,
            });
            // Repo's shipped default is 30000; the user file must win.
            expect(cm.get('http.timeout')).to.equal(24000);
        } finally {
            process.chdir(originalCwd);
        }
    });
});
