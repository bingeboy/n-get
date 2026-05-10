#!/usr/bin/env node
"use strict";
/**
 * @fileoverview n-get — Observable downloads for AI agents. NDJSON event stream,
 * MCP server, OpenAPI spec, cross-process session visibility, HTTP/HTTPS + SFTP
 * with resume, and concurrent download orchestration.
 * @author bingeboy
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("node:fs"));
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const readline = __importStar(require("node:readline"));
const minimist_1 = __importDefault(require("minimist"));
// Not-yet-migrated JS modules
// eslint-disable-next-line @typescript-eslint/no-require-imports
const chdir = require('./lib/chdir');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const uriManager = require('./lib/uriManager');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ui = require('./lib/ui');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const resumeManager = require('./lib/resumeManager');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RecursiveDownloader = require('./lib/recursiveDownloader');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ConfigCommands = require('./lib/cli/configCommands');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LogsCommands = require('./lib/cli/logsCommands');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const HistoryCommands = require('./lib/cli/historyCommands');
// Migrated modules — import-style
const download = require("./lib/downloadPipeline");
const ConfigManager = require("./lib/config/ConfigManager");
const jobsCommands_js_1 = require("./lib/cli/jobsCommands.js");
// ─── Argv parsing ─────────────────────────────────────────────────────────────
const argv = (0, minimist_1.default)(process.argv.slice(2), {
    boolean: [
        'resume', 'no-resume', 'list-resume', 'help', 'version',
        'recursive', 'no-parent', 'quiet', 'verbose',
        'json', 'csv', 'text', 'confirm', 'force',
        'metadata', 'checksums', 'no-checksums',
        'capabilities', 'openapi-spec',
        'human', // human-readable output (progress bars + banners)
    ],
    string: [
        'd', 'destination', 'ssh-key', 'ssh-password', 'ssh-passphrase',
        'level', 'accept', 'reject', 'user-agent',
        'i', 'input-file', 'o', 'output-file',
        'max-concurrent', 'config-environment', 'config-ai-profile',
        'limit', 'status', 'since', 'until', 'output', 'days',
        'session-id', 'request-id', 'conversation-id', 'output-format',
        'agent-id',
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
let configManager;
let destination;
const reqUrls = [];
// ─── Helpers ──────────────────────────────────────────────────────────────────
function showHelp() {
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
async function readUrlsFromInput(inputFile) {
    const urls = [];
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
    }
    else {
        try {
            const content = await node_fs_1.promises.readFile(inputFile, 'utf8');
            for (const line of content.split('\n')) {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#')) {
                    urls.push(trimmedLine);
                }
            }
        }
        catch (err) {
            throw new Error(`Cannot read input file '${inputFile}': ${err.message}`);
        }
    }
    return urls;
}
async function listResumableDownloads() {
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
async function main() {
    try {
        // ─── Info-only flags (short-circuit before config init) ───────────────
        // Help and version don't need config — exit immediately so an agent's
        // first introspection command produces clean stdout with no config-load
        // logging on stderr.
        if (argv.help) {
            showHelp();
            process.exit(0);
        }
        if (argv.version) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const packageJson = require('./package.json');
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
            let configDir;
            const packageConfigDir = path.join(__dirname, 'config');
            const currentConfigDir = path.join(process.cwd(), 'config');
            try {
                fs.accessSync(packageConfigDir);
                configDir = packageConfigDir;
            }
            catch {
                configDir = currentConfigDir;
            }
            const configOptions = {
                configDir,
                environment: argv['config-environment'] || process.env['NODE_ENV'] || 'development',
                enableHotReload: process.env['NODE_ENV'] === 'development',
                logger: shouldSuppressLogs
                    ? { info: () => { }, debug: () => { }, warn: () => { }, error: (...args) => console.error(...args) }
                    : console,
            };
            configManager = new ConfigManager(configOptions);
            for (const key of Object.keys(argv)) {
                if (key.startsWith('config-')) {
                    const configPath = key.replace('config-', '').replace(/-/g, '.');
                    if (configPath !== 'environment' && configPath !== 'ai.profile') {
                        try {
                            configManager.set(configPath, argv[key]);
                        }
                        catch (err) {
                            console.warn(`Warning: Could not set config ${configPath}: ${err.message}`);
                        }
                    }
                }
            }
            if (argv['config-ai-profile']) {
                try {
                    await configManager.applyProfile(argv['config-ai-profile']);
                }
                catch (err) {
                    console.warn(`Warning: Could not apply profile ${argv['config-ai-profile']}: ${err.message}`);
                }
            }
        }
        catch (err) {
            console.error('Failed to initialize configuration:', err.message);
            process.exit(1);
        }
        // ─── Subcommands ──────────────────────────────────────────────────────
        if (argv.capabilities) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const CapabilitiesService = require('./lib/services/CapabilitiesService');
            const capabilitiesService = new CapabilitiesService({ configManager, logger: console });
            const format = argv['output-format'] || 'json';
            const detailed = !argv.quiet;
            try {
                const capabilities = capabilitiesService.getCapabilities({ format, detailed });
                console.log(capabilitiesService.formatOutput(capabilities, format));
                process.exit(0);
            }
            catch (err) {
                console.error('Error generating capabilities:', err.message);
                process.exit(1);
            }
        }
        if (argv['openapi-spec']) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const OpenAPIService = require('./lib/services/OpenAPIService');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const CapabilitiesService = require('./lib/services/CapabilitiesService');
            const capabilitiesService = new CapabilitiesService({ configManager, logger: console });
            const openAPIService = new OpenAPIService({ configManager, capabilitiesService, logger: console });
            const format = argv['output-format'] || 'json';
            try {
                console.log(openAPIService.generateAndFormat({ format, includeExamples: !argv.quiet, includeSchemas: !argv.quiet }));
                process.exit(0);
            }
            catch (err) {
                console.error('Error generating OpenAPI specification:', err.message);
                process.exit(1);
            }
        }
        // Handle destination
        if (argv.destination) {
            destination = argv.destination;
            const quietMode = argv.quiet || argv['output-file'] === '-';
            if (quietMode) {
                try {
                    const resolvedPath = await node_fs_1.promises.realpath(destination);
                    destination = chdir(resolvedPath, true);
                }
                catch {
                    process.exit(1);
                }
            }
            else {
                const spinner = ui.createSpinner('Validating destination path...', ui.emojis.folder);
                spinner.spinner.start();
                try {
                    const resolvedPath = await node_fs_1.promises.realpath(destination);
                    destination = chdir(resolvedPath, false);
                    spinner.spinner.succeed(`${ui.emojis.folder} Destination set: ${destination}`);
                }
                catch {
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
            (0, jobsCommands_js_1.handleJobsCommand)(argv, humanMode);
            process.exit(0);
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
            }
            else if (resumeArgument && String(resumeArgument).toLowerCase() === 'all') {
                const dest = destination ?? process.cwd();
                const resumableDownloads = await resumeManager.getResumableDownloads(dest);
                if (resumableDownloads.length === 0) {
                    console.error('Error: No resumable downloads found.');
                    process.exit(1);
                }
                resumableDownloads.forEach((dl) => reqUrls.push(dl.url));
                if (!quietMode) {
                    ui.displayInfo(`Resuming all ${resumableDownloads.length} downloads...`);
                    resumableDownloads.forEach((dl, i) => {
                        ui.displayInfo(`  #${i + 1}: ${dl.url}`);
                    });
                }
            }
            else {
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
        }
        else {
            // Collect URLs from positional args
            argv._.forEach((url) => {
                if (url && typeof url === 'string') {
                    reqUrls.push(url);
                }
            });
            if (argv['input-file']) {
                const inputUrls = await readUrlsFromInput(argv['input-file']);
                reqUrls.push(...inputUrls);
            }
            if (reqUrls.length === 0) {
                console.error('Error: No URLs provided. Use \'nget --help\' for usage information.');
                process.exit(1);
            }
        }
        // ─── URL processing ───────────────────────────────────────────────────
        const outputToStdout = argv['output-file'] === '-';
        const quietMode = argv.quiet || outputToStdout;
        // Human mode: explicit flag OR interactive TTY (not piping output to another process)
        const humanMode = !!(argv.human || (process.stdout.isTTY && !outputToStdout));
        let urlSpinner = null;
        if (!quietMode) {
            const s = ui.createSpinner('Processing URLs...', ui.emojis.network);
            s.spinner.start();
            urlSpinner = s;
        }
        const processedUrls = reqUrls.map(uriManager);
        if (!quietMode && urlSpinner) {
            urlSpinner.spinner.succeed(`${ui.emojis.network} ${processedUrls.length} URL(s) processed`);
        }
        const enableResume = argv.resume && !argv['no-resume'];
        if (!enableResume && !quietMode) {
            ui.displayWarning('Resume functionality disabled');
        }
        // SSH options
        const sshOptions = {};
        if (argv['ssh-key']) {
            sshOptions['keyPath'] = argv['ssh-key'];
            if (!quietMode) {
                ui.displayInfo(`Using SSH key: ${argv['ssh-key']}`);
            }
        }
        if (argv['ssh-password']) {
            sshOptions['password'] = argv['ssh-password'];
            if (!quietMode) {
                ui.displayWarning('SSH password provided via command line (consider using key authentication)');
            }
        }
        if (argv['ssh-passphrase']) {
            sshOptions['passphrase'] = argv['ssh-passphrase'];
            if (!quietMode) {
                ui.displayInfo('SSH key passphrase provided');
            }
        }
        if (argv['output-file'] && argv['output-file'] !== '-' && processedUrls.length > 1) {
            if (!quietMode) {
                ui.displayError('Cannot use -o with multiple URLs. The -o option is for single file downloads only.');
            }
            process.exit(1);
        }
        const configMaxConcurrent = configManager.get('downloads.maxConcurrent', 3);
        const maxConcurrent = Math.max(1, Number.parseInt(argv['max-concurrent']) || configMaxConcurrent);
        if (!quietMode && maxConcurrent !== configMaxConcurrent) {
            ui.displayInfo(`Using ${maxConcurrent} concurrent downloads`);
        }
        const downloadOptions = {
            enableResume,
            sshOptions,
            outputToStdout,
            outputFilename: argv['output-file'] && argv['output-file'] !== '-' ? argv['output-file'] : null,
            quietMode: quietMode || outputToStdout,
            humanMode,
            maxConcurrent,
            configManager,
            // Agent integration
            agentId: argv['agent-id'],
            sessionId: argv['session-id'],
            requestId: argv['request-id'],
            conversationId: argv['conversation-id'],
            enableMetadata: argv.metadata,
            enableChecksums: (argv.checksums && !argv['no-checksums']),
            outputFormat: (argv['output-format'] || 'text'),
            requestedBy: 'cli',
            metadata: {},
        };
        // ─── Recursive mode ───────────────────────────────────────────────────
        if (argv.recursive) {
            if (outputToStdout) {
                ui.displayError('Recursive mode is not compatible with stdout output (-o -)');
                process.exit(1);
            }
            const acceptPatterns = argv.accept ? argv.accept.split(',').map((p) => p.trim()) : [];
            const rejectPatterns = argv.reject ? argv.reject.split(',').map((p) => p.trim()) : [];
            const recursiveOptions = {
                level: Number.parseInt(argv.level) || 5,
                noParent: argv['no-parent'] || false,
                accept: acceptPatterns,
                reject: rejectPatterns,
                enableResume,
                sshOptions,
                userAgent: argv['user-agent'] || configManager.get('http.userAgent', 'n-get-recursive/1.0'),
                quietMode,
                maxConcurrent,
                configManager,
            };
            if (!quietMode) {
                ui.displayInfo(`Recursive mode enabled (depth: ${recursiveOptions.level})`);
                if (recursiveOptions.noParent) {
                    ui.displayInfo('Parent directory restriction enabled');
                }
            }
            const recursiveDownloader = new RecursiveDownloader(recursiveOptions);
            await recursiveDownloader.recursiveDownload(processedUrls, destination ?? process.cwd());
        }
        else {
            const results = await download(processedUrls, destination, downloadOptions);
            const allFailed = results.every(r => !r.success);
            if (allFailed && results.length > 0) {
                process.exit(1);
            }
        }
    }
    catch (err) {
        const error = err;
        if (error.code === 'EPIPE' || error.errno === 'EPIPE') {
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
main().catch((err) => {
    if (err.code === 'EPIPE' || err.errno === 'EPIPE') {
        process.exit(0);
    }
    console.error('Error:', err.message);
    process.exit(1);
});
