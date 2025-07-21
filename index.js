#!/usr/bin/env node

/**
 * @fileoverview n-get - A wget-like CLI tool for Node.js with enhanced features
 * Supports HTTP/HTTPS and SFTP downloads, resume capability, recursive downloading,
 * and concurrent downloads with progress tracking.
 * @author bingeboy
 * @version 1.2.0
 */

const fs = require('node:fs').promises;
const readline = require('node:readline');
const minimist = require('minimist');
const chdir = require('./lib/chdir');
const uriManager = require('./lib/uriManager');
const recursivePipe = require('./lib/recursivePipe');
const ui = require('./lib/ui');
const resumeManager = require('./lib/resumeManager');
const RecursiveDownloader = require('./lib/recursiveDownloader');
const ConfigManager = require('./lib/config/ConfigManager');

const argv = minimist(process.argv.slice(2), {
    boolean: ['resume', 'no-resume', 'list-resume', 'help', 'version', 'recursive', 'no-parent', 'quiet'],
    string: ['d', 'destination', 'ssh-key', 'ssh-password', 'ssh-passphrase', 'level', 'accept', 'reject', 'user-agent', 'i', 'input-file', 'o', 'output-file', 'max-concurrent', 'config-environment', 'config-ai-profile'],
    alias: {
        d: 'destination',
        r: 'resume',
        l: 'list-resume',
        h: 'help',
        v: 'version',
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

// ConfigManager will be initialized in main function
let configManager;

let destination;
const reqUrls = [];

/**
 * Displays help information including usage, options, and examples
 * @function showHelp
 * @returns {void}
 */
function showHelp() {
    ui.displayBanner();
    console.log(`
${ui.emojis.info} Usage: nget [options] <url1> [url2] ...
${ui.emojis.info} Usage: nget resume [options]

${ui.emojis.gear} General Options:
  -d, --destination <path>    Destination directory for downloads
  -r, --resume               Enable resume for interrupted downloads (default: true)
  --no-resume                Disable resume functionality
  -l, --list-resume          List resumable downloads in destination
  -c, --max-concurrent <num> Maximum concurrent downloads (default: 3)
  -h, --help                 Show this help message

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
  nget resume -d ./downloads      # Resume from specific directory

${ui.emojis.network} Pipe Examples:
  echo "https://example.com/file.zip" | nget -i -
  cat urls.txt | nget -i -
  nget -o - https://example.com/file.txt
  nget -o - --quiet https://example.com/data.json | jq .
  nget -o - https://example.com/archive.tar.gz | tar -xz

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
    `.trim());
}

/**
 * Reads URLs from an input source (file or stdin)
 * Supports comment lines (starting with #) which are ignored
 * @async
 * @function readUrlsFromInput  
 * @param {string} inputFile - Path to input file or '-' for stdin
 * @returns {Promise<string[]>} Array of URLs read from input
 * @throws {Error} When input file cannot be read or stdin is not available
 */
async function readUrlsFromInput(inputFile) {
    const urls = [];

    if (inputFile === '-') {
        // Read from stdin
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
        // Read from file
        try {
            const content = await fs.readFile(inputFile, 'utf8');
            const lines = content.split('\n');
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#')) {
                    urls.push(trimmedLine);
                }
            }
        } catch (error) {
            throw new Error(`Cannot read input file '${inputFile}': ${error.message}`);
        }
    }

    return urls;
}

/**
 * Lists all resumable downloads in the specified destination directory
 * Scans for partial download metadata and displays them to the user
 * @async
 * @function listResumableDownloads
 * @returns {Promise<void>}
 */
async function listResumableDownloads() {
    const dest = destination || process.cwd();

    ui.displayBanner();
    ui.displayInfo(`Scanning for resumable downloads in: ${dest}`);

    const resumableDownloads = await resumeManager.getResumableDownloads(dest);
    ui.displayResumableList(resumableDownloads);

    if (resumableDownloads.length > 0) {
        ui.displayInfo('To resume downloads, run: nget resume -d <destination>, nget resume <number>, or nget resume all');
    }

    // Clean up old metadata
    await resumeManager.cleanupOldMetadata(dest);
}

/**
 * Main application entry point
 * Handles CLI argument parsing, validates options, and coordinates the download process.
 * Supports various modes: help, version, list resumable downloads, recursive downloads,
 * and standard file downloads with resume capability.
 * @async
 * @function main
 * @returns {Promise<void>}
 * @throws {Error} When invalid arguments or download failures occur
 */
async function main() {
    try {
        // Initialize ConfigManager
        try {
            const configOptions = {
                environment: argv['config-environment'] || process.env.NODE_ENV || 'development',
                enableHotReload: process.env.NODE_ENV === 'development'
            };
            configManager = new ConfigManager(configOptions);
            
            // Apply CLI configuration overrides
            Object.keys(argv).forEach(key => {
                if (key.startsWith('config-')) {
                    const configPath = key.replace('config-', '').replace(/-/g, '.');
                    if (configPath !== 'environment' && configPath !== 'ai.profile') {
                        try {
                            configManager.set(configPath, argv[key]);
                        } catch (error) {
                            console.warn(`Warning: Could not set config ${configPath}: ${error.message}`);
                        }
                    }
                }
            });
            
            // Apply AI profile if specified
            if (argv['config-ai-profile']) {
                try {
                    await configManager.applyProfile(argv['config-ai-profile']);
                } catch (error) {
                    console.warn(`Warning: Could not apply profile ${argv['config-ai-profile']}: ${error.message}`);
                }
            }
        } catch (error) {
            console.error('Failed to initialize configuration:', error.message);
            process.exit(1);
        }

        // Handle help
        if (argv.help) {
            showHelp();
            process.exit(0);
        }

        // Handle version
        if (argv.version) {
            const packageJson = require('./package.json');
            console.log(packageJson.version);
            process.exit(0);
        }

        // Handle destination
        if (argv.destination) {
            destination = argv.destination;
            const quietMode = argv.quiet || argv['output-file'] === '-';

            if (quietMode) {
                try {
                    const resolvedPath = await fs.realpath(destination);
                    destination = chdir(resolvedPath, true);
                } catch {
                    process.exit(1);
                }
            } else {
                const spinner = ui.createSpinner('Validating destination path...', ui.emojis.folder);
                spinner.spinner.start();

                try {
                    const resolvedPath = await fs.realpath(destination);
                    destination = chdir(resolvedPath, false);
                    spinner.spinner.succeed(`${ui.emojis.folder} Destination set: ${destination}`);
                } catch {
                    spinner.spinner.fail(`${ui.emojis.error} Invalid destination path: ${destination}`);
                    process.exit(1);
                }
            }
        }

        // Handle list resumable downloads
        if (argv['list-resume']) {
            await listResumableDownloads();
            process.exit(0);
        }

        // Handle resume command
        if (argv._.length > 0 && argv._[0] === 'resume') {
            const resumeArgument = argv._[1];

            // Check if it's a numbered selection (e.g., 1, 2, etc.) or 'all'
            if (resumeArgument && /^\d+$/.test(String(resumeArgument))) {
                const itemNumber = Number.parseInt(resumeArgument);
                const dest = destination || process.cwd();

                const resumableDownloads = await resumeManager.getResumableDownloads(dest);

                if (resumableDownloads.length === 0) {
                    console.error('Error: No resumable downloads found.');
                    process.exit(1);
                }

                if (itemNumber < 1 || itemNumber > resumableDownloads.length) {
                    console.error(`Error: Invalid item number ${itemNumber}. Available items: 1-${resumableDownloads.length}`);
                    process.exit(1);
                }

                const selectedDownload = resumableDownloads[itemNumber - 1];
                reqUrls.push(selectedDownload.url);

                const quietMode = argv.quiet || argv['output-file'] === '-';
                if (!quietMode) {
                    ui.displayInfo(`Resuming download #${itemNumber}: ${selectedDownload.url}`);
                    ui.displayInfo(`Target file: ${selectedDownload.filePath}`);
                }
            } else if (resumeArgument && String(resumeArgument).toLowerCase() === 'all') {
                // Resume all downloads
                const dest = destination || process.cwd();

                const resumableDownloads = await resumeManager.getResumableDownloads(dest);

                if (resumableDownloads.length === 0) {
                    console.error('Error: No resumable downloads found.');
                    process.exit(1);
                }

                // Add all URLs to the queue
                resumableDownloads.forEach(download => {
                    reqUrls.push(download.url);
                });

                const quietMode = argv.quiet || argv['output-file'] === '-';
                if (!quietMode) {
                    ui.displayInfo(`Resuming all ${resumableDownloads.length} downloads...`);
                    resumableDownloads.forEach((download, index) => {
                        ui.displayInfo(`  #${index + 1}: ${download.url}`);
                    });
                }
            } else {
                // Resume from specific directory (requires -d flag)
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

                const quietMode = argv.quiet || argv['output-file'] === '-';
                if (!quietMode) {
                    ui.displayInfo(`Resuming download: ${latestResumable.url}`);
                    ui.displayInfo(`Target file: ${latestResumable.filePath}`);
                }
            }
        } else {
            // Get URLs from remaining arguments or input file
            argv._.forEach(url => {
                if (url && typeof url === 'string') {
                    reqUrls.push(url);
                }
            });

            // Handle input file (including stdin)
            if (argv['input-file']) {
                const inputUrls = await readUrlsFromInput(argv['input-file']);
                reqUrls.push(...inputUrls);
            }

            if (reqUrls.length === 0) {
                console.error('Error: No URLs provided. Use \'nget --help\' for usage information.');
                process.exit(1);
            }
        }

        // Process URLs with spinner (unless in quiet mode)
        const quietMode = argv.quiet || argv['output-file'] === '-';
        let urlSpinner = null;

        if (!quietMode) {
            urlSpinner = ui.createSpinner('Processing URLs...', ui.emojis.network);
            urlSpinner.spinner.start();
        }

        // Process URLs - keep synchronous since uriManager is sync
        const processedUrls = reqUrls.map(uriManager);

        if (!quietMode && urlSpinner) {
            urlSpinner.spinner.succeed(`${ui.emojis.network} ${processedUrls.length} URL(s) processed`);
        }

        // Determine resume setting
        const enableResume = argv.resume && !argv['no-resume'];
        if (!enableResume && !quietMode) {
            ui.displayWarning('Resume functionality disabled');
        }

        // Build SSH options
        const sshOptions = {};
        if (argv['ssh-key']) {
            sshOptions.keyPath = argv['ssh-key'];
            if (!quietMode) {
                ui.displayInfo(`Using SSH key: ${argv['ssh-key']}`);
            }
        }

        if (argv['ssh-password']) {
            sshOptions.password = argv['ssh-password'];
            if (!quietMode) {
                ui.displayWarning('SSH password provided via command line (consider using key authentication)');
            }
        }

        if (argv['ssh-passphrase']) {
            sshOptions.passphrase = argv['ssh-passphrase'];
            if (!quietMode) {
                ui.displayInfo('SSH key passphrase provided');
            }
        }

        // Check for stdout output mode
        const outputToStdout = argv['output-file'] === '-';

        // Parse concurrency limit - use config value as default
        const configMaxConcurrent = configManager.get('downloads.maxConcurrent', 3);
        const maxConcurrent = Math.max(1, Number.parseInt(argv['max-concurrent']) || configMaxConcurrent);
        if (!quietMode && maxConcurrent !== configMaxConcurrent) {
            ui.displayInfo(`Using ${maxConcurrent} concurrent downloads`);
        }

        // Build download options
        const downloadOptions = {
            enableResume,
            sshOptions,
            outputToStdout,
            quietMode: quietMode || outputToStdout, // Auto-enable quiet mode for stdout
            maxConcurrent,
            configManager, // Pass config manager to download functions
        };

        // Check if recursive mode is enabled
        if (argv.recursive) {
            if (outputToStdout) {
                ui.displayError('Recursive mode is not compatible with stdout output (-o -)');
                process.exit(1);
            }

            // Parse patterns
            const acceptPatterns = argv.accept ? argv.accept.split(',').map(p => p.trim()) : [];
            const rejectPatterns = argv.reject ? argv.reject.split(',').map(p => p.trim()) : [];

            // Create recursive downloader with options
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
                configManager, // Pass config manager to recursive downloader
            };

            if (!quietMode) {
                ui.displayInfo(`Recursive mode enabled (depth: ${recursiveOptions.level})`);
                if (recursiveOptions.noParent) {
                    ui.displayInfo('Parent directory restriction enabled');
                }
            }

            const recursiveDownloader = new RecursiveDownloader(recursiveOptions);
            await recursiveDownloader.recursiveDownload(processedUrls, destination || process.cwd());
        } else {
            // Normal download mode
            const results = await recursivePipe(processedUrls, destination, downloadOptions);

            // Exit with error code if all downloads failed
            const allFailed = results.every(result => !result.success);
            if (allFailed && results.length > 0) {
                process.exit(1);
            }
        }
    } catch (error) {
        // Handle broken pipe errors gracefully (common in pipe scenarios)
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

main().catch(error => {
    // Handle broken pipe errors gracefully
    if (error.code === 'EPIPE' || error.errno === 'EPIPE') {
        process.exit(0);
    }

    console.error('Error:', error.message);
    process.exit(1);
});
