/**
 * @fileoverview Enterprise Configuration Manager with YAML support and validation
 * Provides hierarchical configuration loading, validation, and AI agent integration
 * @module ConfigManager
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const Joi = require('joi');

/**
 * Enterprise Configuration Manager
 * Handles hierarchical YAML configuration with validation, profiles, and AI integration
 */
class ConfigManager {
    /**
     * Creates a ConfigManager instance
     * @param {Object} [options={}] - Configuration options
     * @param {string} [options.configDir] - Configuration directory path
     * @param {string} [options.environment] - Environment name (development, production, etc.)
     * @param {boolean} [options.enableHotReload] - Enable configuration hot-reloading
     * @param {Function} [options.logger] - Logger instance
     */
    constructor(options = {}) {
        // Robust config directory resolution
        let configDir = options.configDir;
        if (!configDir) {
            // Try to find package config directory relative to this file
            const packageConfigDir = path.join(__dirname, '../../config');
            const currentConfigDir = path.join(process.cwd(), 'config');
            
            try {
                fs.accessSync(packageConfigDir);
                configDir = packageConfigDir;
            } catch {
                configDir = currentConfigDir;
            }
        }

        // Detect test environment from command line or process
        const isTestEnvironment = process.argv.some(arg => arg.includes('mocha')) || 
                                 process.argv.some(arg => arg.includes('test')) ||
                                 process.env.npm_lifecycle_event === 'test';

        this.options = {
            configDir: configDir,
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
        } catch (error) {
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
            if (defaultConfig) {configs.push(defaultConfig);}

            // 2. Load environment-specific configuration
            const envConfig = this.loadConfigFile(`${this.options.environment}.yaml`);
            if (envConfig) {configs.push(envConfig);}

            // 3. Load local configuration (git-ignored)
            const localConfig = this.loadConfigFile('local.yaml');
            if (localConfig) {configs.push(localConfig);}

            // 4. Load environment variables
            const envVarConfig = this.loadEnvironmentVariables();
            if (envVarConfig) {configs.push(envVarConfig);}

            // 5. Load command-line arguments (highest precedence)
            const cliConfig = this.loadCommandLineArgs();
            if (cliConfig) {configs.push(cliConfig);}

            // Merge configurations with proper precedence
            this.config = this.mergeConfigs(configs);

            // Validate merged configuration
            this.validateConfiguration();

            // Record configuration in history
            this.recordConfigurationChange('LOAD', this.config);

        } catch (error) {
            this.recordError('CONFIGURATION_LOAD_FAILED', error);
            throw error;
        }
    }

    /**
     * Load a YAML configuration file
     * @param {string} filename - Configuration filename
     * @returns {Object|null} Configuration object or null if file doesn't exist
     * @private
     */
    loadConfigFile(filename) {
        const filePath = path.join(this.options.configDir, filename);
        
        try {
            if (!fs.existsSync(filePath)) {
                return null;
            }

            const content = fs.readFileSync(filePath, 'utf8');
            const config = yaml.load(content);
            
            if (process.env.NODE_ENV !== 'test') {
                this.options.logger.debug(`Loaded configuration from ${filename}`, {
                    path: filePath,
                    keys: Object.keys(config || {}),
                });
            }

            return config;
        } catch (error) {
            this.recordError('CONFIG_FILE_LOAD_FAILED', error, {filename, filePath});
            throw new Error(`Failed to load configuration file ${filename}: ${error.message}`);
        }
    }

    /**
     * Load configuration from environment variables
     * Environment variables follow the pattern: NGET_SECTION_KEY=value
     * @returns {Object} Configuration object from environment variables
     * @private
     */
    loadEnvironmentVariables() {
        const envConfig = {};
        const prefix = 'NGET_';

        for (const [key, value] of Object.entries(process.env)) {
            if (key.startsWith(prefix)) {
                let configPath = key.slice(prefix.length).toLowerCase().split('_').map(this.toCamelCase);
                
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
            'maxconnections': 'maxConnections',
            'useragent': 'userAgent',
            'keepalive': 'keepAlive',
            'maxsockets': 'maxSockets',
            'maxfreesockets': 'maxFreeSockets',
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
     * @returns {Object} Configuration object from CLI arguments
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
     * @returns {*} Parsed value
     * @private
     */
    parseEnvValue(value) {
        // Boolean values
        if (value.toLowerCase() === 'true') {return true;}
        if (value.toLowerCase() === 'false') {return false;}
        
        // Numeric values
        if (/^\d+$/.test(value)) {return parseInt(value, 10);}
        if (/^\d*\.\d+$/.test(value)) {return parseFloat(value);}
        
        // Array values (comma-separated)
        if (value.includes(',')) {
            return value.split(',').map(v => v.trim());
        }
        
        // String values
        return value;
    }

    /**
     * Set nested value in object using path array
     * @param {Object} obj - Target object
     * @param {string[]} path - Path array
     * @param {*} value - Value to set
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
     * @param {Object[]} configs - Array of configuration objects
     * @returns {Object} Merged configuration
     * @private
     */
    mergeConfigs(configs) {
        return configs.reduce((merged, config) => {
            return this.deepMerge(merged, config || {});
        }, {});
    }

    /**
     * Deep merge two objects
     * @param {Object} target - Target object
     * @param {Object} source - Source object
     * @returns {Object} Merged object
     * @private
     */
    deepMerge(target, source) {
        const result = {...target};
        
        for (const [key, value] of Object.entries(source)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                result[key] = this.deepMerge(result[key] || {}, value);
            } else {
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
        return Joi.object({
            version: Joi.string().required(),
            
            http: Joi.object({
                timeout: Joi.number().min(1000).max(300000).default(30000),
                maxRetries: Joi.number().min(0).max(10).default(3),
                maxConnections: Joi.number().min(1).max(100).default(20),
                userAgent: Joi.string().default('N-Get-Enterprise/2.0'),
                keepAlive: Joi.object({
                    enabled: Joi.boolean().default(true),
                    timeout: Joi.number().min(1000).default(30000),
                    maxSockets: Joi.number().min(1).default(10),
                    maxFreeSockets: Joi.number().min(1).default(5),
                }).default(),
            }).default(),

            downloads: Joi.object({
                maxConcurrent: Joi.number().min(1).max(50).default(3),
                enableResume: Joi.boolean().default(true),
                progressReporting: Joi.boolean().default(true),
                chunkUpdateFrequency: Joi.number().min(100).default(1000),
                chunkSize: Joi.number().min(1).default(50),
            }).default(),

            security: Joi.object({
                maxFileSize: Joi.number().min(1024).default(10737418240),
                allowedProtocols: Joi.array().items(Joi.string()).default(['https', 'http', 'sftp']),
                blockPrivateNetworks: Joi.boolean().default(false),
                blockLocalhost: Joi.boolean().default(false),
                pathTraversalProtection: Joi.boolean().default(true),
                rateLimiting: Joi.object({
                    enabled: Joi.boolean().default(true),
                    requestsPerMinute: Joi.number().min(1).default(100),
                    windowMs: Joi.number().min(1000).default(60000),
                }).default(),
                sanitizeFilenames: Joi.boolean().default(true),
                certificateValidation: Joi.boolean().default(true),
            }).default(),

            logging: Joi.object({
                level: Joi.string().valid('trace', 'debug', 'info', 'warn', 'error').default('info'),
                format: Joi.string().valid('json', 'text').default('json'),
                outputs: Joi.array().items(Joi.string()).default(['console']),
                enableColors: Joi.boolean().default(true),
                rotation: Joi.object({
                    maxFileSize: Joi.number().min(1024).default(10485760),
                    maxFiles: Joi.number().min(1).default(5),
                }).default(),
                structured: Joi.object({
                    includeStackTrace: Joi.boolean().default(true),
                    includePerformance: Joi.boolean().default(true),
                    correlationIds: Joi.boolean().default(true),
                }).default(),
            }).default(),

            monitoring: Joi.object({
                enabled: Joi.boolean().default(true),
                metricsPort: Joi.number().min(1024).max(65535).default(9090),
                healthCheckPort: Joi.number().min(1024).max(65535).default(8080),
                tracingEnabled: Joi.boolean().default(true),
                performanceTracking: Joi.boolean().default(true),
            }).default(),

            ai: Joi.object({
                enabled: Joi.boolean().default(false),
                mcp: Joi.object({
                    enabled: Joi.boolean().default(false),
                    port: Joi.number().min(1024).max(65535).default(8080),
                    host: Joi.string().default('127.0.0.1'),
                }).default(),
                profiles: Joi.object({
                    enabled: Joi.boolean().default(true),
                    learningEnabled: Joi.boolean().default(false),
                }).default(),
            }).default(),

            development: Joi.object({
                hotReload: Joi.boolean().default(true),
                validateOnChange: Joi.boolean().default(true),
                debugMode: Joi.boolean().default(false),
                mockExternalServices: Joi.boolean().default(false),
            }).default(),

            enterprise: Joi.object({
                auditLogging: Joi.boolean().default(false),
                complianceMode: Joi.boolean().default(false),
                encryptedConfig: Joi.boolean().default(false),
                configVersioning: Joi.boolean().default(false),
            }).default(),

            profiles: Joi.object().pattern(Joi.string(), Joi.object()).default({}),
        });
    }

    /**
     * Validate configuration against schema
     * @throws {Error} If validation fails
     * @private
     */
    validateConfiguration() {
        try {
            const {error, value} = this.schema.validate(this.config, {
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

        } catch (error) {
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
     * @returns {Object} Current configuration
     */
    getConfig() {
        return {...this.config};
    }

    /**
     * Get configuration value by path
     * @param {string} path - Configuration path (e.g., 'http.timeout')
     * @param {*} [defaultValue] - Default value if path doesn't exist
     * @returns {*} Configuration value
     */
    get(path, defaultValue) {
        const keys = path.split('.');
        let current = this.config;
        
        for (const key of keys) {
            if (current && typeof current === 'object' && key in current) {
                current = current[key];
            } else {
                return defaultValue;
            }
        }
        
        return current;
    }

    /**
     * Set configuration value by path
     * @param {string} path - Configuration path
     * @param {*} value - Value to set
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
        this.recordConfigurationChange('SET', {path, value});
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
        const previousConfig = {...this.config};
        
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

        } catch (error) {
            // Rollback on error
            this.config = previousConfig;
            this.recordError('PROFILE_APPLICATION_FAILED', error, {profileName});
            throw error;
        }
    }

    /**
     * Record configuration change in history
     * @param {string} type - Change type
     * @param {Object} details - Change details
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
     * @param {Object} [context] - Additional context
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
        if (!this.options.enableHotReload) {return;}

        const configFiles = [
            'default.yaml',
            `${this.options.environment}.yaml`,
            'local.yaml',
        ];

        for (const filename of configFiles) {
            const filePath = path.join(this.options.configDir, filename);
            
            if (fs.existsSync(filePath)) {
                const watcher = fs.watch(filePath, (eventType) => {
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
        } catch (error) {
            this.recordError('RELOAD_FAILED', error);
            this.options.logger.error('Configuration reload failed', error);
        }
    }

    /**
     * Get configuration metrics and statistics
     * @returns {Object} Configuration metrics
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
     * @returns {Object} Available profiles with descriptions
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
     * @returns {Object} Configuration summary for AI agents
     */
    getAIConfigSummary() {
        return {
            currentProfile: this.activeProfile,
            environment: this.options.environment,
            keySettings: {
                maxConcurrentDownloads: this.get('downloads.maxConcurrent'),
                httpTimeout: this.get('http.timeout'),
                maxRetries: this.get('http.maxRetries'),
                maxConnections: this.get('http.maxConnections'),
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
        } else if (validatesCerts && rateLimited) {
            return 'medium';
        } else {
            return 'low';
        }
    }


    /**
     * Learn from successful configurations for AI improvement
     * @param {Object} outcome - Task outcome details
     * @param {boolean} outcome.success - Whether task succeeded
     * @param {number} outcome.duration - Task duration in milliseconds
     * @param {number} outcome.throughput - Average throughput in bytes/sec
     * @param {Object} outcome.errors - Error details
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
     * @returns {Object} Configuration data suitable for AI training
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