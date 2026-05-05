/**
 * @fileoverview Enterprise Configuration Manager with YAML support and validation
 * Provides hierarchical configuration loading, validation, and AI agent integration
 * @module ConfigManager
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import Joi from 'joi';
import type { NgetConfig } from '../../types/index.js';

interface ConfigManagerOptions {
    configDir?: string;
    environment?: string;
    enableHotReload?: boolean;
    logger?: {
        info: (msg: string, meta?: unknown) => void;
        debug: (msg: string, meta?: unknown) => void;
        warn: (msg: string, meta?: unknown) => void;
        error: (msg: string, meta?: unknown) => void;
    };
}

interface ConfigChangeRecord {
    timestamp: string;
    type: string;
    details: unknown;
    environment: string;
}

interface ErrorRecord {
    timestamp: string;
    type: string;
    message: string;
    stack: string | undefined;
    context: Record<string, unknown>;
}

interface ConfigMetrics {
    loadCount: number;
    validationCount: number;
    profileSwitches: number;
    errors: ErrorRecord[];
}

/**
 * Enterprise Configuration Manager
 * Handles hierarchical YAML configuration with validation, profiles, and AI integration
 */
class ConfigManager {
    private options: Required<ConfigManagerOptions>;
    private config: Record<string, unknown>;
    private schema: Joi.ObjectSchema | null;
    private watchers: Map<string, fs.FSWatcher>;
    private profiles: Map<string, Record<string, unknown>>;
    private activeProfile: string | null;
    private configHistory: ConfigChangeRecord[];
    private loadTime: Date | null;
    private metrics: ConfigMetrics;

    /**
     * Creates a ConfigManager instance
     * @param {ConfigManagerOptions} [options={}] - Configuration options
     */
    constructor(options: ConfigManagerOptions = {}) {
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
        } as Required<ConfigManagerOptions>;

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
    private initialize(): void {
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
            this.recordError('INITIALIZATION_FAILED', error as Error);
            throw error;
        }
    }

    /**
     * Load configuration from multiple sources with precedence
     * Precedence: CLI args > env vars > local.yaml > {environment}.yaml > default.yaml
     */
    loadConfiguration(): void {
        try {
            const configs: Record<string, unknown>[] = [];

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
            this.recordError('CONFIGURATION_LOAD_FAILED', error as Error);
            throw error;
        }
    }

    /**
     * Load a YAML configuration file
     * @param {string} filename - Configuration filename
     * @returns {Record<string, unknown>|null} Configuration object or null if file doesn't exist
     * @private
     */
    private loadConfigFile(filename: string): Record<string, unknown> | null {
        const filePath = path.join(this.options.configDir, filename);

        try {
            if (!fs.existsSync(filePath)) {
                return null;
            }

            const content = fs.readFileSync(filePath, 'utf8');
            const config = yaml.load(content) as Record<string, unknown>;

            if (process.env.NODE_ENV !== 'test') {
                this.options.logger.debug(`Loaded configuration from ${filename}`, {
                    path: filePath,
                    keys: Object.keys(config || {}),
                });
            }

            return config;
        } catch (error) {
            this.recordError('CONFIG_FILE_LOAD_FAILED', error as Error, {filename, filePath});
            throw new Error(`Failed to load configuration file ${filename}: ${(error as Error).message}`);
        }
    }

    /**
     * Load configuration from environment variables
     * Environment variables follow the pattern: NGET_SECTION_KEY=value
     * @returns {Record<string, unknown>|null} Configuration object from environment variables
     * @private
     */
    private loadEnvironmentVariables(): Record<string, unknown> | null {
        const envConfig: Record<string, unknown> = {};
        const prefix = 'NGET_';

        for (const [key, value] of Object.entries(process.env)) {
            if (key.startsWith(prefix)) {
                let configPath = key.slice(prefix.length).toLowerCase().split('_').map(this.toCamelCase);

                // Special handling for NGET_LOG_* variables to map to logging.*
                if (configPath.length >= 1 && configPath[0] === 'log') {
                    configPath[0] = 'logging';
                }

                this.setNestedValue(envConfig, configPath, this.parseEnvValue(value as string));
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
    private toCamelCase(str: string): string {
        // Handle known mappings for config keys
        const keyMappings: Record<string, string> = {
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
     * @returns {Record<string, unknown>|null} Configuration object from CLI arguments
     * @private
     */
    private loadCommandLineArgs(): Record<string, unknown> | null {
        const args = process.argv.slice(2);
        const cliConfig: Record<string, unknown> = {};

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
    private parseEnvValue(value: string): unknown {
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
     * @param {Record<string, unknown>} obj - Target object
     * @param {string[]} path - Path array
     * @param {unknown} value - Value to set
     * @private
     */
    private setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
        let current: Record<string, unknown> = obj;
        for (let i = 0; i < path.length - 1; i++) {
            if (!(path[i] in current)) {
                current[path[i]] = {};
            }
            current = current[path[i]] as Record<string, unknown>;
        }
        current[path[path.length - 1]] = value;
    }

    /**
     * Deep merge multiple configuration objects
     * @param {Record<string, unknown>[]} configs - Array of configuration objects
     * @returns {Record<string, unknown>} Merged configuration
     * @private
     */
    private mergeConfigs(configs: Record<string, unknown>[]): Record<string, unknown> {
        return configs.reduce((merged, config) => {
            return this.deepMerge(merged, config || {});
        }, {} as Record<string, unknown>);
    }

    /**
     * Deep merge two objects
     * @param {Record<string, unknown>} target - Target object
     * @param {Record<string, unknown>} source - Source object
     * @returns {Record<string, unknown>} Merged object
     * @private
     */
    private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
        const result = {...target};

        for (const [key, value] of Object.entries(source)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                result[key] = this.deepMerge((result[key] || {}) as Record<string, unknown>, value as Record<string, unknown>);
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
    private createValidationSchema(): Joi.ObjectSchema {
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
    private validateConfiguration(): void {
        try {
            const {error, value} = this.schema!.validate(this.config, {
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
            this.recordError('VALIDATION_ERROR', error as Error);
            throw error;
        }
    }

    /**
     * Load configuration profiles
     * @private
     */
    private loadProfiles(): void {
        if (this.config.profiles) {
            for (const [name, profileConfig] of Object.entries(this.config.profiles as Record<string, Record<string, unknown>>)) {
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
    getConfig(): NgetConfig {
        return {...this.config} as unknown as NgetConfig;
    }

    /**
     * Get configuration value by path
     * @param {string} path - Configuration path (e.g., 'http.timeout')
     * @param {unknown} [defaultValue] - Default value if path doesn't exist
     * @returns {unknown} Configuration value
     */
    get(path: string, defaultValue?: unknown): unknown {
        const keys = path.split('.');
        let current: unknown = this.config;

        for (const key of keys) {
            if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
                current = (current as Record<string, unknown>)[key];
            } else {
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
    set(path: string, value: unknown): void {
        const keys = path.split('.');
        let current: Record<string, unknown> = this.config;

        for (let i = 0; i < keys.length - 1; i++) {
            if (!(keys[i] in current)) {
                current[keys[i]] = {};
            }
            current = current[keys[i]] as Record<string, unknown>;
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
    async applyProfile(profileName: string): Promise<void> {
        if (!this.profiles.has(profileName)) {
            throw new Error(`Profile '${profileName}' not found`);
        }

        const profile = this.profiles.get(profileName)!;
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
            this.recordError('PROFILE_APPLICATION_FAILED', error as Error, {profileName});
            throw error;
        }
    }

    /**
     * Record configuration change in history
     * @param {string} type - Change type
     * @param {unknown} details - Change details
     * @private
     */
    private recordConfigurationChange(type: string, details: unknown): void {
        const change: ConfigChangeRecord = {
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
    private recordError(type: string, error: Error, context: Record<string, unknown> = {}): void {
        const errorRecord: ErrorRecord = {
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
    private setupHotReload(): void {
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
    reloadConfiguration(): void {
        try {
            if (process.env.NODE_ENV !== 'test') {
                this.options.logger.info('Reloading configuration...');
            }
            this.loadConfiguration();
            if (process.env.NODE_ENV !== 'test') {
                this.options.logger.info('Configuration reloaded successfully');
            }
        } catch (error) {
            this.recordError('RELOAD_FAILED', error as Error);
            this.options.logger.error('Configuration reload failed', error);
        }
    }

    /**
     * Get configuration metrics and statistics
     * @returns {object} Configuration metrics
     */
    getMetrics(): Record<string, unknown> {
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
    getAvailableProfiles(): Record<string, unknown> {
        const profiles: Record<string, unknown> = {};
        for (const [name, profile] of this.profiles.entries()) {
            profiles[name] = {
                name,
                description: (profile as Record<string, unknown>).description || `Configuration profile: ${name}`,
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
    getAIConfigSummary(): Record<string, unknown> {
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
    private getSecurityLevel(): string {
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
     * @param {object} outcome - Task outcome details
     */
    learnFromOutcome(outcome: { success: boolean; duration: number; throughput: number; errors?: unknown }): void {
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
    exportForAITraining(): Record<string, unknown> {
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
    cleanup(): void {
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

export = ConfigManager;
