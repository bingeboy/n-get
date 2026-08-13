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
const chdir = require('./lib/chdir');
const uriManager = require('./lib/uriManager');
const ui = require('./lib/ui');
const resumeManager = require('./lib/resumeManager');
const ConfigCommands = require('./lib/cli/configCommands');
const LogsCommands = require('./lib/cli/logsCommands');
const HistoryCommands = require('./lib/cli/historyCommands');
// Migrated modules — import-style
const download = require("./lib/downloader");
const ConfigManager = require("./lib/config/ConfigManager");
const jobsCommands_js_1 = require("./lib/cli/jobsCommands.js");
const EventSink_js_1 = require("./lib/core/EventSink.js");
// ─── Argv parsing ─────────────────────────────────────────────────────────────
const argv = (0, minimist_1.default)(process.argv.slice(2), {
    boolean: [
        'resume', 'no-resume', 'list-resume', 'help', 'version',
        'quiet', 'verbose',
        'json', 'csv', 'text', 'confirm', 'force',
        'metadata', 'checksums', 'no-checksums',
        'capabilities', 'openapi-spec', 'agent-card',
        'human', // human-readable output (progress bars + banners)
        'raw', // fetch: output response body only, no NDJSON envelope
        'recursive', // -R: crawl and download linked resources
        // NOTE: --no-parent is deliberately absent — minimist rewrites any
        // --no-X argument to { X: false }, so the flag is read below as
        // argv.parent === false.
    ],
    string: [
        'd', 'destination', 'ssh-key', 'ssh-password', 'ssh-passphrase',
        'user-agent',
        'i', 'input-file', 'o', 'output-file',
        'max-concurrent', 'config-environment', 'config-ai-profile',
        'limit', 'status', 'since', 'until', 'output', 'days',
        'session-id', 'request-id', 'conversation-id', 'output-format',
        'agent-id',
        'method', 'data', 'header',
        'webhook', 'webhook-header', 'webhook-events', 'webhook-secret',
        'level', 'accept', 'reject', // recursive: depth + file patterns
    ],
    alias: {
        d: 'destination',
        r: 'resume',
        l: 'list-resume',
        h: 'help',
        v: 'version',
        V: 'verbose',
        A: 'accept',
        j: 'reject',
        i: 'input-file',
        o: 'output-file',
        q: 'quiet',
        c: 'max-concurrent',
        R: 'recursive',
    },
    default: {
        resume: true,
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
    const CapabilitiesService = require('./lib/services/CapabilitiesService');
    console.log(new CapabilitiesService().toHelpSummary());
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
            const packageJson = require('./package.json');
            console.log(packageJson.version);
            process.exit(0);
        }
        // instructions — print AGENTS.md (auto-generated). No config init needed.
        if (argv._.length > 0 && argv._[0] === 'instructions') {
            const nodeFs = require('node:fs');
            const file = path.join(__dirname, 'AGENTS.md');
            process.stdout.write(nodeFs.readFileSync(file, 'utf8'));
            process.exit(0);
        }
        // Initialize ConfigManager
        try {
            const outputToStdout = argv['output-file'] === '-';
            // --capabilities, --openapi-spec, and --agent-card need config to read live values
            // but their output should be clean machine-readable spec only.
            const isInfoOnlyFlag = !!(argv.capabilities || argv['openapi-spec'] || argv['agent-card'] || argv._[0] === 'fetch');
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
        // ─── Webhook config parser ────────────────────────────────────────────
        function parseWebhookConfig() {
            const rawUrls = argv.webhook
                ? (Array.isArray(argv.webhook) ? argv.webhook : [argv.webhook])
                : [];
            if (rawUrls.length === 0) {
                return [];
            }
            const rawHeaders = argv['webhook-header']
                ? (Array.isArray(argv['webhook-header']) ? argv['webhook-header'] : [argv['webhook-header']])
                : [];
            const headers = {};
            for (const h of rawHeaders) {
                const colonIdx = h.indexOf(':');
                if (colonIdx > 0) {
                    headers[h.slice(0, colonIdx).trim()] = h.slice(colonIdx + 1).trim();
                }
            }
            const events = argv['webhook-events']
                ? argv['webhook-events'].split(',').map((e) => e.trim()).filter(Boolean)
                : [];
            const webhookSecret = argv['webhook-secret'] || '';
            return rawUrls.map((url) => ({
                url,
                headers: Object.keys(headers).length > 0 ? headers : undefined,
                events: events.length > 0 ? events : undefined,
                webhookSecret: webhookSecret || undefined,
            }));
        }
        // ─── Subcommands ──────────────────────────────────────────────────────
        if (argv.capabilities) {
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
            const OpenAPIService = require('./lib/services/OpenAPIService');
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
        if (argv['agent-card']) {
            const CapabilitiesService = require('./lib/services/CapabilitiesService');
            const capabilitiesService = new CapabilitiesService({ configManager, logger: console });
            try {
                console.log(JSON.stringify(capabilitiesService.toA2ACard(), null, 2));
                process.exit(0);
            }
            catch (err) {
                console.error('Error generating agent card:', err.message);
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
        // fetch — HTTP API client (GET/POST/PUT/DELETE) with structured JSON output
        if (argv._.length > 0 && argv._[0] === 'fetch') {
            const fetchUrl = argv._[1];
            if (!fetchUrl) {
                console.error('Error: fetch requires a URL. Usage: nget fetch [--method GET] [--data <json>] [--header "Key: Value"] [--header "Key2: Value2"] <url>');
                process.exit(1);
            }
            const ngetFetch = require('./lib/fetch');
            const method = argv.method || 'GET';
            let data = undefined;
            if (argv.data) {
                try {
                    data = JSON.parse(argv.data);
                }
                catch {
                    data = argv.data;
                }
            }
            const headers = {};
            if (argv.header) {
                const rawH = Array.isArray(argv.header) ? argv.header : [argv.header];
                for (const h of rawH) {
                    const colonIdx = h.indexOf(':');
                    if (colonIdx > 0) {
                        headers[h.slice(0, colonIdx).trim()] = h.slice(colonIdx + 1).trim();
                    }
                }
            }
            const rawMode = !!(argv.raw);
            const fetchSessionId = argv['session-id'] || `fetch_${Date.now()}`;
            const fetchEmitter = new EventSink_js_1.EventSink({
                sessionId: fetchSessionId,
                pipeMode: true,
                webhooks: parseWebhookConfig(),
            });
            if (!rawMode)
                fetchEmitter.fetchStart(fetchUrl, method, data !== undefined);
            ngetFetch(fetchUrl, { method, body: data, headers, agentId: argv['agent-id'] })
                .then(async (resp) => {
                const contentType = resp.headers['content-type'] ?? null;
                if (rawMode) {
                    const out = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
                    console.log(out);
                }
                else {
                    fetchEmitter.fetchComplete(fetchUrl, method, resp.status, resp.statusText, resp.latencyMs, contentType);
                    console.log(JSON.stringify({
                        ok: resp.ok,
                        status: resp.status,
                        statusText: resp.statusText,
                        data: resp.data,
                        headers: resp.headers,
                        url: resp.url,
                        latencyMs: resp.latencyMs,
                        agentId: argv['agent-id'] || null
                    }));
                    await fetchEmitter.flush();
                }
                process.exit(resp.ok ? 0 : 1);
            })
                .catch(async (err) => {
                if (rawMode) {
                    process.stderr.write(`error: ${err.message}\n`);
                }
                else {
                    fetchEmitter.fetchError(fetchUrl, method, err.message, err.latencyMs ?? null);
                    console.log(JSON.stringify({
                        ok: false,
                        status: 0,
                        error: err.message,
                        code: err.code,
                        url: fetchUrl,
                        latencyMs: err.latencyMs ?? null,
                        agentId: argv['agent-id'] || null
                    }));
                    await fetchEmitter.flush();
                }
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
        // ─── Recursive download (-R / --recursive) ────────────────────────────
        if (argv.recursive) {
            // Advertised limits (see --capabilities limits.recursion)
            const RECURSION_DEFAULT_DEPTH = 5;
            const RECURSION_MAX_DEPTH = 50;
            if (outputToStdout || argv['stdout']) {
                console.error('Error: Recursive mode is not compatible with --stdout');
                process.exit(1);
            }
            let level = RECURSION_DEFAULT_DEPTH;
            if (argv.level !== undefined) {
                const parsed = Number.parseInt(argv.level, 10);
                if (Number.isNaN(parsed) || parsed < 1 || parsed > RECURSION_MAX_DEPTH) {
                    console.error(`Error: --level must be a number between 1 and ${RECURSION_MAX_DEPTH}`);
                    process.exit(1);
                }
                level = parsed;
            }
            const RecursiveDownloader = require('./lib/recursiveDownloader');
            const recursiveDownloader = new RecursiveDownloader({
                level,
                // minimist rewrites --no-parent to { parent: false }
                noParent: argv['parent'] === false,
                accept: argv.accept,
                reject: argv.reject,
                enableResume,
                maxConcurrentDownloads: maxConcurrent,
                userAgent: argv['user-agent'],
                sshOptions,
                configManager,
                agentId: argv['agent-id'] ?? null,
            });
            const recursiveResults = await recursiveDownloader.recursiveDownload(processedUrls, destination ?? process.cwd());
            const allRecursiveFailed = recursiveResults.length > 0
                && recursiveResults.every(r => !r.success);
            process.exit(allRecursiveFailed ? 1 : 0);
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
            webhooks: parseWebhookConfig(),
        };
        const results = await download(processedUrls, destination, downloadOptions);
        const allFailed = results.every(r => !r.success);
        if (allFailed && results.length > 0) {
            process.exit(1);
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
