/**
 * @fileoverview OpenAPI Specification Service for AI Agent Integration
 * Generates comprehensive OpenAPI 3.0.3 specifications for n-get CLI operations
 * @module OpenAPIService  
 */

const fs = require('node:fs');
const path = require('node:path');

// Load package.json to get version dynamically
const packageJson = require('../../package.json');

/**
 * OpenAPI Service for generating machine-readable API specifications
 * Enables AI agents to understand n-get capabilities through standardized specs
 */
class OpenAPIService {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.configManager = options.configManager;
        this.version = packageJson.version;
        this.capabilitiesService = options.capabilitiesService;
    }

    /**
     * Generate complete OpenAPI 3.0.3 specification for n-get
     * @param {Object} [options={}] - Generation options
     * @param {boolean} [options.includeExamples=true] - Include operation examples
     * @param {boolean} [options.includeSchemas=true] - Include detailed schemas
     * @param {string} [options.format='json'] - Output format (json, yaml)
     * @returns {Object} OpenAPI specification object
     */
    generateSpec(options = {}) {
        const { includeExamples = true, includeSchemas = true, format = 'json' } = options;

        const spec = {
            openapi: '3.0.3',
            info: this.generateInfoSection(),
            servers: this.generateServersSection(),
            paths: this.generatePathsSection(includeExamples),
            components: includeSchemas ? this.generateComponentsSection() : undefined,
            tags: this.generateTagsSection(),
            externalDocs: this.generateExternalDocsSection()
        };

        // Remove undefined sections
        Object.keys(spec).forEach(key => {
            if (spec[key] === undefined) {
                delete spec[key];
            }
        });

        return spec;
    }

    /**
     * Generate OpenAPI info section
     * @returns {Object} Info section
     * @private
     */
    generateInfoSection() {
        return {
            title: 'N-Get Enterprise Download API',
            version: this.version,
            description: `
AI-native download tool with enterprise capabilities for intelligent file management.

## Key Features
- **Multi-protocol Support**: HTTP/HTTPS, SFTP downloads with authentication
- **AI Agent Integration**: Full support for MCP, CrewAI, AutoGen, and LangChain
- **Structured Output**: JSON, YAML, CSV formats for machine processing
- **Intelligent Resume**: Advanced resumption with integrity verification
- **Performance Optimization**: Concurrent downloads with configurable limits
- **Security**: Enterprise-grade validation and access controls
- **Monitoring**: Comprehensive metrics and logging for observability

## AI Agent Capabilities
This API is optimized for AI agent integration with features including:
- **Capabilities Discovery**: Machine-readable feature detection
- **Context Tracking**: Session, request, and conversation ID support
- **Structured Errors**: Detailed error codes with recovery suggestions
- **Metadata Collection**: Rich file and performance metadata
- **Profile Management**: Adaptive configuration profiles (fast, secure, bulk, careful)

## Usage Patterns
- Single file downloads with progress tracking
- Batch operations with concurrent processing
- Recursive downloads with pattern matching
- Resume operations for interrupted transfers
- Configuration management and optimization
            `.trim(),
            contact: {
                name: 'N-Get Support',
                url: packageJson.homepage || 'https://github.com/bingeboy/n-get',
                email: 'support@nget.dev'
            },
            license: {
                name: packageJson.license || 'MIT',
                url: 'https://opensource.org/licenses/MIT'
            },
            'x-api-id': 'n-get-enterprise',
            'x-audience': 'ai-agents',
            'x-maturity': 'stable'
        };
    }

    /**
     * Generate servers section for different environments
     * @returns {Array} Servers array
     * @private
     */
    generateServersSection() {
        return [
            {
                url: 'cli://n-get',
                description: 'Command Line Interface',
                variables: {
                    executable: {
                        default: 'nget',
                        description: 'N-Get executable name'
                    }
                }
            },
            {
                url: 'mcp://n-get-server',
                description: 'Model Context Protocol Server',
                'x-protocol': 'mcp',
                'x-transport': 'stdio'
            }
        ];
    }

    /**
     * Generate comprehensive paths section
     * @param {boolean} includeExamples - Include operation examples
     * @returns {Object} Paths object
     * @private
     */
    generatePathsSection(includeExamples) {
        const paths = {
            '/download': {
                post: {
                    summary: 'Download single or multiple files',
                    description: 'Download files from URLs with advanced options including resume, authentication, and progress tracking',
                    tags: ['Downloads'],
                    operationId: 'downloadFiles',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/DownloadRequest' }
                            }
                        }
                    },
                    responses: {
                        '200': {
                            description: 'Download completed successfully',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/DownloadResponse' }
                                }
                            }
                        },
                        '400': {
                            description: 'Invalid request parameters',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' }
                                }
                            }
                        },
                        '500': {
                            description: 'Download operation failed',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' }
                                }
                            }
                        }
                    }
                }
            },

            '/download/batch': {
                post: {
                    summary: 'Download multiple files concurrently',
                    description: 'Execute batch downloads with intelligent concurrency management and progress tracking',
                    tags: ['Downloads', 'Batch Operations'],
                    operationId: 'batchDownload',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/BatchDownloadRequest' }
                            }
                        }
                    },
                    responses: {
                        '200': {
                            description: 'Batch download results',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/BatchDownloadResponse' }
                                }
                            }
                        }
                    }
                }
            },

            '/download/resume': {
                post: {
                    summary: 'Resume interrupted downloads',
                    description: 'Resume previously interrupted downloads with integrity validation',
                    tags: ['Downloads', 'Resume'],
                    operationId: 'resumeDownloads',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ResumeRequest' }
                            }
                        }
                    },
                    responses: {
                        '200': {
                            description: 'Resume operation results',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/DownloadResponse' }
                                }
                            }
                        }
                    }
                }
            },

            '/download/recursive': {
                post: {
                    summary: 'Recursive website/directory download',
                    description: 'Download entire websites or directory structures with pattern matching',
                    tags: ['Downloads', 'Recursive'],
                    operationId: 'recursiveDownload',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/RecursiveDownloadRequest' }
                            }
                        }
                    },
                    responses: {
                        '200': {
                            description: 'Recursive download results',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/DownloadResponse' }
                                }
                            }
                        }
                    }
                }
            },

            '/config': {
                get: {
                    summary: 'Get current configuration',
                    description: 'Retrieve current n-get configuration with AI-optimized summary',
                    tags: ['Configuration'],
                    operationId: 'getConfiguration',
                    parameters: [
                        {
                            name: 'section',
                            in: 'query',
                            description: 'Specific configuration section to retrieve',
                            schema: {
                                type: 'string',
                                enum: ['http', 'downloads', 'security', 'logging', 'monitoring', 'ai', 'ssh']
                            }
                        },
                        {
                            name: 'format',
                            in: 'query',
                            description: 'Output format',
                            schema: {
                                type: 'string',
                                enum: ['json', 'yaml'],
                                default: 'json'
                            }
                        }
                    ],
                    responses: {
                        '200': {
                            description: 'Configuration data',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ConfigurationResponse' }
                                }
                            }
                        }
                    }
                },
                
                put: {
                    summary: 'Update configuration',
                    description: 'Update n-get configuration settings with validation',
                    tags: ['Configuration'],
                    operationId: 'updateConfiguration',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ConfigurationUpdateRequest' }
                            }
                        }
                    },
                    responses: {
                        '200': {
                            description: 'Configuration updated successfully',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ConfigurationResponse' }
                                }
                            }
                        }
                    }
                }
            },

            '/config/profiles': {
                get: {
                    summary: 'List available configuration profiles',
                    description: 'Get all available configuration profiles with descriptions',
                    tags: ['Configuration', 'Profiles'],
                    operationId: 'getProfiles',
                    responses: {
                        '200': {
                            description: 'Available profiles',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ProfilesResponse' }
                                }
                            }
                        }
                    }
                }
            },

            '/config/profiles/{profileName}': {
                post: {
                    summary: 'Apply configuration profile',
                    description: 'Apply a specific configuration profile (fast, secure, bulk, careful)',
                    tags: ['Configuration', 'Profiles'],
                    operationId: 'applyProfile',
                    parameters: [
                        {
                            name: 'profileName',
                            in: 'path',
                            required: true,
                            description: 'Profile name to apply',
                            schema: {
                                type: 'string',
                                enum: ['fast', 'secure', 'bulk', 'careful']
                            }
                        }
                    ],
                    responses: {
                        '200': {
                            description: 'Profile applied successfully',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ProfileApplicationResponse' }
                                }
                            }
                        }
                    }
                }
            },

            '/capabilities': {
                get: {
                    summary: 'Get tool capabilities for AI agents',
                    description: 'Comprehensive capabilities discovery for AI agent integration',
                    tags: ['AI Integration', 'Discovery'],
                    operationId: 'getCapabilities',
                    parameters: [
                        {
                            name: 'format',
                            in: 'query',
                            description: 'Output format',
                            schema: {
                                type: 'string',
                                enum: ['json', 'yaml'],
                                default: 'json'
                            }
                        },
                        {
                            name: 'detailed',
                            in: 'query',
                            description: 'Include detailed information',
                            schema: {
                                type: 'boolean',
                                default: true
                            }
                        }
                    ],
                    responses: {
                        '200': {
                            description: 'Tool capabilities',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/CapabilitiesResponse' }
                                }
                            }
                        }
                    }
                }
            },

            '/history': {
                get: {
                    summary: 'Get download history',
                    description: 'Retrieve download history with filtering and pagination',
                    tags: ['History', 'Monitoring'],
                    operationId: 'getHistory',
                    parameters: [
                        {
                            name: 'limit',
                            in: 'query',
                            description: 'Maximum number of entries to return',
                            schema: {
                                type: 'integer',
                                minimum: 1,
                                maximum: 1000,
                                default: 50
                            }
                        },
                        {
                            name: 'status',
                            in: 'query',
                            description: 'Filter by download status',
                            schema: {
                                type: 'string',
                                enum: ['success', 'failed', 'in_progress']
                            }
                        },
                        {
                            name: 'since',
                            in: 'query',
                            description: 'Show entries after this date (ISO 8601)',
                            schema: {
                                type: 'string',
                                format: 'date-time'
                            }
                        }
                    ],
                    responses: {
                        '200': {
                            description: 'Download history',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/HistoryResponse' }
                                }
                            }
                        }
                    }
                }
            }
        };

        // Add examples if requested
        if (includeExamples) {
            this.addOperationExamples(paths);
        }

        return paths;
    }

    /**
     * Generate comprehensive components section with schemas
     * @returns {Object} Components object
     * @private
     */
    generateComponentsSection() {
        return {
            schemas: {
                DownloadRequest: {
                    type: 'object',
                    required: ['urls'],
                    properties: {
                        urls: {
                            type: 'array',
                            items: { type: 'string', format: 'uri' },
                            description: 'URLs to download',
                            minItems: 1,
                            maxItems: 100
                        },
                        destination: {
                            type: 'string',
                            description: 'Destination directory or file path'
                        },
                        options: {
                            type: 'object',
                            properties: {
                                maxConcurrent: { type: 'integer', minimum: 1, maximum: 50, default: 3 },
                                enableResume: { type: 'boolean', default: true },
                                timeout: { type: 'integer', minimum: 1000, maximum: 300000, default: 30000 },
                                maxRetries: { type: 'integer', minimum: 0, maximum: 10, default: 3 },
                                outputFormat: { type: 'string', enum: ['json', 'yaml', 'csv', 'text'], default: 'text' },
                                enableMetadata: { type: 'boolean', default: false },
                                enableChecksums: { type: 'boolean', default: true },
                                sessionId: { type: 'string', description: 'Session identifier for tracking' },
                                requestId: { type: 'string', description: 'Request identifier for correlation' },
                                conversationId: { type: 'string', description: 'Conversation identifier for AI agents' },
                                quietMode: { type: 'boolean', default: false }
                            }
                        },
                        authentication: {
                            type: 'object',
                            properties: {
                                sshKey: { type: 'string', description: 'Path to SSH private key' },
                                sshPassword: { type: 'string', description: 'SSH password' },
                                sshPassphrase: { type: 'string', description: 'SSH key passphrase' }
                            }
                        }
                    }
                },

                BatchDownloadRequest: {
                    type: 'object',
                    required: ['downloads'],
                    properties: {
                        downloads: {
                            type: 'array',
                            items: {
                                type: 'object',
                                required: ['url'],
                                properties: {
                                    url: { type: 'string', format: 'uri' },
                                    destination: { type: 'string' }
                                }
                            },
                            minItems: 1,
                            maxItems: 100
                        },
                        options: {
                            type: 'object',
                            properties: {
                                maxConcurrent: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
                                failFast: { type: 'boolean', default: false },
                                progressCallback: { type: 'boolean', default: true }
                            }
                        }
                    }
                },

                RecursiveDownloadRequest: {
                    type: 'object',
                    required: ['url'],
                    properties: {
                        url: { type: 'string', format: 'uri', description: 'Root URL to crawl' },
                        destination: { type: 'string', description: 'Destination directory' },
                        options: {
                            type: 'object',
                            properties: {
                                level: { type: 'integer', minimum: 1, maximum: 50, default: 5 },
                                noParent: { type: 'boolean', default: false },
                                accept: { type: 'array', items: { type: 'string' }, description: 'File patterns to accept' },
                                reject: { type: 'array', items: { type: 'string' }, description: 'File patterns to reject' },
                                userAgent: { type: 'string', default: 'n-get-recursive/1.0' }
                            }
                        }
                    }
                },

                ResumeRequest: {
                    type: 'object',
                    properties: {
                        destination: { type: 'string', description: 'Directory to scan for resumable downloads' },
                        resumeMode: { 
                            type: 'string', 
                            enum: ['all', 'latest', 'specific'], 
                            default: 'latest' 
                        },
                        downloadId: { type: 'string', description: 'Specific download ID to resume' }
                    }
                },

                DownloadResponse: {
                    type: 'object',
                    properties: {
                        operation: { type: 'string', default: 'download' },
                        timestamp: { type: 'string', format: 'date-time' },
                        version: { type: 'string' },
                        summary: {
                            type: 'object',
                            properties: {
                                total: { type: 'integer' },
                                successful: { type: 'integer' },
                                failed: { type: 'integer' },
                                resumed: { type: 'integer' },
                                totalSizeBytes: { type: 'integer' },
                                totalDurationMs: { type: 'number' },
                                averageSpeedBytesPerSecond: { type: 'number' }
                            }
                        },
                        results: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/DownloadResult' }
                        }
                    }
                },

                DownloadResult: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', format: 'uri' },
                        success: { type: 'boolean' },
                        filePath: { type: 'string' },
                        fileName: { type: 'string' },
                        size: {
                            type: 'object',
                            properties: {
                                bytes: { type: 'integer' },
                                megabytes: { type: 'number' },
                                human: { type: 'string' }
                            }
                        },
                        duration: {
                            type: 'object',
                            properties: {
                                milliseconds: { type: 'number' },
                                seconds: { type: 'number' },
                                human: { type: 'string' }
                            }
                        },
                        speed: {
                            type: 'object',
                            properties: {
                                bytesPerSecond: { type: 'number' },
                                megabytesPerSecond: { type: 'number' },
                                human: { type: 'string' }
                            }
                        },
                        resumed: { type: 'boolean' },
                        resumeFromByte: { type: 'integer' },
                        error: { type: 'string', nullable: true },
                        metadata: { type: 'object', nullable: true },
                        integrity: {
                            type: 'object',
                            nullable: true,
                            properties: {
                                checksums: { type: 'object' },
                                verified: { type: 'boolean' }
                            }
                        }
                    }
                },

                ErrorResponse: {
                    type: 'object',
                    properties: {
                        operation: { type: 'string', default: 'error' },
                        timestamp: { type: 'string', format: 'date-time' },
                        version: { type: 'string' },
                        error: {
                            type: 'object',
                            required: ['code', 'message'],
                            properties: {
                                code: { type: 'string' },
                                message: { type: 'string' },
                                userMessage: { type: 'string' },
                                severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                                category: { type: 'string' },
                                isRetryable: { type: 'boolean' },
                                recoveryActions: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            action: { type: 'string' },
                                            params: { type: 'object' }
                                        }
                                    }
                                },
                                timestamp: { type: 'string', format: 'date-time' },
                                helpUrl: { type: 'string', format: 'uri', nullable: true },
                                correlationId: { type: 'string', nullable: true },
                                context: { type: 'object', nullable: true }
                            }
                        }
                    }
                },

                ConfigurationResponse: {
                    type: 'object',
                    properties: {
                        operation: { type: 'string', default: 'config' },
                        timestamp: { type: 'string', format: 'date-time' },
                        version: { type: 'string' },
                        data: { type: 'object' }
                    }
                },

                CapabilitiesResponse: {
                    type: 'object',
                    properties: {
                        tool: { type: 'object' },
                        protocols: { type: 'object' },
                        features: { type: 'object' },
                        authentication: { type: 'object' },
                        output: { type: 'object' },
                        configuration: { type: 'object' },
                        limits: { type: 'object' },
                        agentIntegration: { type: 'object' },
                        reliability: { type: 'object' },
                        cli: { type: 'object' },
                        examples: { type: 'object', nullable: true },
                        schemas: { type: 'object', nullable: true },
                        _metadata: { type: 'object' }
                    }
                }
            },

            parameters: {
                OutputFormat: {
                    name: 'format',
                    in: 'query',
                    description: 'Output format for the response',
                    schema: {
                        type: 'string',
                        enum: ['json', 'yaml', 'csv', 'text'],
                        default: 'json'
                    }
                },
                SessionId: {
                    name: 'session-id',
                    in: 'header',
                    description: 'Session identifier for tracking',
                    schema: { type: 'string' }
                },
                RequestId: {
                    name: 'request-id',
                    in: 'header',
                    description: 'Request identifier for correlation',
                    schema: { type: 'string' }
                }
            }
        };
    }

    /**
     * Generate tags section for operation grouping
     * @returns {Array} Tags array
     * @private
     */
    generateTagsSection() {
        return [
            {
                name: 'Downloads',
                description: 'File download operations'
            },
            {
                name: 'Batch Operations',
                description: 'Multiple file operations with concurrency control'
            },
            {
                name: 'Resume',
                description: 'Resume interrupted downloads with integrity validation'
            },
            {
                name: 'Recursive',
                description: 'Recursive website and directory downloads'
            },
            {
                name: 'Configuration',
                description: 'Configuration management and profiles'
            },
            {
                name: 'Profiles',
                description: 'Configuration profiles (fast, secure, bulk, careful)'
            },
            {
                name: 'AI Integration',
                description: 'AI agent integration and discovery features'
            },
            {
                name: 'Discovery',
                description: 'Tool capability discovery for AI agents'
            },
            {
                name: 'History',
                description: 'Download history and analytics'
            },
            {
                name: 'Monitoring',
                description: 'Performance monitoring and metrics'
            }
        ];
    }

    /**
     * Generate external documentation links
     * @returns {Object} External docs object
     * @private
     */
    generateExternalDocsSection() {
        return {
            description: 'N-Get Documentation',
            url: packageJson.homepage || 'https://github.com/bingeboy/n-get'
        };
    }

    /**
     * Add operation examples to paths
     * @param {Object} paths - Paths object to enhance
     * @private
     */
    addOperationExamples(paths) {
        // Add examples for download operation
        if (paths['/download']?.post) {
            paths['/download'].post.requestBody.content['application/json'].examples = {
                singleFile: {
                    summary: 'Download single file',
                    value: {
                        urls: ['https://example.com/file.zip'],
                        destination: './downloads',
                        options: {
                            enableMetadata: true,
                            outputFormat: 'json'
                        }
                    }
                },
                withSession: {
                    summary: 'Download with AI agent context',
                    value: {
                        urls: ['https://example.com/data.csv'],
                        options: {
                            sessionId: 'sess-123',
                            requestId: 'req-456',
                            conversationId: 'conv-789',
                            enableMetadata: true,
                            enableChecksums: true,
                            outputFormat: 'json'
                        }
                    }
                }
            };
        }

        // Add examples for batch download
        if (paths['/download/batch']?.post) {
            paths['/download/batch'].post.requestBody.content['application/json'].examples = {
                batchDownload: {
                    summary: 'Concurrent batch download',
                    value: {
                        downloads: [
                            { url: 'https://example.com/file1.zip', destination: './downloads/file1.zip' },
                            { url: 'https://example.com/file2.pdf', destination: './downloads/file2.pdf' }
                        ],
                        options: {
                            maxConcurrent: 5,
                            failFast: false,
                            progressCallback: true
                        }
                    }
                }
            };
        }
    }

    /**
     * Format specification output
     * @param {Object} spec - OpenAPI specification object
     * @param {string} format - Output format (json, yaml)
     * @returns {string} Formatted specification
     */
    formatOutput(spec, format = 'json') {
        switch (format.toLowerCase()) {
            case 'json':
                return JSON.stringify(spec, null, 2);
            case 'yaml':
                const yaml = require('js-yaml');
                return yaml.dump(spec, {
                    indent: 2,
                    lineWidth: 120,
                    noRefs: true,
                    sortKeys: false
                });
            default:
                return JSON.stringify(spec, null, 2);
        }
    }

    /**
     * Generate OpenAPI specification and return formatted output
     * @param {Object} options - Generation and formatting options
     * @returns {string} Formatted OpenAPI specification
     */
    generateAndFormat(options = {}) {
        const spec = this.generateSpec(options);
        return this.formatOutput(spec, options.format);
    }

    /**
     * Validate generated specification
     * @param {Object} spec - OpenAPI specification to validate
     * @returns {Object} Validation result
     */
    validateSpec(spec) {
        const errors = [];
        const warnings = [];

        // Basic validation
        if (!spec.openapi) {
            errors.push('Missing required "openapi" field');
        }

        if (!spec.info || !spec.info.title || !spec.info.version) {
            errors.push('Missing required info fields (title, version)');
        }

        if (!spec.paths || Object.keys(spec.paths).length === 0) {
            errors.push('No paths defined');
        }

        // Validate path operations
        Object.entries(spec.paths || {}).forEach(([path, pathItem]) => {
            Object.entries(pathItem).forEach(([method, operation]) => {
                if (!operation.operationId) {
                    warnings.push(`Missing operationId for ${method.toUpperCase()} ${path}`);
                }
                if (!operation.responses) {
                    errors.push(`Missing responses for ${method.toUpperCase()} ${path}`);
                }
            });
        });

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            summary: {
                paths: Object.keys(spec.paths || {}).length,
                operations: this.countOperations(spec.paths || {}),
                schemas: Object.keys(spec.components?.schemas || {}).length
            }
        };
    }

    /**
     * Count total operations in paths
     * @param {Object} paths - Paths object
     * @returns {number} Total operation count
     * @private
     */
    countOperations(paths) {
        return Object.values(paths).reduce((count, pathItem) => {
            return count + Object.keys(pathItem).filter(key => 
                ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace'].includes(key)
            ).length;
        }, 0);
    }
}

module.exports = OpenAPIService;