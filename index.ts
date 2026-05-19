#!/usr/bin/env node

/**
 * @fileoverview n-get — Observable downloads for AI agents. NDJSON event stream,
 * MCP server, OpenAPI spec, cross-process session visibility, HTTP/HTTPS + SFTP
 * with resume, and concurrent download orchestration.
 * @author bingeboy
 */

import * as fs            from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import * as path          from 'node:path';
import * as readline      from 'node:readline';
import minimist           from 'minimist';

// Not-yet-migrated JS modules
// eslint-disable-next-line @typescript-eslint/no-require-imports
const chdir              = require('./lib/chdir');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const uriManager         = require('./lib/uriManager');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ui                 = require('./lib/ui');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const resumeManager      = require('./lib/resumeManager');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RecursiveDownloader = require('./lib/recursiveDownloader');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ConfigCommands     = require('./lib/cli/configCommands');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LogsCommands       = require('./lib/cli/logsCommands');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const HistoryCommands    = require('./lib/cli/historyCommands');

// Migrated modules — import-style
import download           = require('./lib/downloadPipeline');
import ConfigManager      = require('./lib/config/ConfigManager');
import { handleJobsCommand } from './lib/cli/jobsCommands.js';

import type { DownloadOptions } from './types/index.js';

// ─── Argv parsing ─────────────────────────────────────────────────────────────

const argv = minimist(process.argv.slice(2), {
    boolean: [
        'resume', 'no-resume', 'list-resume', 'help', 'version',
        'recursive', 'no-parent', 'quiet', 'verbose',
        'json', 'csv', 'text', 'confirm', 'force',
        'metadata', 'checksums', 'no-checksums',
        'capabilities', 'openapi-spec',
        'human',    // human-readable output (progress bars + banners)
    ],
    string: [
        'd', 'destination', 'ssh-key', 'ssh-password', 'ssh-passphrase',
        'level', 'accept', 'reject', 'user-agent',
        'i', 'input-file', 'o', 'output-file',
        'max-concurrent', 'config-environment', 'config-ai-profile',
        'limit', 'status', 'since', 'until', 'output', 'days',
        'session-id', 'request-id', 'conversation-id', 'output-format',
        'agent-id',
        'method', 'data', 'header',
    ],
    alias: {
        d: 'destination',
        r: 'resume',
        l: 'list-resume',
        h: 'help',
        v: 'version',
        V: 'verbose',
        R: 'recursive',
        np: 'no-parent',
        A: 'accept',
        j: 'reject',
        i: 'input-file',
        o: 'output-file',
        q: 'quiet',
        c: 'max-concurrent',
    },
    default: {
        resume: true,
        level: 5,
        'max-concurrent': 3,
    },
});

// ─── Module state ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let configManager: any;
let destination: string | undefined;
const reqUrls: string[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showHelp(): void {
    ui.displayBanner();
    console.log(`
${ui.emojis.info} Usage: nget [options] <url1> [url2] ...
${ui.emojis.info} Usage: nget resume [options]
${ui.emojis.info} Usage: nget config <command> [options]
${ui.emojis.info} Usage: nget jobs
${ui.emojis.info} Usage: nget instructions

${ui.emojis.gear} AI agents — start here:
  nget instructions               Full one-page agent guide (AGENTS.md, auto-generated)
  nget --capabilities             Machine-readable JSON spec of every flag, event, and config key
  nget --openapi-spec             OpenAPI 3.0.3 contract
  nget fetch <url>                HTTP API client (GET/POST/PUT/DELETE), structured JSON output
  nget-mcp                        MCP server entry point (download_file, batch_download, get_jobs, get_capabilities)
  Output is NDJSON to stdout when not running in a TTY — parse with jq.

${ui.emojis.gear} General Options:
  -d, --destination <path>    Destination directory for downloads
  -r, --resume               Enable resume for interrupted downloads (default: true)
  --no-resume                Disable resume functionality
  -l, --list-resume          List resumable downloads in destination
  -c, --max-concurrent <num> Maximum concurrent downloads (default: 3)
  -h, --help                 Show this help message
  --human                    Force human-readable output (progress bars + banners)
  --capabilities             Show tool capabilities for AI agents (JSON/YAML)
  --openapi-spec             Generate OpenAPI 3.0.3 specification for AI agents

${ui.emojis.network} Pipe Options:
  -i, --input-file <file>    Read URLs from file (use '-' for stdin)
  -o, --output-file <file>   Write output to file (use '-' for stdout)
  -q, --quiet                Suppress progress output (useful for piping)

${ui.emojis.search} Recursive Download Options:
  -R, --recursive            Enable recursive downloading (follow links)
  --level <depth>            Maximum recursion depth (default: 5)
  --no-parent                Don't ascend to parent directories
  -A, --accept <patterns>    Comma-separated list of accepted file patterns
  -j, --reject <patterns>    Comma-separated list of rejected file patterns
  --user-agent <string>      Set custom User-Agent for crawling

${ui.emojis.network} SSH/SFTP Options:
  --ssh-key <path>           Path to SSH private key file
  --ssh-password <password>  SSH password (use with caution)
  --ssh-passphrase <phrase>  Passphrase for encrypted SSH key

${ui.emojis.gear} AI Agent Integration Options:
  --metadata                 Include enhanced metadata in output
  --checksums                Generate file checksums (default: true)
  --no-checksums             Disable checksum generation
  --output-format <format>   Output format: json, yaml, csv, text (default: text)
  --session-id <id>          Session identifier for tracking
  --agent-id <id>            Agent identifier (set by calling agent)
  --request-id <id>          Request identifier for correlation
  --conversation-id <id>     Conversation identifier for AI agents

${ui.emojis.rocket} Examples:
  nget https://example.com/file.zip
  nget sftp://user@server.com/path/to/file.zip
  nget sftp://user@server.com/file.zip --ssh-key ~/.ssh/id_rsa
  nget https://example.com/file1.pdf sftp://server.com/file2.zip -d ./downloads
  nget -R https://example.com/gallery/ --level 3 -d ./gallery
  nget -R https://site.com --accept "*.pdf,*.zip" --reject "*.tmp"
  nget -R https://docs.site.com --no-parent --level 2
  nget --list-resume -d ./downloads
  nget resume 1                        # Resume download #1 from list
  nget resume all                      # Resume all downloads from list
  nget resume -d ./downloads           # Resume from specific directory
  nget jobs                            # List active download sessions

${ui.emojis.network} Pipe Examples:
  echo "https://example.com/file.zip" | nget -i -
  cat urls.txt | nget -i -
  nget -o - https://example.com/file.txt
  nget -o - --quiet https://example.com/data.json | jq .
  nget -o - https://example.com/archive.tar.gz | tar -xz

${ui.emojis.gear} AI Agent Integration Examples:
  nget --capabilities                                        # Show tool capabilities
  nget --capabilities --output-format yaml --quiet          # YAML format, compact
  nget https://example.com/data.csv --metadata --output-format json
  nget https://example.com/files.zip --session-id sess123 --request-id req456
  nget https://api.example.com/report.pdf --conversation-id conv789 --checksums

${ui.emojis.partial} Resume Features:
  • Automatically resumes interrupted downloads (HTTP & SFTP)
  • Validates file integrity with ETag/Last-Modified
  • Supports HTTP range requests and SFTP resume
  • Smart duplicate file handling
  • Use 'nget resume -d <path>' to resume from a specific directory
  • Use 'nget resume <number>' to resume a specific numbered download
  • Use 'nget resume all' to resume all downloads

${ui.emojis.search} Recursive Features:
  • Follow links in HTML, XHTML, and CSS files
  • Recreate directory structure locally
  • Fine-tuned depth and pattern control
  • Respect robots.txt (can be disabled)
  • Support for both website mirroring and selective downloads

${ui.emojis.gear} SSH Authentication:
  • Automatic detection of SSH keys in ~/.ssh/
  • Support for id_rsa, id_ed25519, id_ecdsa
  • Password and key-based authentication
  • Encrypted private key support with passphrase

${ui.emojis.rocket} Configuration Commands:
  nget config show [section]      Show current configuration
  nget config set <key> <value>   Set configuration value
  nget config profiles            List available profiles
  nget config profile <name>      Switch to profile
  nget config validate           Validate configuration
  nget config debug              Show debug information

${ui.emojis.gear} Logging Commands:
  nget logs format               Show current logging format
  nget logs format --json        Use JSON structured logging
  nget logs format --csv         Use CSV logging format
  nget logs format --text        Use human-readable text format (default)

${ui.emojis.search} History Commands:
  nget history show              Show recent download history
  nget history search <term>     Search downloads by URL or filename
  nget history stats             Show download statistics
  nget history export            Export history data
  nget history clear --confirm   Clear all download history
    `.trim());
}

async function readUrlsFromInput(inputFile: string): Promise<string[]> {
    const urls: string[] = [];

    if (inputFile === '-') {
        if (process.stdin.isTTY) {
            throw new Error('No URLs provided in stdin. Use pipes or provide URLs as arguments.');
        }

        const rl = readline.createInterface({
            input: process.stdin,
            crlfDelay: Infinity,
        });

        for await (const line of rl) {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                urls.push(trimmedLine);
            }
        }
    } else {
        try {
            const content = await fsPromises.readFile(inputFile, 'utf8');
            for (const line of content.split('\n')) {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#')) {
                    urls.push(trimmedLine);
                }
            }
        } catch (err) {
            throw new Error(`Cannot read input file '${inputFile}': ${(err as Error).message}`);
        }
    }

    return urls;
}

async function listResumableDownloads(): Promise<void> {
    const dest = destination ?? process.cwd();
    ui.displayBanner();
    ui.displayInfo(`Scanning for resumable downloads in: ${dest}`);
    const resumableDownloads = await resumeManager.getResumableDownloads(dest);
    ui.displayResumableList(resumableDownloads);
    if (resumableDownloads.length > 0) {
        ui.displayInfo('To resume downloads, run: nget resume -d <destination>, nget resume <number>, or nget resume all');
    }
    await resumeManager.cleanupOldMetadata(dest);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    try {
        // ─── Info-only flags (short-circuit before config init) ───────────────
        // Help and version don't need config — exit immediately so an agent's
        // first introspection command produces clean stdout with no config-load
        // logging on stderr.
        if (argv.help) { showHelp(); process.exit(0); }
        if (argv.version) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const packageJson = require('./package.json') as { version: string };
            console.log(packageJson.version);
            process.exit(0);
        }

        // instructions — print AGENTS.md (auto-generated). No config init needed.
        if (argv._.length > 0 && argv._[0] === 'instructions') {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const nodeFs = require('node:fs');
            const file = path.join(__dirname, 'AGENTS.md');
            process.stdout.write(nodeFs.readFileSync(file, 'utf8'));
            process.exit(0);
        }

        // Initialize ConfigManager
        try {
            const outputToStdout = argv['output-file'] === '-';
            // --capabilities and --openapi-spec need config to read live values
            // but their output should be clean machine-readable spec only.
            const isInfoOnlyFlag = !!(argv.capabilities || argv['openapi-spec']);
            const shouldSuppressLogs = argv.quiet || outputToStdout || isInfoOnlyFlag;

            let configDir: string;
            const packageConfigDir = path.join(__dirname, 'config');
            const currentConfigDir  = path.join(process.cwd(), 'config');

            try {
                fs.accessSync(packageConfigDir);
                configDir = packageConfigDir;
            } catch {
                configDir = currentConfigDir;
            }

            const configOptions = {
                configDir,
                environment: argv['config-environment'] || process.env['NODE_ENV'] || 'development',
                enableHotReload: process.env['NODE_ENV'] === 'development',
                logger: shouldSuppressLogs
                    ? { info: () => {}, debug: () => {}, warn: () => {}, error: (...args: unknown[]) => console.error(...args) }
                    : console,
            };

            configManager = new ConfigManager(configOptions);

            for (const key of Object.keys(argv)) {
                if (key.startsWith('config-')) {
                    const configPath = key.replace('config-', '').replace(/-/g, '.');
                    if (configPath !== 'environment' && configPath !== 'ai.profile') {
                        try {
                            configManager.set(configPath, argv[key]);
                        } catch (err) {
                            console.warn(`Warning: Could not set config ${configPath}: ${(err as Error).message}`);
                        }
                    }
                }
            }

            if (argv['config-ai-profile']) {
                try {
                    await configManager.applyProfile(argv['config-ai-profile']);
                } catch (err) {
                    console.warn(`Warning: Could not apply profile ${argv['config-ai-profile']}: ${(err as Error).message}`);
                }
            }
        } catch (err) {
            console.error('Failed to initialize configuration:', (err as Error).message);
            process.exit(1);
        }

        // ─── Subcommands ──────────────────────────────────────────────────────

        if (argv.capabilities) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const CapabilitiesService = require('./lib/services/CapabilitiesService');
            const capabilitiesService = new CapabilitiesService({ configManager, logger: console });
            const format   = argv['output-format'] || 'json';
            const detailed = !argv.quiet;
            try {
                const capabilities = capabilitiesService.getCapabilities({ format, detailed });
                console.log(capabilitiesService.formatOutput(capabilities, format));
                process.exit(0);
            } catch (err) {
                console.error('Error generating capabilities:', (err as Error).message);
                process.exit(1);
            }
        }

        if (argv['openapi-spec']) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const OpenAPIService      = require('./lib/services/OpenAPIService');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const CapabilitiesService = require('./lib/services/CapabilitiesService');
            const capabilitiesService = new CapabilitiesService({ configManager, logger: console });
            const openAPIService      = new OpenAPIService({ configManager, capabilitiesService, logger: console });
            const format = argv['output-format'] || 'json';
            try {
                console.log(openAPIService.generateAndFormat({ format, includeExamples: !argv.quiet, includeSchemas: !argv.quiet }));
                process.exit(0);
            } catch (err) {
                console.error('Error generating OpenAPI specification:', (err as Error).message);
                process.exit(1);
            }
        }

        // Handle destination
        if (argv.destination) {
            destination = argv.destination as string;
            const quietMode = argv.quiet || argv['output-file'] === '-';
            if (quietMode) {
                try {
                    const resolvedPath = await fsPromises.realpath(destination);
                    destination = chdir(resolvedPath, true) as string;
                } catch { process.exit(1); }
            } else {
                const spinner = ui.createSpinner('Validating destination path...', ui.emojis.folder);
                spinner.spinner.start();
                try {
                    const resolvedPath = await fsPromises.realpath(destination);
                    destination = chdir(resolvedPath, false) as string;
                    spinner.spinner.succeed(`${ui.emojis.folder} Destination set: ${destination}`);
                } catch {
                    spinner.spinner.fail(`${ui.emojis.error} Invalid destination path: ${destination}`);
                    process.exit(1);
                }
            }
        }

        if (argv._.length > 0 && argv._[0] === 'config') {
            const configCommands = new ConfigCommands();
            await configCommands.execute(argv._.slice(1), argv);
            process.exit(0);
        }

        if (argv._.length > 0 && argv._[0] === 'logs') {
            const logsCommands = new LogsCommands();
            await logsCommands.execute(argv._.slice(1), argv);
            process.exit(0);
        }

        if (argv._.length > 0 && argv._[0] === 'history') {
            const historyCommands = new HistoryCommands();
            await historyCommands.execute(argv._.slice(1), argv);
            process.exit(0);
        }

        // jobs — list active download sessions across all agents
        if (argv._.length > 0 && argv._[0] === 'jobs') {
            const outputToStdout = argv['output-file'] === '-';
            const humanMode = !!(argv.human || (process.stdout.isTTY && !outputToStdout));
            handleJobsCommand(argv as Record<string, unknown>, humanMode);
            process.exit(0);
        }

        // fetch — HTTP API client (GET/POST/PUT/DELETE) with structured JSON output
        if (argv._.length > 0 && argv._[0] === 'fetch') {
            const fetchUrl = argv._[1] as string | undefined;
            if (!fetchUrl) {
                console.error('Error: fetch requires a URL. Usage: nget fetch [--method GET] [--data <json>] [--header "Key: Value"] <url>');
                process.exit(1);
            }
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const ngetFetch = require('./lib/fetch');
            const method: string = (argv.method as string) || 'GET';
            let data: unknown = undefined;
            if (argv.data) {
                try { data = JSON.parse(argv.data as string); } catch { data = argv.data; }
            }
            const headers: Record<string, string> = {};
            if (argv.header) {
                const headerStr = argv.header as string;
                const colonIdx = headerStr.indexOf(':');
                if (colonIdx > 0) {
                    headers[headerStr.slice(0, colonIdx).trim()] = headerStr.slice(colonIdx + 1).trim();
                }
            }
            ngetFetch(fetchUrl, { method, body: data, headers, agentId: argv['agent-id'] })
                .then((resp: { ok: boolean; status: number; statusText: string; data: unknown; headers: Record<string, string>; url: string; latencyMs: number }) => {
                    console.log(JSON.stringify({
                        ok: resp.ok,
                        status: resp.status,
                        statusText: resp.statusText,
                        data: resp.data,
                        headers: resp.headers,
                        url: resp.url,
                        latencyMs: resp.latencyMs,
                        agentId: (argv['agent-id'] as string) || null
                    }));
                    process.exit(resp.ok ? 0 : 1);
                })
                .catch((err: Error & { code?: string; latencyMs?: number }) => {
                    console.log(JSON.stringify({
                        ok: false,
                        status: 0,
                        error: err.message,
                        code: err.code,
                        url: fetchUrl,
                        latencyMs: err.latencyMs ?? null,
                        agentId: (argv['agent-id'] as string) || null
                    }));
                    process.exit(1);
                });
            return;
        }

        if (argv['list-resume']) {
            await listResumableDownloads();
            process.exit(0);
        }

        // ─── Resume ───────────────────────────────────────────────────────────

        if (argv._.length > 0 && argv._[0] === 'resume') {
            const resumeArgument = argv._[1];
            const quietMode = argv.quiet || argv['output-file'] === '-';

            if (resumeArgument && /^\d+$/.test(String(resumeArgument))) {
                const itemNumber = Number.parseInt(String(resumeArgument));
                const dest = destination ?? process.cwd();
                const resumableDownloads = await resumeManager.getResumableDownloads(dest);

                if (resumableDownloads.length === 0) {
                    console.error('Error: No resumable downloads found.');
                    process.exit(1);
                }
                if (itemNumber < 1 || itemNumber > resumableDownloads.length) {
                    console.error(`Error: Invalid item number ${itemNumber}. Available items: 1-${resumableDownloads.length}`);
                    process.exit(1);
                }

                const selected = resumableDownloads[itemNumber - 1];
                reqUrls.push(selected.url);
                if (!quietMode) {
                    ui.displayInfo(`Resuming download #${itemNumber}: ${selected.url}`);
                    ui.displayInfo(`Target file: ${selected.filePath}`);
                }

            } else if (resumeArgument && String(resumeArgument).toLowerCase() === 'all') {
                const dest = destination ?? process.cwd();
                const resumableDownloads = await resumeManager.getResumableDownloads(dest);
                if (resumableDownloads.length === 0) {
                    console.error('Error: No resumable downloads found.');
                    process.exit(1);
                }
                resumableDownloads.forEach((dl: { url: string }) => reqUrls.push(dl.url));
                if (!quietMode) {
                    ui.displayInfo(`Resuming all ${resumableDownloads.length} downloads...`);
                    resumableDownloads.forEach((dl: { url: string }, i: number) => {
                        ui.displayInfo(`  #${i + 1}: ${dl.url}`);
                    });
                }

            } else {
                if (!destination) {
                    console.error('Error: \'nget resume\' requires -d <path> option to specify directory.');
                    process.exit(1);
                }
                const latestResumable = await resumeManager.findLatestResumableDownload(destination);
                if (!latestResumable) {
                    console.error('Error: No resumable downloads found in destination directory.');
                    process.exit(1);
                }
                reqUrls.push(latestResumable.url);
                if (!quietMode) {
                    ui.displayInfo(`Resuming download: ${latestResumable.url}`);
                    ui.displayInfo(`Target file: ${latestResumable.filePath}`);
                }
            }

        } else {
            // Collect URLs from positional args
            argv._.forEach((url: string) => {
                if (url && typeof url === 'string') { reqUrls.push(url); }
            });

            if (argv['input-file']) {
                const inputUrls = await readUrlsFromInput(argv['input-file'] as string);
                reqUrls.push(...inputUrls);
            }

            if (reqUrls.length === 0) {
                console.error('Error: No URLs provided. Use \'nget --help\' for usage information.');
                process.exit(1);
            }
        }

        // ─── URL processing ───────────────────────────────────────────────────

        const outputToStdout = argv['output-file'] === '-';
        const quietMode      = argv.quiet || outputToStdout;

        // Human mode: explicit flag OR interactive TTY (not piping output to another process)
        const humanMode = !!(argv.human || (process.stdout.isTTY && !outputToStdout));

        let urlSpinner: { spinner: { succeed: (s: string) => void } } | null = null;
        if (!quietMode) {
            const s = ui.createSpinner('Processing URLs...', ui.emojis.network);
            s.spinner.start();
            urlSpinner = s;
        }

        const processedUrls = (reqUrls as string[]).map(uriManager as (u: string) => string);

        if (!quietMode && urlSpinner) {
            urlSpinner.spinner.succeed(`${ui.emojis.network} ${processedUrls.length} URL(s) processed`);
        }

        const enableResume = argv.resume && !argv['no-resume'];
        if (!enableResume && !quietMode) {
            ui.displayWarning('Resume functionality disabled');
        }

        // SSH options
        const sshOptions: Record<string, string> = {};
        if (argv['ssh-key']) {
            sshOptions['keyPath'] = argv['ssh-key'] as string;
            if (!quietMode) { ui.displayInfo(`Using SSH key: ${argv['ssh-key']}`); }
        }
        if (argv['ssh-password']) {
            sshOptions['password'] = argv['ssh-password'] as string;
            if (!quietMode) { ui.displayWarning('SSH password provided via command line (consider using key authentication)'); }
        }
        if (argv['ssh-passphrase']) {
            sshOptions['passphrase'] = argv['ssh-passphrase'] as string;
            if (!quietMode) { ui.displayInfo('SSH key passphrase provided'); }
        }

        if (argv['output-file'] && argv['output-file'] !== '-' && processedUrls.length > 1) {
            if (!quietMode) { ui.displayError('Cannot use -o with multiple URLs. The -o option is for single file downloads only.'); }
            process.exit(1);
        }

        const configMaxConcurrent = configManager.get('downloads.maxConcurrent', 3) as number;
        const maxConcurrent = Math.max(1, Number.parseInt(argv['max-concurrent'] as string) || configMaxConcurrent);
        if (!quietMode && maxConcurrent !== configMaxConcurrent) {
            ui.displayInfo(`Using ${maxConcurrent} concurrent downloads`);
        }

        const downloadOptions: DownloadOptions = {
            enableResume,
            sshOptions,
            outputToStdout,
            outputFilename: argv['output-file'] && argv['output-file'] !== '-' ? argv['output-file'] as string : null,
            quietMode:      quietMode || outputToStdout,
            humanMode,
            maxConcurrent,
            configManager,
            // Agent integration
            agentId:         argv['agent-id']          as string | undefined,
            sessionId:       argv['session-id']        as string | undefined,
            requestId:       argv['request-id']        as string | undefined,
            conversationId:  argv['conversation-id']   as string | undefined,
            enableMetadata:  argv.metadata             as boolean | undefined,
            enableChecksums: (argv.checksums && !argv['no-checksums']) as boolean | undefined,
            outputFormat:    (argv['output-format'] || 'text') as 'json' | 'yaml' | 'csv' | 'text',
            requestedBy:     'cli',
            metadata:        {},
        };

        // ─── Recursive mode ───────────────────────────────────────────────────

        if (argv.recursive) {
            if (outputToStdout) {
                ui.displayError('Recursive mode is not compatible with stdout output (-o -)');
                process.exit(1);
            }

            const acceptPatterns = argv.accept ? (argv.accept as string).split(',').map((p: string) => p.trim()) : [];
            const rejectPatterns = argv.reject ? (argv.reject as string).split(',').map((p: string) => p.trim()) : [];

            const recursiveOptions = {
                level:       Number.parseInt(argv.level as string) || 5,
                noParent:    argv['no-parent'] || false,
                accept:      acceptPatterns,
                reject:      rejectPatterns,
                enableResume,
                sshOptions,
                userAgent:   argv['user-agent'] || (configManager.get('http.userAgent', 'n-get-recursive/1.0') as string),
                quietMode,
                maxConcurrent,
                configManager,
            };

            if (!quietMode) {
                ui.displayInfo(`Recursive mode enabled (depth: ${recursiveOptions.level})`);
                if (recursiveOptions.noParent) { ui.displayInfo('Parent directory restriction enabled'); }
            }

            const recursiveDownloader = new RecursiveDownloader(recursiveOptions);
            await recursiveDownloader.recursiveDownload(processedUrls, destination ?? process.cwd());

        } else {
            const results = await download(processedUrls, destination as string, downloadOptions);
            const allFailed = (results as Array<{ success: boolean }>).every(r => !r.success);
            if (allFailed && results.length > 0) { process.exit(1); }
        }

    } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'EPIPE' || (error as unknown as { errno?: string }).errno === 'EPIPE') {
            process.exit(0);
        }

        const quietMode = argv.quiet || argv['output-file'] === '-';
        if (!quietMode) {
            ui.displayError(`Application error: ${error.message}`);
            ui.cleanup();
        }
        process.exit(1);
    }
}

main().catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE' || (err as unknown as { errno?: string }).errno === 'EPIPE') {
        process.exit(0);
    }
    console.error('Error:', err.message);
    process.exit(1);
});
