/**
 * @fileoverview Capabilities Service for AI Agent Discovery
 * Provides comprehensive information about n-get's features and capabilities
 * @module CapabilitiesService
 */

const fs = require('node:fs');
const path = require('node:path');

// Load package.json to get version and dependencies
const packageJson = require('../../package.json');

/**
 * Capabilities Service for exposing n-get features to AI agents
 * Provides machine-readable information about what n-get can do
 */
class CapabilitiesService {
    constructor(options = {}) {
        this.configManager = options.configManager;
        this.logger = options.logger || console;
        this.version = packageJson.version;
    }

    /**
     * Get comprehensive capabilities information
     * @param {Object} [options={}] - Options for capability reporting
     * @param {string} [options.format='json'] - Output format (json, yaml)
     * @param {boolean} [options.detailed=true] - Include detailed information
     * @returns {Object} Capabilities object
     */
    getCapabilities(options = {}) {
        const { format = 'json', detailed = true } = options;
        
        const capabilities = {
            // Basic tool information
            tool: this.getToolInfo(),
            
            // Protocol and network capabilities
            protocols: this.getProtocolCapabilities(),
            
            // Download and file handling features
            features: this.getFeatureCapabilities(),
            
            // Authentication methods
            authentication: this.getAuthenticationCapabilities(),
            
            // Output and integration options
            output: this.getOutputCapabilities(),
            
            // Configuration and profiles
            configuration: this.getConfigurationCapabilities(),
            
            // Performance and limits
            limits: this.getLimitsCapabilities(),
            
            // Agent integration specific features
            agentIntegration: this.getAgentIntegrationCapabilities(),
            
            // Error handling and reliability
            reliability: this.getReliabilityCapabilities(),
            
            // CLI interface details
            cli: this.getCliCapabilities()
        };

        if (detailed) {
            capabilities.examples = this.getUsageExamples();
            capabilities.schemas = this.getSchemas();
        }

        // Add metadata about this capability report
        capabilities._metadata = {
            generatedAt: new Date().toISOString(),
            format,
            detailed,
            reportVersion: '1.0.0'
        };

        return capabilities;
    }

    /**
     * Get basic tool information
     * @private
     */
    getToolInfo() {
        return {
            name: 'n-get',
            version: this.version,
            description: 'Enterprise-grade download tool with AI agent integration',
            homepage: packageJson.homepage || 'https://github.com/bingeboy/n-get',
            license: packageJson.license || 'MIT',
            author: packageJson.author || 'bingeboy',
            nodeVersion: process.version,
            platform: process.platform,
            architecture: process.arch,
            dependencies: this.getKeyDependencies()
        };
    }

    /**
     * Get protocol capabilities
     * @private
     */
    getProtocolCapabilities() {
        return {
            supported: ['http', 'https', 'sftp'],
            http: {
                versions: ['1.1', '2.0'],
                methods: ['GET', 'HEAD'],
                features: [
                    'range_requests',
                    'keep_alive',
                    'compression',
                    'redirects',
                    'ipv6',
                    'ssl_verification'
                ],
                maxRedirects: 10,
                defaultTimeout: 30000,
                maxTimeout: 300000
            },
            https: {
                versions: ['1.1', '2.0'],
                tlsVersions: ['1.2', '1.3'],
                certificateValidation: true,
                features: [
                    'range_requests',
                    'keep_alive',
                    'compression',
                    'redirects',
                    'ipv6',
                    'hsts'
                ]
            },
            sftp: {
                versions: ['2'],
                authentication: ['password', 'publickey', 'keyboard-interactive'],
                features: [
                    'resume',
                    'directory_listing',
                    'file_stats',
                    'large_files'
                ],
                keyFormats: ['rsa', 'ed25519', 'ecdsa'],
                algorithms: this.getSftpAlgorithms()
            }
        };
    }

    /**
     * Get feature capabilities
     * @private
     */
    getFeatureCapabilities() {
        return {
            download: {
                singleFile: true,
                multipleFiles: true,
                recursiveDownload: true,
                batchDownload: true,
                concurrentDownloads: true,
                maxConcurrent: 50
            },
            resume: {
                supported: true,
                protocols: ['http', 'https', 'sftp'],
                validation: ['etag', 'last-modified', 'content-length'],
                integrityChecking: true
            },
            progress: {
                realTime: true,
                progressBars: true,
                speedCalculation: true,
                etaCalculation: true,
                quietMode: true
            },
            fileHandling: {
                largeFiles: true,
                maxFileSize: '10GB',
                streaming: true,
                checksums: ['md5', 'sha256', 'sha1'],
                duplicateHandling: 'rename',
                pathSanitization: true
            },
            networking: {
                ipv4: true,
                ipv6: true,
                dualStack: true,
                connectionPooling: true,
                keepAlive: true,
                rateLimiting: true,
                retryLogic: true,
                maxRetries: 10
            }
        };
    }

    /**
     * Get authentication capabilities
     * @private
     */
    getAuthenticationCapabilities() {
        return {
            http: {
                methods: ['none'],
                customHeaders: true,
                userAgent: true
            },
            https: {
                methods: ['none'],
                customHeaders: true,
                userAgent: true,
                certificateValidation: true
            },
            sftp: {
                methods: ['password', 'publickey', 'keyboard-interactive'],
                keyFiles: [
                    '~/.ssh/id_rsa',
                    '~/.ssh/id_ed25519',
                    '~/.ssh/id_ecdsa'
                ],
                passphraseSupport: true,
                agentForwarding: false
            }
        };
    }

    /**
     * Get output capabilities
     * @private
     */
    getOutputCapabilities() {
        return {
            formats: ['text', 'json', 'yaml', 'csv'],
            destinations: ['file', 'stdout', 'directory'],
            structured: true,
            metadata: {
                enhanced: true,
                checksums: true,
                performance: true,
                httpHeaders: true,
                fileInfo: true
            },
            logging: {
                formats: ['text', 'json', 'csv'],
                levels: ['trace', 'debug', 'info', 'warn', 'error'],
                destinations: ['console', 'file'],
                structured: true,
                correlationIds: true
            }
        };
    }

    /**
     * Get configuration capabilities
     * @private
     */
    getConfigurationCapabilities() {
        const config = this.configManager ? this.configManager.getConfig() : {};
        
        return {
            sources: ['file', 'environment', 'cli'],
            formats: ['yaml'],
            profiles: {
                supported: true,
                available: this.configManager ? 
                    Object.keys(this.configManager.getAvailableProfiles()) : 
                    ['fast', 'secure', 'bulk', 'careful'],
                switchable: true
            },
            hotReload: true,
            validation: true,
            sections: [
                'http',
                'downloads', 
                'security',
                'logging',
                'monitoring',
                'ai',
                'ssh'
            ],
            environmentVariables: {
                prefix: 'NGET_',
                examples: [
                    'NGET_HTTP_TIMEOUT=60000',
                    'NGET_DOWNLOADS_MAX_CONCURRENT=5',
                    'NGET_LOG_FORMAT=json'
                ]
            }
        };
    }

    /**
     * Get limits and constraints
     * @private
     */
    getLimitsCapabilities() {
        const config = this.configManager ? this.configManager.getConfig() : {};
        
        return {
            files: {
                maxFileSize: config.security?.maxFileSize || '10GB',
                maxFileSizeBytes: config.security?.maxFileSize || 10737418240,
                maxConcurrent: config.downloads?.maxConcurrent || 50,
                noLimit: false
            },
            network: {
                maxConnections: config.http?.maxConnections || 100,
                maxRetries: config.http?.maxRetries || 10,
                timeoutRange: {
                    min: 1000,
                    max: 300000,
                    default: 30000
                },
                rateLimiting: {
                    enabled: config.security?.rateLimiting?.enabled || true,
                    requestsPerMinute: config.security?.rateLimiting?.requestsPerMinute || 100
                }
            },
            recursion: {
                maxDepth: 50,
                defaultDepth: 5,
                noParentRestriction: true
            },
            storage: {
                tempSpace: 'unlimited',
                metadataStorage: '100MB',
                historyEntries: 10000
            }
        };
    }

    /**
     * Get AI agent integration capabilities
     * @private
     */
    getAgentIntegrationCapabilities() {
        return {
            contextTracking: {
                sessionId: true,
                requestId: true,
                conversationId: true,
                customMetadata: true
            },
            structuredOutput: {
                json: true,
                yaml: true,
                csv: true,
                schemas: true
            },
            eventDriven: {
                webhooks: false, // TODO: implement
                callbacks: false, // TODO: implement
                progressEvents: true
            },
            compatibility: {
                mcp: 'planned',
                openai: 'compatible',
                anthropic: 'compatible',
                crewai: 'compatible',
                autogen: 'compatible'
            },
            discovery: {
                capabilities: true,
                openapi: false, // TODO: implement
                examples: true,
                schemas: true
            },
            errorHandling: {
                structuredErrors: true,
                errorCodes: true,
                suggestions: true,
                recoverability: true
            }
        };
    }

    /**
     * Get reliability capabilities
     * @private
     */
    getReliabilityCapabilities() {
        return {
            retryLogic: {
                exponentialBackoff: true,
                jitter: true,
                maxRetries: 10,
                customizable: true
            },
            resumption: {
                automatic: true,
                validation: true,
                crossSession: true,
                metadata: true
            },
            errorRecovery: {
                networkErrors: true,
                partialDownloads: true,
                corrupted: true,
                timeouts: true
            },
            monitoring: {
                progress: true,
                performance: true,
                health: true,
                metrics: true
            }
        };
    }

    /**
     * Get CLI interface capabilities
     * @private
     */
    getCliCapabilities() {
        return {
            interface: {
                posix: true,
                gnu: true,
                pipes: true,
                stdin: true,
                stdout: true
            },
            options: {
                short: true,
                long: true,
                bundling: true,
                equals: true
            },
            help: {
                builtin: true,
                detailed: true,
                examples: true,
                structured: false // TODO: implement
            },
            completion: {
                bash: false, // TODO: implement
                zsh: false,  // TODO: implement
                fish: false  // TODO: implement
            },
            colors: {
                automatic: true,
                forceable: true,
                disableable: true
            }
        };
    }

    /**
     * Get usage examples for agents
     * @private
     */
    getUsageExamples() {
        return {
            basic: {
                singleFile: 'nget https://example.com/file.zip',
                withDestination: 'nget https://example.com/file.zip -d ./downloads',
                stdout: 'nget https://example.com/data.json -o -'
            },
            agent: {
                withMetadata: 'nget https://example.com/file.zip --metadata --output-format json',
                withContext: 'nget https://example.com/file.zip --session-id sess123 --request-id req456',
                structured: 'nget https://example.com/file.zip --output-format json --checksums'
            },
            batch: {
                multiple: 'nget https://example.com/file1.zip https://example.com/file2.zip',
                concurrent: 'nget https://example.com/file1.zip https://example.com/file2.zip --max-concurrent 5',
                fromFile: 'nget --input-file urls.txt'
            },
            advanced: {
                recursive: 'nget -R https://example.com/gallery/ --level 3',
                resume: 'nget resume all',
                sftp: 'nget sftp://user@server.com/file.zip --ssh-key ~/.ssh/id_rsa'
            }
        };
    }

    /**
     * Get schema information for structured outputs
     * @private
     */
    getSchemas() {
        return {
            downloadResult: {
                type: 'object',
                properties: {
                    url: { type: 'string', format: 'uri' },
                    filePath: { type: 'string' },
                    size: { type: 'integer', minimum: 0 },
                    duration: { type: 'number', minimum: 0 },
                    speed: { type: 'number', minimum: 0 },
                    success: { type: 'boolean' },
                    metadata: { type: 'object' },
                    error: { type: 'string' }
                },
                required: ['url', 'success']
            },
            metadata: {
                type: 'object',
                properties: {
                    url: { type: 'string', format: 'uri' },
                    filePath: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    file: { type: 'object' },
                    http: { type: 'object' },
                    performance: { type: 'object' },
                    integrity: { type: 'object' }
                }
            },
            error: {
                type: 'object',
                properties: {
                    code: { type: 'string' },
                    message: { type: 'string' },
                    userMessage: { type: 'string' },
                    details: { type: 'object' },
                    timestamp: { type: 'string', format: 'date-time' }
                },
                required: ['code', 'message']
            }
        };
    }

    /**
     * Get key dependencies info
     * @private
     */
    getKeyDependencies() {
        const deps = packageJson.dependencies || {};
        return {
            'node-fetch': deps['node-fetch'],
            'ssh2': deps['ssh2'],
            'joi': deps['joi'],
            'js-yaml': deps['js-yaml'],
            'minimist': deps['minimist']
        };
    }

    /**
     * Get SFTP algorithm capabilities
     * @private
     */
    getSftpAlgorithms() {
        return {
            kex: [
                'ecdh-sha2-nistp256',
                'ecdh-sha2-nistp384', 
                'ecdh-sha2-nistp521',
                'diffie-hellman-group14-sha256'
            ],
            serverHostKey: [
                'rsa-sha2-512',
                'rsa-sha2-256',
                'ssh-rsa',
                'ecdsa-sha2-nistp256'
            ],
            cipher: [
                'aes128-gcm',
                'aes256-gcm',
                'aes128-ctr',
                'aes256-ctr'
            ],
            hmac: [
                'hmac-sha2-256',
                'hmac-sha2-512',
                'hmac-sha1'
            ]
        };
    }

    /**
     * Format capabilities output
     * @param {Object} capabilities - Capabilities object
     * @param {string} format - Output format
     * @returns {string} Formatted output
     */
    formatOutput(capabilities, format = 'json') {
        switch (format.toLowerCase()) {
            case 'json':
                return JSON.stringify(capabilities, null, 2);
            case 'yaml':
                const yaml = require('js-yaml');
                return yaml.dump(capabilities, { 
                    indent: 2,
                    lineWidth: 120,
                    noRefs: true
                });
            default:
                return JSON.stringify(capabilities, null, 2);
        }
    }
}

module.exports = CapabilitiesService;