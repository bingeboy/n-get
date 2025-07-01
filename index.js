#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;
const minimist = require('minimist');
const chdir = require('./lib/chdir');
const uriManager = require('./lib/uriManager');
const recursivePipe = require('./lib/recursivePipe');
const ui = require('./lib/ui');
const resumeManager = require('./lib/resumeManager');
const RecursiveDownloader = require('./lib/recursiveDownloader');

const argv = minimist(process.argv.slice(2), {
    boolean: ['resume', 'no-resume', 'list-resumable', 'help', 'recursive', 'no-parent'],
    string: ['d', 'destination', 'ssh-key', 'ssh-password', 'ssh-passphrase', 'level', 'accept', 'reject', 'user-agent'],
    alias: {
        'd': 'destination',
        'r': 'resume',
        'l': 'list-resumable',
        'h': 'help',
        'R': 'recursive',
        'np': 'no-parent',
        'A': 'accept',
        'j': 'reject'
    },
    default: {
        'resume': true,
        'level': 5
    }
});

let destination;
const reqUrls = [];

function showHelp() {
    ui.displayBanner();
    console.log(`
${ui.emojis.info} Usage: nget [options] <url1> [url2] ...

${ui.emojis.gear} General Options:
  -d, --destination <path>    Destination directory for downloads
  -r, --resume               Enable resume for interrupted downloads (default: true)
  --no-resume                Disable resume functionality
  -l, --list-resumable       List resumable downloads in destination
  -h, --help                 Show this help message

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
  nget --list-resumable -d ./downloads

${ui.emojis.partial} Resume Features:
  • Automatically resumes interrupted downloads (HTTP & SFTP)
  • Validates file integrity with ETag/Last-Modified
  • Supports HTTP range requests and SFTP resume
  • Smart duplicate file handling

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

async function listResumableDownloads() {
    const dest = destination || process.cwd();
    
    ui.displayBanner();
    ui.displayInfo(`Scanning for resumable downloads in: ${dest}`);
    
    const resumableDownloads = await resumeManager.getResumableDownloads(dest);
    ui.displayResumableList(resumableDownloads);
    
    if (resumableDownloads.length > 0) {
        ui.displayInfo('To resume downloads, run: nget <original-url> -d <destination>');
    }
    
    // Clean up old metadata
    await resumeManager.cleanupOldMetadata(dest);
}

async function main() {
    try {
        // Handle help
        if (argv.help) {
            showHelp();
            process.exit(0);
        }

        // Handle destination
        if (argv.destination) {
            destination = argv.destination;
            const spinner = ui.createSpinner('Validating destination path...', ui.emojis.folder);
            spinner.spinner.start();
            
            try {
                const resolvedPath = await fs.realpath(destination);
                destination = chdir(resolvedPath);
                spinner.spinner.succeed(`${ui.emojis.folder} Destination set: ${destination}`);
            } catch (err) {
                spinner.spinner.fail(`${ui.emojis.error} Invalid destination path: ${destination}`);
                process.exit(1);
            }
        }

        // Handle list resumable downloads
        if (argv['list-resumable']) {
            await listResumableDownloads();
            process.exit(0);
        }

        // Get URLs from remaining arguments
        argv._.forEach(url => {
            if (url && typeof url === 'string') {
                reqUrls.push(url);
            }
        });

        if (reqUrls.length === 0) {
            showHelp();
            process.exit(1);
        }

        // Process URLs with spinner
        const urlSpinner = ui.createSpinner('Processing URLs...', ui.emojis.network);
        urlSpinner.spinner.start();
        
        const processedUrls = reqUrls.map(uriManager);
        urlSpinner.spinner.succeed(`${ui.emojis.network} ${processedUrls.length} URL(s) processed`);

        // Determine resume setting
        const enableResume = argv.resume && !argv['no-resume'];
        if (!enableResume) {
            ui.displayWarning('Resume functionality disabled');
        }

        // Build SSH options
        const sshOptions = {};
        if (argv['ssh-key']) {
            sshOptions.keyPath = argv['ssh-key'];
            ui.displayInfo(`Using SSH key: ${argv['ssh-key']}`);
        }
        if (argv['ssh-password']) {
            sshOptions.password = argv['ssh-password'];
            ui.displayWarning('SSH password provided via command line (consider using key authentication)');
        }
        if (argv['ssh-passphrase']) {
            sshOptions.passphrase = argv['ssh-passphrase'];
            ui.displayInfo('SSH key passphrase provided');
        }

        // Check if recursive mode is enabled
        if (argv.recursive) {
            // Parse patterns
            const acceptPatterns = argv.accept ? argv.accept.split(',').map(p => p.trim()) : [];
            const rejectPatterns = argv.reject ? argv.reject.split(',').map(p => p.trim()) : [];
            
            // Create recursive downloader with options
            const recursiveOptions = {
                level: parseInt(argv.level) || 5,
                noParent: argv['no-parent'] || false,
                accept: acceptPatterns,
                reject: rejectPatterns,
                enableResume: enableResume,
                sshOptions: sshOptions,
                userAgent: argv['user-agent'] || 'n-get-recursive/1.0'
            };
            
            ui.displayInfo(`Recursive mode enabled (depth: ${recursiveOptions.level})`);
            if (recursiveOptions.noParent) {
                ui.displayInfo('Parent directory restriction enabled');
            }
            
            const recursiveDownloader = new RecursiveDownloader(recursiveOptions);
            await recursiveDownloader.recursiveDownload(processedUrls, destination || process.cwd());
        } else {
            // Normal download mode
            await recursivePipe(processedUrls, destination, enableResume, sshOptions);
        }
        
    } catch (error) {
        ui.displayError(`Application error: ${error.message}`);
        ui.cleanup();
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
