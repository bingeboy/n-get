'use strict';
/**
 * @fileoverview Tests for the two config keys that were wired rather than
 * removed in #180.
 *
 * Seventeen keys validated, defaulted and appeared in `nget config show` while
 * reaching no code. Fifteen were removed. Two were different: the feature
 * existed and only the wire to it was missing, which makes them bugs rather
 * than clutter.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const yaml = require('js-yaml');

const ConfigManager = require('../lib/config/ConfigManager');
const Logger = require('../lib/services/Logger');

describe('config keys wired in #180', () => {
    let tempDir;
    let configDir;
    let originalEnv;

    beforeEach(() => {
        originalEnv = {...process.env};
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-wired-'));
        configDir = path.join(tempDir, 'config');
        fs.mkdirSync(configDir, {recursive: true});
        for (const key of Object.keys(process.env)) {
            if (key.startsWith('NGET_')) { delete process.env[key]; }
        }
    });

    afterEach(() => {
        process.env = originalEnv;
        try {
            fs.rmSync(tempDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 50});
        } catch { /* Windows can hold brief locks */ }
    });

    /**
     * Write a config file and load it.
     * @param {object} doc
     * @returns {ConfigManager}
     */
    function loadWith(doc) {
        fs.writeFileSync(path.join(configDir, 'default.yaml'), yaml.dump({version: '3.0.0', ...doc}));
        return new ConfigManager({environment: 'test', enableHotReload: false, configDir});
    }

    describe('development.hotReload', () => {

        it('resolves from configuration', () => {
            expect(loadWith({development: {hotReload: false}}).get('development.hotReload')).to.be.false;
            expect(loadWith({development: {hotReload: true}}).get('development.hotReload')).to.be.true;
        });

        it('defaults to true', () => {
            expect(loadWith({}).get('development.hotReload')).to.be.true;
        });

        it('is read during initialization', () => {
            // The watcher path itself cannot be exercised here: setupHotReload
            // is additionally gated on NODE_ENV !== 'test', so no watcher ever
            // starts under vitest and an assertion on watcher count would pass
            // whether or not this key were wired. What is testable is that the
            // key resolves and reaches the gate — the source is checked below.
            const config = loadWith({development: {hotReload: false}});
            expect(config.get('development.hotReload')).to.be.false;
            expect(config.watchers.size).to.equal(0);
        });

        it('participates in the hot-reload gate', () => {
            // Guards the wiring itself. Before #180 initialize() consulted only
            // this.options.enableHotReload; the config key existed and was
            // ignored.
            const source = fs.readFileSync(
                path.join(__dirname, '..', 'lib', 'config', 'ConfigManager.ts'),
                'utf8',
            );
            expect(source).to.include("this.get('development.hotReload')");
        });
    });

    describe('logging.structured.includePerformance', () => {

        /**
         * Build a log entry through the private path the config gates.
         * @param {object} options - Logger config
         * @returns {object} the created entry
         */
        function entryFor(options) {
            const logger = new Logger({outputs: [], ...options});
            return logger.createLogEntry('error', 'boom', {}, null);
        }

        it('attaches performance data by default', () => {
            const entry = entryFor({});
            expect(entry.performance).to.be.an('object');
            expect(entry.performance).to.have.property('heapUsed');
        });

        it('omits performance data when disabled', () => {
            // Before #180 this block ran unconditionally and the key was inert.
            expect(entryFor({includePerformance: false}).performance).to.equal(undefined);
        });

        it('only applies to warn and error levels', () => {
            const logger = new Logger({outputs: []});
            expect(logger.createLogEntry('info', 'hi', {}, null).performance).to.equal(undefined);
            expect(logger.createLogEntry('warn', 'hm', {}, null).performance).to.be.an('object');
        });
    });

    describe('removed keys stay gone', () => {

        const REMOVED = [
            'monitoring.enabled', 'monitoring.metricsPort', 'monitoring.healthCheckPort',
            'monitoring.tracingEnabled', 'monitoring.performanceTracking',
            'ai.mcp.enabled', 'ai.mcp.port', 'ai.mcp.host',
            'enterprise.auditLogging', 'enterprise.complianceMode',
            'enterprise.encryptedConfig', 'enterprise.configVersioning',
            'development.validateOnChange', 'development.debugMode',
            'development.mockExternalServices',
            'downloads.enableStdout',
        ];

        it('resolves none of them', () => {
            const config = loadWith({});
            const alive = REMOVED.filter(key => config.get(key) !== undefined);
            expect(alive, `these were removed in #180 but still resolve: ${alive.join(', ')}`)
                .to.deep.equal([]);
        });

        it('loads a 2.x config that still sets them, dropping the keys silently', () => {
            // stripUnknown means an existing config file keeps working; the
            // removed keys simply have no effect. No migration step for users.
            const config = loadWith({
                monitoring: {enabled: true, metricsPort: 9090},
                enterprise: {auditLogging: true},
                development: {hotReload: false, debugMode: true},
                ai: {enabled: true, mcp: {enabled: true, port: 8080}},
            });

            expect(config.get('development.hotReload')).to.be.false;  // survivor, honoured
            expect(config.get('ai.enabled')).to.be.true;              // survivor, honoured
            expect(config.get('monitoring.metricsPort')).to.equal(undefined);
            expect(config.get('enterprise.auditLogging')).to.equal(undefined);
            expect(config.get('ai.mcp.port')).to.equal(undefined);
        });
    });
});
