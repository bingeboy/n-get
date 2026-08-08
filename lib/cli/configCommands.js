"use strict";
/**
 * @fileoverview Configuration CLI commands for n-get
 * Provides CLI interface for configuration management, debugging, and profile switching
 * @module configCommands
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const ConfigManager = require("../config/ConfigManager");
const OutputFormatterService = require("../services/OutputFormatterService");
const ui = require("../ui");
/**
 * CLI Configuration Command Handler
 * Provides commands for viewing, setting, and managing configuration
 */
class ConfigCommands {
    options;
    configManager;
    outputFormatter;
    constructor(options = {}) {
        this.options = options;
        this.configManager = null;
        this.outputFormatter = new OutputFormatterService();
    }
    /**
     * Initialize ConfigManager for commands
     */
    initializeConfigManager(cliOptions = {}) {
        if (!this.configManager) {
            const configOptions = {
                environment: cliOptions['config-environment'] || process.env.NODE_ENV || 'development',
                enableHotReload: false, // Disable for CLI commands
                logger: cliOptions.quiet ? {
                    info: () => { },
                    debug: () => { },
                    warn: () => { },
                    error: (...args) => console.error(...args),
                } : console,
            };
            this.configManager = new ConfigManager(configOptions);
        }
        return this.configManager;
    }
    /**
     * Show current configuration
     * Usage: nget config show [section]
     */
    async show(args = [], cliOptions = {}) {
        const configManager = this.initializeConfigManager(cliOptions);
        const section = args[0];
        try {
            const config = configManager.getConfig();
            let configData;
            if (section) {
                // Show specific section
                const sectionData = configManager.get(section);
                if (sectionData === undefined) {
                    console.error(`${ui.emojis.error} Section '${section}' not found`);
                    process.exit(1);
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const cm = configManager;
                configData = {
                    section: section,
                    data: sectionData,
                    environment: cm.options.environment,
                    activeProfile: cm.activeProfile || 'none'
                };
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const cm = configManager;
                // Show all configuration
                configData = {
                    environment: cm.options.environment,
                    activeProfile: cm.activeProfile || 'none',
                    configDirectory: cm.options.configDir,
                    configuration: config
                };
            }
            // Check for structured output format
            const outputFormat = cliOptions['output-format'] || 'text';
            if (outputFormat !== 'text') {
                try {
                    const formattedOutput = this.outputFormatter.formatConfigOutput(configData, {
                        format: outputFormat,
                        compact: cliOptions.quiet
                    });
                    console.log(formattedOutput);
                    return;
                }
                catch (error) {
                    console.error(`Error formatting output as ${outputFormat}:`, error.message);
                    // Fall back to text output
                }
            }
            // Text output (default)
            if (!cliOptions.quiet) {
                ui.displayBanner();
                console.log(`\n${ui.emojis.gear} Current Configuration\n`);
            }
            if (section) {
                console.log(`${ui.emojis.info} Section: ${section}`);
                console.log(JSON.stringify(configData.data, null, 2));
            }
            else {
                console.log(`${ui.emojis.info} Environment: ${configData.environment}`);
                console.log(`${ui.emojis.info} Active Profile: ${configData.activeProfile}`);
                console.log(`${ui.emojis.info} Config Directory: ${configData.configDirectory}`);
                console.log('\nFull Configuration:');
                console.log(JSON.stringify(configData.configuration, null, 2));
            }
            if (!cliOptions.quiet) {
                console.log(`\n${ui.emojis.rocket} Use 'nget config set <key> <value>' to modify settings`);
            }
        }
        catch (error) {
            console.error(`${ui.emojis.error} Error reading configuration: ${error.message}`);
            process.exit(1);
        }
    }
    /**
     * Set configuration value
     * Usage: nget config set <key> <value>
     */
    async set(args = [], cliOptions = {}) {
        if (args.length < 2) {
            console.error(`${ui.emojis.error} Usage: nget config set <key> <value>`);
            console.error('Examples:');
            console.error('  nget config set http.timeout 45000');
            console.error('  nget config set downloads.maxConcurrent 5');
            console.error('  nget config set logging.level debug');
            process.exit(1);
        }
        const configManager = this.initializeConfigManager(cliOptions);
        const key = args[0];
        let value = args[1];
        // Parse value to appropriate type
        if (value === 'true') {
            value = true;
        }
        else if (value === 'false') {
            value = false;
        }
        else if (/^\d+$/.test(value)) {
            value = parseInt(value, 10);
        }
        else if (/^\d*\.\d+$/.test(value)) {
            value = parseFloat(value);
        }
        else if (value.includes(',')) {
            value = value.split(',').map((v) => v.trim());
        }
        try {
            const oldValue = configManager.get(key);
            configManager.set(key, value);
            if (!cliOptions.quiet) {
                console.log(`${ui.emojis.success} Configuration updated:`);
                console.log(`  ${key}: ${JSON.stringify(oldValue)} → ${JSON.stringify(value)}`);
                console.log(`\n${ui.emojis.info} Use 'nget config show ${key.split('.')[0]}' to view the section`);
            }
        }
        catch (error) {
            console.error(`${ui.emojis.error} Error setting configuration: ${error.message}`);
            process.exit(1);
        }
    }
    /**
     * List available profiles
     * Usage: nget config profiles
     */
    async profiles(args = [], cliOptions = {}) {
        const configManager = this.initializeConfigManager(cliOptions);
        if (!cliOptions.quiet) {
            ui.displayBanner();
            console.log(`\n${ui.emojis.rocket} Available Configuration Profiles\n`);
        }
        try {
            const profiles = configManager.getAvailableProfiles();
            const profileNames = Object.keys(profiles);
            if (profileNames.length === 0) {
                console.log(`${ui.emojis.info} No profiles configured`);
                console.log(`\n${ui.emojis.gear} Add profiles to your configuration files:`);
                console.log('  profiles:');
                console.log('    fast:');
                console.log('      description: "High-speed downloads"');
                console.log('      downloads:');
                console.log('        maxConcurrent: 10');
                return;
            }
            profileNames.forEach(name => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const profile = profiles[name];
                const activeIndicator = profile['active'] ? ' ⭐ (active)' : '';
                console.log(`${ui.emojis.gear} ${name}${activeIndicator}`);
                console.log(`  Description: ${profile['description']}`);
                console.log(`  Settings: ${Object.keys(profile['config'] || {}).length} configuration overrides`);
                if (args.includes('--verbose') || args.includes('-v')) {
                    console.log('  Configuration:');
                    console.log(JSON.stringify(profile['config'], null, 4).replace(/^/gm, '    '));
                }
                console.log('');
            });
            if (!cliOptions.quiet) {
                console.log(`${ui.emojis.info} Use 'nget config profile <name>' to switch profiles`);
                console.log(`${ui.emojis.info} Use 'nget config profiles --verbose' for detailed view`);
            }
        }
        catch (error) {
            console.error(`${ui.emojis.error} Error listing profiles: ${error.message}`);
            process.exit(1);
        }
    }
    /**
     * Switch to a configuration profile
     * Usage: nget config profile <name>
     */
    async profile(args = [], cliOptions = {}) {
        if (args.length === 0) {
            console.error(`${ui.emojis.error} Usage: nget config profile <name>`);
            console.error(`${ui.emojis.info} Use 'nget config profiles' to list available profiles`);
            process.exit(1);
        }
        const configManager = this.initializeConfigManager(cliOptions);
        const profileName = args[0];
        try {
            const availableProfiles = configManager.getAvailableProfiles();
            if (!availableProfiles[profileName]) {
                console.error(`${ui.emojis.error} Profile '${profileName}' not found`);
                console.error(`\nAvailable profiles: ${Object.keys(availableProfiles).join(', ')}`);
                process.exit(1);
            }
            await configManager.applyProfile(profileName);
            if (!cliOptions.quiet) {
                console.log(`${ui.emojis.success} Applied profile '${profileName}'`);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const profileData = availableProfiles[profileName];
                console.log(`${ui.emojis.info} Description: ${profileData['description']}`);
                console.log(`\n${ui.emojis.gear} Profile configuration applied:`);
                const config = profileData['config'];
                Object.keys(config).forEach(section => {
                    console.log(`  ${section}:`);
                    if (typeof config[section] === 'object') {
                        Object.keys(config[section]).forEach(key => {
                            console.log(`    ${key}: ${JSON.stringify(config[section][key])}`);
                        });
                    }
                    else {
                        console.log(`    ${JSON.stringify(config[section])}`);
                    }
                });
            }
        }
        catch (error) {
            console.error(`${ui.emojis.error} Error applying profile: ${error.message}`);
            process.exit(1);
        }
    }
    /**
     * Validate current configuration
     * Usage: nget config validate
     */
    async validate(_args = [], cliOptions = {}) {
        const configManager = this.initializeConfigManager(cliOptions);
        if (!cliOptions.quiet) {
            ui.displayBanner();
            console.log(`\n${ui.emojis.search} Configuration Validation\n`);
        }
        try {
            // Validation happens automatically during initialization; calling
            // getConfig() is what surfaces a validation error.
            configManager.getConfig();
            // getMetrics() returns Record<string,unknown> — cast for display-only access
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const metrics = configManager.getMetrics();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cm = configManager;
            console.log(`${ui.emojis.success} Configuration is valid`);
            console.log(`${ui.emojis.info} Environment: ${cm.options.environment}`);
            console.log(`${ui.emojis.info} Active Profile: ${cm.activeProfile || 'none'}`);
            console.log(`${ui.emojis.info} Configuration Sections: ${metrics.configSections.length}`);
            console.log(`${ui.emojis.info} Available Profiles: ${metrics.profileCount}`);
            console.log(`${ui.emojis.info} Validation Count: ${metrics.validationCount}`);
            if (metrics.errors.length > 0) {
                console.log(`\n${ui.emojis.warning} Recent Errors: ${metrics.errors.length}`);
                metrics.errors.slice(-3).forEach((error, index) => {
                    console.log(`  ${index + 1}. ${error.type}: ${error.message}`);
                });
            }
            // Validate critical sections
            const criticalSections = ['http', 'downloads', 'security', 'logging'];
            console.log(`\n${ui.emojis.gear} Critical Sections:`);
            criticalSections.forEach(section => {
                const sectionData = configManager.get(section);
                if (sectionData) {
                    console.log(`  ${ui.emojis.success} ${section}: OK`);
                }
                else {
                    console.log(`  ${ui.emojis.warning} ${section}: Missing (using defaults)`);
                }
            });
        }
        catch (error) {
            console.error(`${ui.emojis.error} Configuration validation failed: ${error.message}`);
            process.exit(1);
        }
    }
    /**
     * Debug configuration loading and merging
     * Usage: nget config debug
     */
    async debug(args = [], cliOptions = {}) {
        if (!cliOptions.quiet) {
            ui.displayBanner();
            console.log(`\n${ui.emojis.search} Configuration Debug Information\n`);
        }
        try {
            const configManager = this.initializeConfigManager(cliOptions);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cm = configManager;
            // getMetrics() returns Record<string,unknown> — cast for display-only access
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const metrics = configManager.getMetrics();
            const config = configManager.getConfig();
            // Basic information
            console.log(`${ui.emojis.info} Environment: ${cm.options.environment}`);
            console.log(`${ui.emojis.info} Config Directory: ${cm.options.configDir}`);
            console.log(`${ui.emojis.info} Hot Reload: ${cm.options.enableHotReload ? 'enabled' : 'disabled'}`);
            console.log(`${ui.emojis.info} Load Time: ${metrics.loadTime || 'unknown'}`);
            // File existence check
            console.log(`\n${ui.emojis.folder} Configuration Files:`);
            const configFiles = [
                'default.yaml',
                `${cm.options.environment}.yaml`,
                'local.yaml',
            ];
            configFiles.forEach(filename => {
                const filePath = path.join(cm.options.configDir, filename);
                const exists = fs.existsSync(filePath);
                const status = exists ? ui.emojis.success : ui.emojis.warning;
                const message = exists ? 'Found' : 'Not found';
                console.log(`  ${status} ${filename}: ${message}`);
                if (exists && args.includes('--verbose')) {
                    try {
                        const stats = fs.statSync(filePath);
                        console.log(`    Size: ${stats.size} bytes, Modified: ${stats.mtime.toISOString()}`);
                    }
                    catch (error) {
                        console.log(`    Error reading file stats: ${error.message}`);
                    }
                }
            });
            // Environment variables
            console.log(`\n${ui.emojis.network} Environment Variables:`);
            const ngetEnvVars = Object.keys(process.env)
                .filter(key => key.startsWith('NGET_'))
                .sort();
            if (ngetEnvVars.length === 0) {
                console.log(`  ${ui.emojis.info} No NGET_* environment variables set`);
            }
            else {
                ngetEnvVars.forEach(key => {
                    const value = process.env[key];
                    console.log(`  ${ui.emojis.gear} ${key} = ${value}`);
                });
            }
            // Profile information
            console.log(`\n${ui.emojis.rocket} Profile Status:`);
            console.log(`  Active Profile: ${cm.activeProfile || 'none'}`);
            console.log(`  Available Profiles: ${metrics.profileCount}`);
            console.log(`  Profile Switches: ${metrics.profileSwitches}`);
            // Metrics and statistics
            console.log(`\n${ui.emojis.chart} Metrics:`);
            console.log(`  Load Count: ${metrics.loadCount}`);
            console.log(`  Validation Count: ${metrics.validationCount}`);
            console.log(`  Configuration Changes: ${metrics.historyLength}`);
            console.log(`  Error Count: ${metrics.errors.length}`);
            if (metrics.errors.length > 0 && args.includes('--verbose')) {
                console.log(`\n${ui.emojis.warning} Recent Errors:`);
                metrics.errors.slice(-5).forEach((error, index) => {
                    console.log(`  ${index + 1}. [${error.timestamp}] ${error.type}: ${error.message}`);
                });
            }
            // Configuration structure
            if (args.includes('--verbose')) {
                console.log(`\n${ui.emojis.gear} Configuration Structure:`);
                console.log(JSON.stringify(config, null, 2));
            }
            else {
                console.log(`\n${ui.emojis.gear} Configuration Sections: ${metrics.configSections.join(', ')}`);
                console.log(`${ui.emojis.info} Use 'nget config debug --verbose' for full configuration dump`);
            }
        }
        catch (error) {
            console.error(`${ui.emojis.error} Debug failed: ${error.message}`);
            if (args.includes('--verbose')) {
                console.error(error.stack);
            }
            process.exit(1);
        }
    }
    /**
     * Main command router
     */
    async execute(args, cliOptions = {}) {
        const command = args[0];
        const commandArgs = args.slice(1);
        try {
            switch (command) {
                case 'show':
                    await this.show(commandArgs, cliOptions);
                    break;
                case 'set':
                    await this.set(commandArgs, cliOptions);
                    break;
                case 'profiles':
                    await this.profiles(commandArgs, cliOptions);
                    break;
                case 'profile':
                    await this.profile(commandArgs, cliOptions);
                    break;
                case 'validate':
                    await this.validate(commandArgs, cliOptions);
                    break;
                case 'debug':
                    await this.debug(commandArgs, cliOptions);
                    break;
                default:
                    this.showConfigHelp();
                    process.exit(1);
            }
        }
        catch (error) {
            if (error.code === 'EPIPE' || error.errno === 'EPIPE') {
                process.exit(0);
            }
            throw error;
        }
    }
    /**
     * Show configuration command help
     */
    showConfigHelp() {
        ui.displayBanner();
        console.log(`
${ui.emojis.gear} Configuration Commands:

${ui.emojis.info} Usage: nget config <command> [options]

${ui.emojis.rocket} Available Commands:
  show [section]         Show current configuration (or specific section)
  set <key> <value>      Set configuration value
  profiles [-v]          List available configuration profiles
  profile <name>         Switch to configuration profile
  validate               Validate current configuration
  debug [--verbose]      Show configuration debug information

${ui.emojis.folder} Examples:
  nget config show                    # Show full configuration
  nget config show http               # Show HTTP section only
  nget config set http.timeout 45000  # Set HTTP timeout to 45 seconds
  nget config set downloads.maxConcurrent 7  # Set max concurrent downloads
  nget config profiles                # List all profiles
  nget config profiles --verbose      # List profiles with details
  nget config profile fast            # Switch to 'fast' profile
  nget config validate               # Validate configuration
  nget config debug                  # Show debug information
  nget config debug --verbose        # Show debug info with full config

${ui.emojis.network} Configuration Sections:
  http          HTTP/HTTPS client settings
  downloads     Download behavior and limits
  security      Security and validation rules
  logging       Logging configuration
  monitoring    Metrics and monitoring
  ai            AI integration settings
  development   Development environment settings
  enterprise    Enterprise features
  profiles      Named configuration profiles

${ui.emojis.info} Configuration files are loaded in this order:
  1. default.yaml (base configuration)
  2. {environment}.yaml (environment-specific)
  3. local.yaml (local overrides, git-ignored)
  4. Environment variables (NGET_*)
  5. CLI arguments (--config-*)
        `.trim());
    }
}
module.exports = ConfigCommands;
