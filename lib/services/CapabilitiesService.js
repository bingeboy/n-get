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
            cli: this.getCliCapabilities(),

            // Discovery surfaces and event contract
            discovery: this.getDiscoveryInfo()
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
            description: packageJson.description || 'Observable downloads for AI agents.',
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
                mcp: 'supported',
                openai: 'compatible',
                anthropic: 'compatible',
                crewai: 'compatible',
                autogen: 'compatible'
            },
            discovery: {
                capabilities: true,
                openapi: 'supported',
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
     * Get discovery surface information for AI agents
     * @private
     */
    getDiscoveryInfo() {
        return {
            help:         { command: 'nget --help',         description: 'Human-readable usage text with flag list and examples' },
            capabilities: { command: 'nget --capabilities', description: 'This document. Machine-readable JSON spec of every flag, event, and config key' },
            openapi:      { command: 'nget --openapi-spec', description: 'OpenAPI 3.0.3 contract for HTTP-style tooling' },
            mcp:          { command: 'nget-mcp',            description: 'MCP server entry point exposing download_file, batch_download, get_jobs, get_capabilities' },
            ndjsonEvents: [
                'session_start',
                'download_queued',
                'download_start',
                'progress',
                'checksum_start',
                'checksum_complete',
                'download_complete',
                'download_error',
                'session_end'
            ],
            outputModes: {
                tty:        'progress bars and banners on stderr; final summary on stdout',
                nonTty:     'NDJSON event stream on stdout (one JSON object per line)',
                forceHuman: 'use --human to force tty-style output regardless of stdout'
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
            },
            canonical: [
                { description: 'Download a single file',                                command: 'nget https://example.com/file.zip' },
                { description: 'Download many files concurrently to a directory',       command: 'nget url1 url2 url3 -d ./downloads --max-concurrent 5' },
                { description: 'Read URLs from stdin',                                  command: 'cat urls.txt | nget -i - -d ./downloads' },
                { description: 'SFTP download with explicit key',                       command: 'nget sftp://user@server/path/file.zip --ssh-key ~/.ssh/id_rsa' },
                { description: 'List active sessions across all agents (NDJSON)',       command: 'nget jobs' }
            ]
        };
    }

    /**
     * Render an agent-targeted Markdown summary of capabilities.
     *
     * Single source of truth: this method derives entirely from
     * getCapabilities(). The output is shipped as AGENTS.md and printed
     * by `nget instructions` so an agent has a complete one-shot doc
     * with no docs/* read or network call required.
     *
     * @returns {string} Markdown content
     */
    toMarkdown() {
        const cap = this.getCapabilities({ detailed: true });
        const t = cap.tool || {};
        const d = cap.discovery || {};
        const examples = (cap.examples && cap.examples.canonical) || [];
        const protocols = (cap.protocols && cap.protocols.supported) || [];
        const events = d.ndjsonEvents || [];

        const lines = [];

        lines.push(`# ${t.name || 'n-get'} — Agent Instructions`);
        lines.push('');
        lines.push(`**Version:** ${t.version || ''} · **License:** ${t.license || ''} · **Node:** >= 18`);
        lines.push('');
        lines.push(t.description || 'Observable downloads for AI agents.');
        lines.push('');
        lines.push('Auto-generated from `CapabilitiesService.toMarkdown()` — single source of truth. To regenerate run `npm run build:docs`.');
        lines.push('');

        lines.push('## Quick start');
        lines.push('');
        for (const ex of examples) {
            lines.push(`- ${ex.description}`);
            lines.push('  ```bash');
            lines.push(`  ${ex.command}`);
            lines.push('  ```');
        }
        lines.push('');

        lines.push('## Discovery surfaces');
        lines.push('');
        lines.push('Run any of these to introspect the tool — no docs required:');
        lines.push('');
        lines.push('| Surface | Command | Returns |');
        lines.push('|---|---|---|');
        for (const key of ['help', 'capabilities', 'openapi', 'mcp']) {
            const s = d[key];
            if (!s) continue;
            lines.push(`| ${key} | \`${s.command}\` | ${s.description} |`);
        }
        lines.push('');

        lines.push('## NDJSON event stream');
        lines.push('');
        lines.push('When stdout is not a TTY, `nget` writes one JSON object per line. Output modes:');
        lines.push('');
        if (d.outputModes) {
            lines.push(`- **TTY** — ${d.outputModes.tty}`);
            lines.push(`- **non-TTY** — ${d.outputModes.nonTty}`);
            lines.push(`- **\`--human\`** — ${d.outputModes.forceHuman}`);
            lines.push('');
        }
        if (events.length) {
            lines.push('### Event types');
            lines.push('');
            for (const e of events) {
                lines.push(`- \`${e}\``);
            }
            lines.push('');
            lines.push('Run `nget --capabilities | jq .schemas` for full per-event field schemas.');
            lines.push('');
        }

        if (protocols.length) {
            lines.push('## Protocols');
            lines.push('');
            lines.push(`Supported: ${protocols.map(p => `\`${p}\``).join(', ')}.`);
            lines.push('');
        }

        lines.push('## Programmatic API');
        lines.push('');
        lines.push('```javascript');
        lines.push("const nget = require('n-get');");
        lines.push('');
        lines.push('// Library exports — all derived from CapabilitiesService:');
        lines.push('nget.capabilities;   // same JSON as `nget --capabilities`');
        lines.push('nget.openapi;        // same OpenAPI as `nget --openapi-spec`');
        lines.push('nget.instructions;   // this Markdown content as a string');
        lines.push('nget.version;        // package.json version');
        lines.push('');
        lines.push('// HTTP fetch (axios-compatible response):');
        lines.push("const r = await nget.fetch('https://api.example.com/data.json');");
        lines.push('// r.data, r.status, r.headers, r.ok');
        lines.push('```');
        lines.push('');

        lines.push('## MCP integration');
        lines.push('');
        lines.push('`nget-mcp` is the bundled MCP server. Add to a Claude Desktop config:');
        lines.push('');
        lines.push('```json');
        lines.push('{');
        lines.push('  "mcpServers": {');
        lines.push('    "n-get": { "command": "nget-mcp" }');
        lines.push('  }');
        lines.push('}');
        lines.push('```');
        lines.push('');
        lines.push('Tools exposed: `download_file`, `batch_download`, `get_jobs`, `get_capabilities`.');
        lines.push('');

        lines.push('---');
        lines.push('');
        lines.push('For the complete machine-readable contract: `nget --capabilities` (JSON) or `nget --openapi-spec` (OpenAPI 3.0.3).');
        lines.push('');

        return lines.join('\n');
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