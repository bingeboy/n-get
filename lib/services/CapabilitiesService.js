"use strict";
/**
 * @fileoverview Capabilities Service for AI Agent Discovery
 * Provides comprehensive information about n-get's features and capabilities
 * @module CapabilitiesService
 */
// Load package.json to get version and dependencies
const packageJson = require('../../package.json');
/**
 * Capabilities Service for exposing n-get features to AI agents
 * Provides machine-readable information about what n-get can do
 */
class CapabilitiesService {
    configManager;
    logger;
    version;
    constructor(options = {}) {
        this.configManager = options.configManager;
        this.logger = options.logger || console;
        this.version = packageJson.version;
    }
    /**
     * Get comprehensive capabilities information
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
     */
    getConfigurationCapabilities() {
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
                webhooks: {
                    supported: true,
                    signing: 'hmac-sha256',
                    signatureHeader: 'X-NGet-Signature',
                    signatureFormat: 'sha256=<hex>',
                },
                callbacks: false,
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
     */
    getCliCapabilities() {
        return {
            flags: this.getCLIFlags(),
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
                structured: true
            },
            completion: {
                bash: false, // TODO: implement
                zsh: false, // TODO: implement
                fish: false // TODO: implement
            },
            colors: {
                automatic: true,
                forceable: true,
                disableable: true
            }
        };
    }
    /**
     * Get the structured list of CLI flags.
     * Single source of truth for flag definitions — consumed by
     * getCliCapabilities() and toHelpSummary().
     */
    getCLIFlags() {
        return [
            // general
            { short: 'd', long: 'destination', arg: '<path>', description: 'Destination directory for downloads', group: 'general' },
            { short: 'r', long: 'resume', description: 'Enable resume for interrupted downloads (default: true)', group: 'general' },
            { long: 'no-resume', description: 'Disable resume functionality', group: 'general' },
            { short: 'l', long: 'list-resume', description: 'List resumable downloads in destination', group: 'general' },
            { short: 'c', long: 'max-concurrent', arg: '<num>', description: 'Maximum concurrent downloads (default: 3)', group: 'general' },
            { short: 'h', long: 'help', description: 'Show this help message', group: 'general' },
            { long: 'human', description: 'Force human-readable output (progress bars + banners)', group: 'general' },
            { long: 'capabilities', description: 'Show tool capabilities for AI agents (JSON/YAML)', group: 'general' },
            { long: 'openapi-spec', description: 'Generate OpenAPI 3.0.3 specification for AI agents', group: 'general' },
            // pipe
            { short: 'i', long: 'input-file', arg: '<file>', description: "Read URLs from file (use '-' for stdin)", group: 'pipe' },
            { short: 'o', long: 'output-file', arg: '<file>', description: "Write output to file (use '-' for stdout)", group: 'pipe' },
            { short: 'q', long: 'quiet', description: 'Suppress progress output (useful for piping)', group: 'pipe' },
            // recursive
            { short: 'R', long: 'recursive', description: 'Enable recursive downloading (follow links)', group: 'recursive' },
            { long: 'level', arg: '<depth>', description: 'Maximum recursion depth (default: 5)', group: 'recursive' },
            { long: 'no-parent', description: "Don't ascend to parent directories", group: 'recursive' },
            { short: 'A', long: 'accept', arg: '<patterns>', description: 'Comma-separated list of accepted file patterns', group: 'recursive' },
            { short: 'j', long: 'reject', arg: '<patterns>', description: 'Comma-separated list of rejected file patterns', group: 'recursive' },
            { long: 'user-agent', arg: '<string>', description: 'Set custom User-Agent for crawling', group: 'recursive' },
            // ssh
            { long: 'ssh-key', arg: '<path>', description: 'Path to SSH private key file', group: 'ssh' },
            { long: 'ssh-password', arg: '<password>', description: 'SSH password (use with caution)', group: 'ssh' },
            { long: 'ssh-passphrase', arg: '<phrase>', description: 'Passphrase for encrypted SSH key', group: 'ssh' },
            // agent
            { long: 'metadata', description: 'Include enhanced metadata in output', group: 'agent' },
            { long: 'checksums', description: 'Generate file checksums (default: true)', group: 'agent' },
            { long: 'no-checksums', description: 'Disable checksum generation', group: 'agent' },
            { long: 'output-format', arg: '<format>', description: 'Output format: json, yaml, csv, text (default: text)', group: 'agent' },
            { long: 'session-id', arg: '<id>', description: 'Session identifier for tracking', group: 'agent' },
            { long: 'agent-id', arg: '<id>', description: 'Agent identifier (set by calling agent)', group: 'agent' },
            { long: 'request-id', arg: '<id>', description: 'Request identifier for correlation', group: 'agent' },
            { long: 'conversation-id', arg: '<id>', description: 'Conversation identifier for AI agents', group: 'agent' },
            // webhook
            { long: 'webhook', arg: '<url>', description: 'POST all NDJSON events to this URL (repeatable)', group: 'webhook' },
            { long: 'webhook-header', arg: '<header>', description: "Extra header for all webhook POSTs, e.g. 'Authorization: Bearer ...' (repeatable)", group: 'webhook' },
            { long: 'webhook-events', arg: '<list>', description: 'Comma-separated event types to POST (default: all)', group: 'webhook' },
            { long: 'webhook-secret', arg: '<secret>', description: 'HMAC-SHA256 secret — adds X-NGet-Signature: sha256=<hex> to every webhook POST', group: 'webhook' },
            // agent-card
            { long: 'agent-card', description: 'Print A2A 0.3.0 agent card as JSON and exit', group: 'agent' },
        ];
    }
    /**
     * Get discovery surface information for AI agents
     */
    getDiscoveryInfo() {
        return {
            help: { command: 'nget --help', description: 'Human-readable usage text with flag list and examples' },
            capabilities: { command: 'nget --capabilities', description: 'This document. Machine-readable JSON spec of every flag, event, and config key' },
            openapi: { command: 'nget --openapi-spec', description: 'OpenAPI 3.0.3 contract for HTTP-style tooling' },
            mcp: { command: 'nget-mcp', description: 'MCP server entry point exposing download_file, batch_download, get_jobs, get_capabilities' },
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
                tty: 'progress bars and banners on stderr; final summary on stdout',
                nonTty: 'NDJSON event stream on stdout (one JSON object per line)',
                forceHuman: 'use --human to force tty-style output regardless of stdout'
            },
            webhooks: {
                flag: '--webhook <url>',
                repeatable: true,
                description: 'POST each NDJSON event as JSON to the given URL (fire-and-forget, 2 s timeout). Repeat for multiple receivers. Filter with --webhook-events.',
                filterFlag: '--webhook-events <comma-list>',
                authFlag: '--webhook-header "Name: value"',
                signing: 'hmac-sha256',
                signingFlag: '--webhook-secret <secret>',
                signatureHeader: 'X-NGet-Signature',
                events: [
                    'session_start', 'download_queued', 'download_start', 'progress',
                    'checksum_start', 'checksum_complete', 'download_complete',
                    'download_error', 'session_end',
                    'fetch_start', 'fetch_complete', 'fetch_error'
                ]
            },
            a2a: {
                command: 'nget --agent-card',
                description: 'A2A 1.0 agent card (JSON). Describes n-get skills and transport for A2A-compatible orchestrators.',
                protocolVersion: '1.0',
            }
        };
    }
    /**
     * Get usage examples for agents
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
                { description: 'Download a single file', command: 'nget https://example.com/file.zip' },
                { description: 'Download many files concurrently to a directory', command: 'nget url1 url2 url3 -d ./downloads --max-concurrent 5' },
                { description: 'Read URLs from stdin', command: 'cat urls.txt | nget -i - -d ./downloads' },
                { description: 'SFTP download with explicit key', command: 'nget sftp://user@server/path/file.zip --ssh-key ~/.ssh/id_rsa' },
                { description: 'List active sessions across all agents (NDJSON)', command: 'nget jobs' },
                { description: 'HTTP fetch with structured JSON output', command: 'nget fetch https://api.example.com/data' },
                { description: 'HTTP POST with body and agent tracking', command: 'nget fetch --method POST --data \'{"key":"val"}\' --agent-id my-agent https://api.example.com/endpoint' }
            ]
        };
    }
    /**
     * Build an A2A 0.3.0 agent card for n-get.
     *
     * @param endpointUrl - Optional URL where the A2A endpoint is hosted.
     *   Falls back to 'https://your-host/a2a' as a placeholder.
     */
    toA2ACard(endpointUrl) {
        return {
            id: 'n-get',
            name: 'n-get',
            description: 'Observable downloads for AI agents — NDJSON event stream, webhook forwarding, HTTP + SFTP.',
            version: this.version,
            protocolVersion: '1.0',
            url: endpointUrl || 'https://your-host/a2a',
            interfaces: ['JSONRPC'],
            capabilities: { streaming: true },
            defaultInputModes: ['application/json'],
            defaultOutputModes: ['application/json', 'text/event-stream'],
            skills: [
                {
                    id: 'download',
                    name: 'Download File',
                    description: 'Download a file over HTTP/HTTPS or SFTP with streaming NDJSON events, resume support, and checksum verification.',
                    tags: ['file-transfer', 'http', 'sftp', 'streaming', 'observable'],
                },
                {
                    id: 'batch_download',
                    name: 'Batch Download',
                    description: 'Download multiple URLs concurrently with per-file progress events and a session summary.',
                    tags: ['file-transfer', 'batch', 'concurrent', 'observable'],
                },
                {
                    id: 'fetch',
                    name: 'Fetch HTTP API',
                    description: 'Make HTTP API calls (GET/POST/PUT/DELETE) with structured JSON output and NDJSON event emission.',
                    tags: ['http', 'api', 'fetch', 'observable'],
                },
            ],
        };
    }
    /**
     * Render an agent-targeted Markdown summary of capabilities.
     *
     * Single source of truth: this method derives entirely from
     * getCapabilities(). The output is shipped as AGENTS.md and printed
     * by `nget instructions` so an agent has a complete one-shot doc
     * with no docs/* read or network call required.
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
            if (!s)
                continue;
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
            lines.push(`Supported: ${protocols.map((p) => `\`${p}\``).join(', ')}.`);
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
     * Render the --help text body.
     *
     * Derives entirely from getCLIFlags() and the discovery info — no
     * hard-coded flag list. This is the single source of truth for the
     * human-readable help output.
     */
    toHelpSummary() {
        const flags = this.getCLIFlags();
        const examples = this.getUsageExamples();
        const groupLabels = {
            general: 'General Options',
            pipe: 'Pipe Options',
            recursive: 'Recursive Download Options',
            ssh: 'SSH/SFTP Options',
            agent: 'AI Agent Integration Options',
            webhook: 'Webhook Options',
        };
        const groupOrder = ['general', 'pipe', 'recursive', 'ssh', 'agent', 'webhook'];
        const lines = [];
        // Usage
        lines.push('Usage: nget [options] <url1> [url2] ...');
        lines.push('Usage: nget resume [options]');
        lines.push('Usage: nget config <command> [options]');
        lines.push('Usage: nget jobs');
        lines.push('Usage: nget instructions');
        lines.push('');
        // AI agents discovery block
        lines.push('AI agents — start here:');
        lines.push('  nget instructions               Full one-page agent guide (AGENTS.md, auto-generated)');
        lines.push('  nget --capabilities             Machine-readable JSON spec of every flag, event, and config key');
        lines.push('  nget --openapi-spec             OpenAPI 3.0.3 contract');
        lines.push('  nget fetch <url>                HTTP API client (GET/POST/PUT/DELETE), structured JSON output');
        lines.push('  nget-mcp                        MCP server entry point (download_file, batch_download, get_jobs, get_capabilities)');
        lines.push('  Output is NDJSON to stdout when not running in a TTY — parse with jq.');
        lines.push('');
        // Flag sections
        for (const group of groupOrder) {
            const groupFlags = flags.filter(f => f.group === group);
            if (groupFlags.length === 0) {
                continue;
            }
            lines.push(`${groupLabels[group]}:`);
            for (const f of groupFlags) {
                const shortPart = f.short ? `-${f.short}, ` : '    ';
                const longPart = f.arg ? `--${f.long} ${f.arg}` : `--${f.long}`;
                const flagCol = `  ${shortPart}${longPart}`;
                // Pad to 42 chars for alignment
                const padded = flagCol.padEnd(42);
                lines.push(`${padded}${f.description}`);
            }
            lines.push('');
        }
        // Examples
        lines.push('Examples:');
        const canonical = (examples && examples.canonical) || [];
        for (const ex of canonical) {
            lines.push(`  ${ex.command}`);
        }
        lines.push('');
        return lines.join('\n');
    }
    /**
     * Get schema information for structured outputs
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
     */
    getKeyDependencies() {
        const deps = packageJson.dependencies || {};
        return {
            'ssh2': deps['ssh2'],
            'joi': deps['joi'],
            'js-yaml': deps['js-yaml'],
            'minimist': deps['minimist']
        };
    }
    /**
     * Get SFTP algorithm capabilities
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
     */
    formatOutput(capabilities, format = 'json') {
        switch (format.toLowerCase()) {
            case 'json':
                return JSON.stringify(capabilities, null, 2);
            case 'yaml': {
                const yaml = require('js-yaml');
                return yaml.dump(capabilities, {
                    indent: 2,
                    lineWidth: 120,
                    noRefs: true
                });
            }
            default:
                return JSON.stringify(capabilities, null, 2);
        }
    }
}
module.exports = CapabilitiesService;
