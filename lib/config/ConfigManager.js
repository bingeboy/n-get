"use strict";
/**
 * @fileoverview Enterprise Configuration Manager with YAML support and validation
 * Provides hierarchical configuration loading, validation, and AI agent integration
 * @module ConfigManager
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const js_yaml_1 = __importDefault(require("js-yaml"));
const joi_1 = __importDefault(require("joi"));
/**
 * Enterprise Configuration Manager
 * Handles hierarchical YAML configuration with validation, profiles, and AI integration
 */
class ConfigManager {
    options;
    config;
    schema;
    watchers;
    profiles;
    activeProfile;
    configHistory;
    loadTime;
    metrics;
    /**
     * Creates a ConfigManager instance
     * @param {ConfigManagerOptions} [options={}] - Configuration options
     */
    constructor(options = {}) {
        // Packaged defaults. The old code picked EITHER this directory or the
        // user's ./config, and since the packaged one ships in files[] it always
        // won — so user configuration was silently inert. The user directory is
        // now a separate layer applied on top (see userConfigDir below) rather
        // than an either/or.
        let configDir = options.configDir;
        if (!configDir) {
            const packageConfigDir = node_path_1.default.join(__dirname, '../../config');
            const currentConfigDir = node_path_1.default.join(process.cwd(), 'config');
            try {
                node_fs_1.default.accessSync(packageConfigDir);
                configDir = packageConfigDir;
            }
            catch {
                configDir = currentConfigDir;
            }
        }
        // User overrides, layered over the packaged defaults.
        //
        // Only defaulted when configDir was NOT supplied. An explicit configDir
        // means "use exactly this directory" — silently layering ./config on top
        // would surprise embedders and, in tests, would pull this repo's real
        // config over a fixture. Callers wanting both pass userConfigDir too.
        //
        // Resolved to an absolute path so the comparison in userConfigDirs() is
        // reliable, and ignored when it equals the packaged directory — the case
        // when running from inside this repo, which is exactly why the original
        // bug went unnoticed.
        const userConfigDir = options.userConfigDir
            ? node_path_1.default.resolve(options.userConfigDir)
            : (options.configDir ? undefined : node_path_1.default.resolve(process.cwd(), 'config'));
        // Detect test environment from command line or process
        const isTestEnvironment = process.argv.some(arg => arg.includes('mocha')) ||
            process.argv.some(arg => arg.includes('test')) ||
            process.env.npm_lifecycle_event === 'test';
        this.options = {
            configDir: configDir,
            userConfigDir,
            environment: options.environment || process.env.NODE_ENV || (isTestEnvironment ? 'test' : 'development'),
            enableHotReload: options.enableHotReload !== false,
            logger: options.logger || console,
            ...options,
        };
        // Configuration state
        this.config = {};
        this.schema = null;
        this.watchers = new Map();
        this.profiles = new Map();
        this.activeProfile = null;
        this.configHistory = [];
        this.loadTime = null;
        // Performance tracking
        this.metrics = {
            loadCount: 0,
            validationCount: 0,
            profileSwitches: 0,
            errors: [],
        };
        // Initialize configuration
        this.initialize();
    }
    /**
     * Initialize the configuration manager
     * @private
     */
    initialize() {
        try {
            this.schema = this.createValidationSchema();
            this.loadConfiguration();
            this.loadProfiles();
            if (this.options.enableHotReload && this.options.environment === 'development' && process.env.NODE_ENV !== 'test') {
                this.setupHotReload();
            }
            this.loadTime = new Date();
            this.metrics.loadCount++;
            if (process.env.NODE_ENV !== 'test') {
                this.options.logger.info('ConfigManager initialized', {
                    environment: this.options.environment,
                    configDir: this.options.configDir,
                    hotReload: this.options.enableHotReload,
                });
            }
        }
        catch (error) {
            this.recordError('INITIALIZATION_FAILED', error);
            throw error;
        }
    }
    /**
     * Load configuration from multiple sources with precedence
     * Precedence: CLI args > env vars > local.yaml > {environment}.yaml > default.yaml
     */
    loadConfiguration() {
        try {
            const configs = [];
            // 1. Load default configuration (lowest precedence)
            const defaultConfig = this.loadConfigFile('default.yaml');
            if (defaultConfig) {
                configs.push(defaultConfig);
            }
            // 2. Load environment-specific configuration
            const envConfig = this.loadConfigFile(`${this.options.environment}.yaml`);
            if (envConfig) {
                configs.push(envConfig);
            }
            // 3. Load local configuration (git-ignored)
            const localConfig = this.loadConfigFile('local.yaml');
            if (localConfig) {
                configs.push(localConfig);
            }
            // 3b. User overrides from ./config, layered over everything the
            // package ships. Same file precedence within the directory, so a
            // user's local.yaml still beats their own default.yaml. Without
            // this the packaged files were the only configuration that could
            // ever apply, and nothing a user wrote had any effect.
            for (const dir of this.userConfigDirs()) {
                for (const filename of ['default.yaml', `${this.options.environment}.yaml`, 'local.yaml']) {
                    const userConfig = this.loadConfigFileFrom(dir, filename);
                    if (userConfig) {
                        configs.push(userConfig);
                    }
                }
            }
            // 4. Load environment variables
            const envVarConfig = this.loadEnvironmentVariables();
            if (envVarConfig) {
                configs.push(envVarConfig);
            }
            // 5. Load command-line arguments (highest precedence)
            const cliConfig = this.loadCommandLineArgs();
            if (cliConfig) {
                configs.push(cliConfig);
            }
            // Merge configurations with proper precedence
            this.config = this.mergeConfigs(configs);
            // Validate merged configuration
            this.validateConfiguration();
            // Record configuration in history
            this.recordConfigurationChange('LOAD', this.config);
        }
        catch (error) {
            this.recordError('CONFIGURATION_LOAD_FAILED', error);
            throw error;
        }
    }
    /**
     * Load a YAML configuration file
     * @param {string} filename - Configuration filename
     * @returns {Record<string, unknown>|null} Configuration object or null if file doesn't exist
     * @private
     */
    loadConfigFile(filename) {
        return this.loadConfigFileFrom(this.options.configDir, filename);
    }
    /**
     * Directories the user may place overrides in, in increasing precedence.
     * Empty when the user directory is the packaged one (running from inside
     * this repo), so the same files are not loaded twice.
     * @private
     */
    userConfigDirs() {
        const packaged = node_path_1.default.resolve(this.options.configDir);
        const user = this.options.userConfigDir;
        return user && user !== packaged ? [user] : [];
    }
    /**
     * Load a YAML configuration file from a specific directory
     * @private
     */
    loadConfigFileFrom(dir, filename) {
        const filePath = node_path_1.default.join(dir, filename);
        try {
            if (!node_fs_1.default.existsSync(filePath)) {
                return null;
            }
            const content = node_fs_1.default.readFileSync(filePath, 'utf8');
            const config = js_yaml_1.default.load(content);
            if (process.env.NODE_ENV !== 'test') {
                this.options.logger.debug(`Loaded configuration from ${filename}`, {
                    path: filePath,
                    keys: Object.keys(config || {}),
                });
            }
            return config;
        }
        catch (error) {
            this.recordError('CONFIG_FILE_LOAD_FAILED', error, { filename, filePath });
            throw new Error(`Failed to load configuration file ${filename}: ${error.message}`);
        }
    }
    /**
     * Load configuration from environment variables
     * Environment variables follow the pattern: NGET_SECTION_KEY=value
     * @returns {Record<string, unknown>|null} Configuration object from environment variables
     * @private
     */
    loadEnvironmentVariables() {
        const envConfig = {};
        const prefix = 'NGET_';
        for (const [key, value] of Object.entries(process.env)) {
            if (key.startsWith(prefix)) {
                const configPath = key.slice(prefix.length).toLowerCase().split('_').map(this.toCamelCase);
                // Special handling for NGET_LOG_* variables to map to logging.*
                if (configPath.length >= 1 && configPath[0] === 'log') {
                    configPath[0] = 'logging';
                }
                this.setNestedValue(envConfig, configPath, this.parseEnvValue(value));
            }
        }
        return Object.keys(envConfig).length > 0 ? envConfig : null;
    }
    /**
     * Convert string to camelCase, handling known config key mappings
     * @param {string} str - String to convert
     * @returns {string} camelCase string
     * @private
     */
    toCamelCase(str) {
        // Handle known mappings for config keys
        const keyMappings = {
            'maxconcurrent': 'maxConcurrent',
            'enableresume': 'enableResume',
            'progressreporting': 'progressReporting',
            'chunkupdatefrequency': 'chunkUpdateFrequency',
            'chunksize': 'chunkSize',
            'maxfilesize': 'maxFileSize',
            'allowedprotocols': 'allowedProtocols',
            'blockprivatenetworks': 'blockPrivateNetworks',
            'blocklocalhost': 'blockLocalhost',
            'pathtraversalprotection': 'pathTraversalProtection',
            'sanitizefilenames': 'sanitizeFilenames',
            'certificatevalidation': 'certificateValidation',
            'maxretries': 'maxRetries',
            'useragent': 'userAgent',
            'blockprivateranges': 'blockPrivateRanges',
            'blockdocumentation': 'blockDocumentation',
            'blockmulticast': 'blockMulticast',
            'allowipv4mapped': 'allowIPv4Mapped',
            'strictvalidation': 'strictValidation',
            'enablecolors': 'enableColors',
            'includeperformance': 'includePerformance',
            'includestacktrace': 'includeStackTrace',
            'correlationids': 'correlationIds',
            'hotreload': 'hotReload',
            'validateonchange': 'validateOnChange',
            'debugmode': 'debugMode',
            'mockexternalservices': 'mockExternalServices',
            'auditlogging': 'auditLogging',
            'compliancemode': 'complianceMode',
            'encryptedconfig': 'encryptedConfig',
            'configversioning': 'configVersioning',
            'learningenabled': 'learningEnabled',
            'metricsport': 'metricsPort',
            'healthcheckport': 'healthCheckPort',
            'tracingenabled': 'tracingEnabled',
            'performancetracking': 'performanceTracking',
        };
        return keyMappings[str.toLowerCase()] || str;
    }
    /**
     * Load configuration from command-line arguments
     * @returns {Record<string, unknown>|null} Configuration object from CLI arguments
     * @private
     */
    loadCommandLineArgs() {
        const args = process.argv.slice(2);
        const cliConfig = {};
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg.startsWith('--config-')) {
                const key = arg.slice(9); // Remove '--config-'
                const value = args[i + 1];
                if (value && !value.startsWith('-')) {
                    const configPath = key.split('-');
                    this.setNestedValue(cliConfig, configPath, this.parseEnvValue(value));
                    i++; // Skip next argument as it's the value
                }
            }
        }
        return Object.keys(cliConfig).length > 0 ? cliConfig : null;
    }
    /**
     * Parse environment variable value to appropriate type
     * @param {string} value - Environment variable value
     * @returns {unknown} Parsed value
     * @private
     */
    parseEnvValue(value) {
        // Boolean values
        if (value.toLowerCase() === 'true') {
            return true;
        }
        if (value.toLowerCase() === 'false') {
            return false;
        }
        // Numeric values
        if (/^\d+$/.test(value)) {
            return parseInt(value, 10);
        }
        if (/^\d*\.\d+$/.test(value)) {
            return parseFloat(value);
        }
        // Array values (comma-separated)
        if (value.includes(',')) {
            return value.split(',').map(v => v.trim());
        }
        // String values
        return value;
    }
    /**
     * Set nested value in object using path array
     * @param {Record<string, unknown>} obj - Target object
     * @param {string[]} path - Path array
     * @param {unknown} value - Value to set
     * @private
     */
    setNestedValue(obj, path, value) {
        let current = obj;
        for (let i = 0; i < path.length - 1; i++) {
            if (!(path[i] in current)) {
                current[path[i]] = {};
            }
            current = current[path[i]];
        }
        current[path[path.length - 1]] = value;
    }
    /**
     * Deep merge multiple configuration objects
     * @param {Record<string, unknown>[]} configs - Array of configuration objects
     * @returns {Record<string, unknown>} Merged configuration
     * @private
     */
    mergeConfigs(configs) {
        return configs.reduce((merged, config) => {
            return this.deepMerge(merged, config || {});
        }, {});
    }
    /**
     * Deep merge two objects
     * @param {Record<string, unknown>} target - Target object
     * @param {Record<string, unknown>} source - Source object
     * @returns {Record<string, unknown>} Merged object
     * @private
     */
    deepMerge(target, source) {
        const result = { ...target };
        for (const [key, value] of Object.entries(source)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                result[key] = this.deepMerge((result[key] || {}), value);
            }
            else {
                result[key] = value;
            }
        }
        return result;
    }
    /**
     * Create Joi validation schema for configuration
     * @returns {Joi.ObjectSchema} Validation schema
     * @private
     */
    createValidationSchema() {
        return joi_1.default.object({
            version: joi_1.default.string().required(),
            http: joi_1.default.object({
                timeout: joi_1.default.number().min(1000).max(300000).default(30000),
                maxRetries: joi_1.default.number().min(0).max(10).default(3),
                userAgent: joi_1.default.string().default('N-Get-Enterprise/2.0'),
            }).default(),
            downloads: joi_1.default.object({
                maxConcurrent: joi_1.default.number().min(1).max(50).default(3),
                enableResume: joi_1.default.boolean().default(true),
                progressReporting: joi_1.default.boolean().default(true),
                chunkUpdateFrequency: joi_1.default.number().min(100).default(1000),
                chunkSize: joi_1.default.number().min(1).default(50),
            }).default(),
            security: joi_1.default.object({
                maxFileSize: joi_1.default.number().min(1024).default(10737418240),
                allowedProtocols: joi_1.default.array().items(joi_1.default.string()).default(['https', 'http', 'sftp']),
                // Host allow/deny lists. Both match a hostname exactly or as a
                // subdomain, so 'example.com' also covers 'cdn.example.com'.
                // An empty allowedDomains means no restriction; a non-empty
                // one permits nothing outside it. blockedDomains is checked
                // first, so it wins over an allowlist entry.
                blockedDomains: joi_1.default.array().items(joi_1.default.string()).default([]),
                allowedDomains: joi_1.default.array().items(joi_1.default.string()).default([]),
                blockPrivateNetworks: joi_1.default.boolean().default(false),
                blockLocalhost: joi_1.default.boolean().default(false),
                pathTraversalProtection: joi_1.default.boolean().default(true),
                rateLimiting: joi_1.default.object({
                    enabled: joi_1.default.boolean().default(true),
                    requestsPerMinute: joi_1.default.number().min(1).default(100),
                    windowMs: joi_1.default.number().min(1000).default(60000),
                }).default(),
                sanitizeFilenames: joi_1.default.boolean().default(true),
                certificateValidation: joi_1.default.boolean().default(true),
                ipv6: joi_1.default.object({
                    blockPrivateRanges: joi_1.default.boolean().default(false),
                    blockDocumentation: joi_1.default.boolean().default(false),
                    blockMulticast: joi_1.default.boolean().default(false),
                    allowIPv4Mapped: joi_1.default.boolean().default(true),
                    strictValidation: joi_1.default.boolean().default(false),
                }).default(),
            }).default(),
            logging: joi_1.default.object({
                level: joi_1.default.string().valid('trace', 'debug', 'info', 'warn', 'error').default('info'),
                format: joi_1.default.string().valid('json', 'text').default('json'),
                outputs: joi_1.default.array().items(joi_1.default.string()).default(['console']),
                enableColors: joi_1.default.boolean().default(true),
                rotation: joi_1.default.object({
                    maxFileSize: joi_1.default.number().min(1024).default(10485760),
                    maxFiles: joi_1.default.number().min(1).default(5),
                }).default(),
                structured: joi_1.default.object({
                    includeStackTrace: joi_1.default.boolean().default(true),
                    includePerformance: joi_1.default.boolean().default(true),
                    correlationIds: joi_1.default.boolean().default(true),
                }).default(),
            }).default(),
            monitoring: joi_1.default.object({
                enabled: joi_1.default.boolean().default(true),
                metricsPort: joi_1.default.number().min(1024).max(65535).default(9090),
                healthCheckPort: joi_1.default.number().min(1024).max(65535).default(8080),
                tracingEnabled: joi_1.default.boolean().default(true),
                performanceTracking: joi_1.default.boolean().default(true),
            }).default(),
            ai: joi_1.default.object({
                enabled: joi_1.default.boolean().default(false),
                mcp: joi_1.default.object({
                    enabled: joi_1.default.boolean().default(false),
                    port: joi_1.default.number().min(1024).max(65535).default(8080),
                    host: joi_1.default.string().default('127.0.0.1'),
                }).default(),
                profiles: joi_1.default.object({
                    enabled: joi_1.default.boolean().default(true),
                    learningEnabled: joi_1.default.boolean().default(false),
                }).default(),
            }).default(),
            development: joi_1.default.object({
                hotReload: joi_1.default.boolean().default(true),
                validateOnChange: joi_1.default.boolean().default(true),
                debugMode: joi_1.default.boolean().default(false),
                mockExternalServices: joi_1.default.boolean().default(false),
            }).default(),
            enterprise: joi_1.default.object({
                auditLogging: joi_1.default.boolean().default(false),
                complianceMode: joi_1.default.boolean().default(false),
                encryptedConfig: joi_1.default.boolean().default(false),
                configVersioning: joi_1.default.boolean().default(false),
            }).default(),
            profiles: joi_1.default.object().pattern(joi_1.default.string(), joi_1.default.object()).default({}),
        });
    }
    /**
     * Validate configuration against schema
     * @throws {Error} If validation fails
     * @private
     */
    validateConfiguration() {
        try {
            const { error, value } = this.schema.validate(this.config, {
                allowUnknown: false,
                stripUnknown: true,
            });
            if (error) {
                this.recordError('VALIDATION_FAILED', error);
                throw new Error(`Configuration validation failed: ${error.message}`);
            }
            this.config = value;
            this.metrics.validationCount++;
            if (process.env.NODE_ENV !== 'test') {
                this.options.logger.debug('Configuration validated successfully', {
                    sections: Object.keys(this.config),
                });
            }
        }
        catch (error) {
            this.recordError('VALIDATION_ERROR', error);
            throw error;
        }
    }
    /**
     * Load configuration profiles
     * @private
     */
    loadProfiles() {
        if (this.config.profiles) {
            for (const [name, profileConfig] of Object.entries(this.config.profiles)) {
                this.profiles.set(name, profileConfig);
            }
            if (process.env.NODE_ENV !== 'test') {
                this.options.logger.debug('Loaded configuration profiles', {
                    profiles: Array.from(this.profiles.keys()),
                });
            }
        }
    }
    /**
     * Get current configuration
     * @returns {NgetConfig} Current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Get configuration value by path
     * @param {string} path - Configuration path (e.g., 'http.timeout')
     * @param {unknown} [defaultValue] - Default value if path doesn't exist
     * @returns {unknown} Configuration value
     */
    get(path, defaultValue) {
        const keys = path.split('.');
        let current = this.config;
        for (const key of keys) {
            if (current && typeof current === 'object' && key in current) {
                current = current[key];
            }
            else {
                return defaultValue;
            }
        }
        return current;
    }
    /**
     * Set configuration value by path
     * @param {string} path - Configuration path
     * @param {unknown} value - Value to set
     */
    set(path, value) {
        const keys = path.split('.');
        let current = this.config;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!(keys[i] in current)) {
                current[keys[i]] = {};
            }
            current = current[keys[i]];
        }
        current[keys[keys.length - 1]] = value;
        // Validate after setting
        this.validateConfiguration();
        this.recordConfigurationChange('SET', { path, value });
    }
    /**
     * Apply configuration profile
     * @param {string} profileName - Profile name
     * @returns {Promise<void>}
     */
    async applyProfile(profileName) {
        if (!this.profiles.has(profileName)) {
            throw new Error(`Profile '${profileName}' not found`);
        }
        const profile = this.profiles.get(profileName);
        const previousConfig = { ...this.config };
        try {
            // Merge profile configuration
            this.config = this.deepMerge(this.config, profile);
            // Validate merged configuration
            this.validateConfiguration();
            this.activeProfile = profileName;
            this.metrics.profileSwitches++;
            this.recordConfigurationChange('PROFILE_APPLIED', {
                profile: profileName,
                changes: profile,
            });
            if (process.env.NODE_ENV !== 'test') {
                this.options.logger.info(`Applied configuration profile: ${profileName}`, {
                    profile: profileName,
                    changes: Object.keys(profile),
                });
            }
        }
        catch (error) {
            // Rollback on error
            this.config = previousConfig;
            this.recordError('PROFILE_APPLICATION_FAILED', error, { profileName });
            throw error;
        }
    }
    /**
     * Record configuration change in history
     * @param {string} type - Change type
     * @param {unknown} details - Change details
     * @private
     */
    recordConfigurationChange(type, details) {
        const change = {
            timestamp: new Date().toISOString(),
            type,
            details,
            environment: this.options.environment,
        };
        this.configHistory.push(change);
        // Keep only last 100 changes
        if (this.configHistory.length > 100) {
            this.configHistory = this.configHistory.slice(-100);
        }
    }
    /**
     * Record error in metrics
     * @param {string} type - Error type
     * @param {Error} error - Error object
     * @param {Record<string, unknown>} [context] - Additional context
     * @private
     */
    recordError(type, error, context = {}) {
        const errorRecord = {
            timestamp: new Date().toISOString(),
            type,
            message: error.message,
            stack: error.stack,
            context,
        };
        this.metrics.errors.push(errorRecord);
        // Keep only last 50 errors
        if (this.metrics.errors.length > 50) {
            this.metrics.errors = this.metrics.errors.slice(-50);
        }
    }
    /**
     * Setup hot-reloading for configuration files
     * @private
     */
    setupHotReload() {
        if (!this.options.enableHotReload) {
            return;
        }
        const configFiles = [
            'default.yaml',
            `${this.options.environment}.yaml`,
            'local.yaml',
        ];
        for (const filename of configFiles) {
            const filePath = node_path_1.default.join(this.options.configDir, filename);
            if (node_fs_1.default.existsSync(filePath)) {
                const watcher = node_fs_1.default.watch(filePath, (eventType) => {
                    if (eventType === 'change') {
                        this.reloadConfiguration();
                    }
                });
                this.watchers.set(filename, watcher);
            }
        }
        if (process.env.NODE_ENV !== 'test') {
            this.options.logger.debug('Hot-reload setup completed', {
                watchedFiles: Array.from(this.watchers.keys()),
            });
        }
    }
    /**
     * Reload configuration from files
     */
    reloadConfiguration() {
        try {
            if (process.env.NODE_ENV !== 'test') {
                this.options.logger.info('Reloading configuration...');
            }
            this.loadConfiguration();
            if (process.env.NODE_ENV !== 'test') {
                this.options.logger.info('Configuration reloaded successfully');
            }
        }
        catch (error) {
            this.recordError('RELOAD_FAILED', error);
            this.options.logger.error('Configuration reload failed', error);
        }
    }
    /**
     * Get configuration metrics and statistics
     * @returns {object} Configuration metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            loadTime: this.loadTime,
            activeProfile: this.activeProfile,
            environment: this.options.environment,
            configSections: Object.keys(this.config),
            profileCount: this.profiles.size,
            historyLength: this.configHistory.length,
        };
    }
    // ==================== AI AGENT INTEGRATION METHODS ====================
    /**
     * Get available configuration profiles for AI agents
     * @returns {Record<string, unknown>} Available profiles with descriptions
     */
    getAvailableProfiles() {
        const profiles = {};
        for (const [name, profile] of this.profiles.entries()) {
            profiles[name] = {
                name,
                description: profile.description || `Configuration profile: ${name}`,
                active: this.activeProfile === name,
                config: profile,
            };
        }
        return profiles;
    }
    /**
     * Get AI-optimized configuration summary
     * @returns {Record<string, unknown>} Configuration summary for AI agents
     */
    getAIConfigSummary() {
        return {
            currentProfile: this.activeProfile,
            environment: this.options.environment,
            keySettings: {
                maxConcurrentDownloads: this.get('downloads.maxConcurrent'),
                httpTimeout: this.get('http.timeout'),
                maxRetries: this.get('http.maxRetries'),
                securityLevel: this.getSecurityLevel(),
                loggingLevel: this.get('logging.level'),
            },
            capabilities: {
                resumeDownloads: this.get('downloads.enableResume'),
                progressReporting: this.get('downloads.progressReporting'),
                aiIntegration: this.get('ai.enabled'),
                profileSwitching: this.get('ai.profiles.enabled'),
            },
            performance: {
                lastLoadTime: this.loadTime,
                profileSwitches: this.metrics.profileSwitches,
                configurationChanges: this.configHistory.length,
            },
        };
    }
    /**
     * Determine current security level
     * @returns {string} Security level description
     * @private
     */
    getSecurityLevel() {
        const blocksPrivate = this.get('security.blockPrivateNetworks');
        const blocksLocalhost = this.get('security.blockLocalhost');
        const validatesCerts = this.get('security.certificateValidation');
        const rateLimited = this.get('security.rateLimiting.enabled');
        if (blocksPrivate && blocksLocalhost && validatesCerts && rateLimited) {
            return 'high';
        }
        else if (validatesCerts && rateLimited) {
            return 'medium';
        }
        else {
            return 'low';
        }
    }
    /**
     * Learn from successful configurations for AI improvement
     * @param {object} outcome - Task outcome details
     */
    learnFromOutcome(outcome) {
        if (!this.get('ai.profiles.learningEnabled')) {
            return;
        }
        const learningData = {
            timestamp: new Date().toISOString(),
            profile: this.activeProfile,
            configuration: this.getAIConfigSummary(),
            outcome,
            environment: this.options.environment,
        };
        this.recordConfigurationChange('LEARNING_DATA', learningData);
        // Simple learning: if task was successful with good performance, record it
        if (outcome.success && outcome.throughput > 1048576) { // > 1MB/s
            this.recordConfigurationChange('SUCCESSFUL_CONFIG', {
                profile: this.activeProfile,
                keySettings: learningData.configuration.keySettings,
                performance: {
                    duration: outcome.duration,
                    throughput: outcome.throughput,
                },
            });
        }
        if (process.env.NODE_ENV !== 'test') {
            this.options.logger.debug('Recorded learning data', learningData);
        }
    }
    /**
     * Export current configuration for AI model training
     * @returns {Record<string, unknown>} Configuration data suitable for AI training
     */
    exportForAITraining() {
        return {
            version: this.config.version,
            environment: this.options.environment,
            activeProfile: this.activeProfile,
            configuration: this.config,
            profiles: Object.fromEntries(this.profiles),
            metrics: this.getMetrics(),
            history: this.configHistory.slice(-20), // Last 20 changes
            timestamp: new Date().toISOString(),
        };
    }
    /**
     * Cleanup resources and watchers
     */
    cleanup() {
        // Close file watchers
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();
        if (process.env.NODE_ENV !== 'test') {
            this.options.logger.info('ConfigManager cleanup completed');
        }
    }
}
module.exports = ConfigManager;
