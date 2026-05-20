"use strict";
/**
 * @fileoverview History command-line interface
 * Handles download history management, search, analytics, and export commands
 * @module HistoryCommands
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
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs"));
const HistoryManager = require("../services/HistoryManager");
const OutputFormatterService = require("../services/OutputFormatterService");
/**
 * Handler for history CLI commands
 * Provides functionality to view, search, analyze, and manage download history
 */
class HistoryCommands {
    historyManager;
    outputFormatter;
    /**
     * Creates a new HistoryCommands instance
     */
    constructor() {
        this.historyManager = new HistoryManager();
        this.outputFormatter = new OutputFormatterService();
    }
    /**
     * Executes a history command based on arguments
     */
    async execute(args, argv) {
        if (args.length === 0) {
            this.showHelp();
            return;
        }
        const command = args[0];
        const destination = argv.destination || process.cwd();
        try {
            switch (command) {
                case 'show':
                    await this.handleShowCommand(destination, argv);
                    break;
                case 'clear':
                    await this.handleClearCommand(destination, argv);
                    break;
                case 'search':
                    await this.handleSearchCommand(args.slice(1), destination, argv);
                    break;
                case 'stats':
                    await this.handleStatsCommand(destination, argv);
                    break;
                case 'export':
                    await this.handleExportCommand(args.slice(1), destination, argv);
                    break;
                default:
                    console.error(`Unknown history command: ${command}`);
                    this.showHelp();
                    process.exit(1);
            }
        }
        catch (error) {
            console.error(`History command failed: ${error.message}`);
            process.exit(1);
        }
    }
    /**
     * Handles the show subcommand
     */
    async handleShowCommand(destination, argv) {
        const options = {
            limit: argv.limit ? parseInt(argv.limit) : 50,
            status: argv.status,
            since: argv.since ? new Date(argv.since) : null,
            until: argv.until ? new Date(argv.until) : null,
        };
        const entries = await this.historyManager.getHistory(destination, options);
        if (entries.length === 0) {
            console.log('No download history found.');
            return;
        }
        // Check for structured output format
        const outputFormat = argv['output-format'] || 'text';
        if (outputFormat !== 'text') {
            try {
                const formattedOutput = this.outputFormatter.formatHistoryOutput(entries, {
                    format: outputFormat,
                    compact: argv.quiet
                });
                console.log(formattedOutput);
                return;
            }
            catch (error) {
                console.error(`Error formatting output as ${outputFormat}:`, error.message);
                // Fall back to text output
            }
        }
        console.log(`\n📊 Download History (${entries.length} entries):`);
        console.log('═'.repeat(80));
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const status = this.formatStatus(entry.status);
            const timestamp = new Date(entry.timestamp).toLocaleString();
            const filename = path.basename(entry.filePath);
            const size = entry.size ? this.formatSize(entry.size) : 'Unknown';
            const duration = entry.duration ? `${entry.duration}ms` : 'N/A';
            console.log(`${i + 1}. ${status} ${filename}`);
            console.log(`   📅 ${timestamp}`);
            console.log(`   🔗 ${entry.url}`);
            console.log(`   📁 ${entry.filePath}`);
            console.log(`   📏 ${size} | ⏱️  ${duration}`);
            if (entry.error) {
                console.log(`   ❌ ${entry.error}`);
            }
            if (entry.correlationId) {
                console.log(`   🔍 ID: ${entry.correlationId}`);
            }
            console.log('');
        }
    }
    /**
     * Handles the clear subcommand
     */
    async handleClearCommand(destination, argv) {
        if (!argv.confirm && !argv.force) {
            console.log('⚠️  This will permanently delete all download history.');
            console.log('Use --confirm to proceed or --force to skip this warning.');
            return;
        }
        await this.historyManager.clearHistory(destination);
        console.log('✅ Download history cleared successfully.');
    }
    /**
     * Handles the search subcommand
     */
    async handleSearchCommand(searchArgs, destination, argv) {
        if (searchArgs.length === 0) {
            console.error('Search term is required.');
            console.log('Usage: nget history search <term> [options]');
            return;
        }
        const searchTerm = searchArgs.join(' ');
        const options = {
            search: searchTerm,
            limit: argv.limit ? parseInt(argv.limit) : 100,
            status: argv.status,
        };
        const entries = await this.historyManager.getHistory(destination, options);
        if (entries.length === 0) {
            console.log(`No downloads found matching: "${searchTerm}"`);
            return;
        }
        console.log(`\n🔍 Search Results for "${searchTerm}" (${entries.length} matches):`);
        console.log('═'.repeat(80));
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const status = this.formatStatus(entry.status);
            const timestamp = new Date(entry.timestamp).toLocaleDateString();
            const filename = path.basename(entry.filePath);
            console.log(`${i + 1}. ${status} ${filename} (${timestamp})`);
            console.log(`   🔗 ${entry.url}`);
            console.log('');
        }
    }
    /**
     * Handles the stats subcommand
     */
    async handleStatsCommand(destination, argv) {
        const days = argv.days ? parseInt(argv.days) : 30;
        const stats = await this.historyManager.getStatistics(destination, { days });
        console.log(`\n📈 Download Statistics (Last ${days} days):`);
        console.log('═'.repeat(50));
        console.log(`📊 Total Downloads: ${stats.totalDownloads}`);
        console.log(`✅ Successful: ${stats.successfulDownloads} (${stats.successRate}%)`);
        console.log(`❌ Failed: ${stats.failedDownloads}`);
        console.log(`⏳ In Progress: ${stats.inProgressDownloads}`);
        console.log(`📏 Total Size: ${this.formatSize(stats.totalSize)}`);
        console.log(`⏱️  Average Duration: ${stats.averageDuration}ms`);
        if (stats.sizeSummary.smallest !== null) {
            console.log('\n📦 Size Summary:');
            console.log(`   Smallest: ${this.formatSize(stats.sizeSummary.smallest)}`);
            console.log(`   Largest: ${this.formatSize(stats.sizeSummary.largest)}`);
            console.log(`   Average: ${this.formatSize(stats.sizeSummary.average)}`);
        }
        if (Object.keys(stats.topErrors).length > 0) {
            console.log('\n❌ Top Errors:');
            const sortedErrors = Object.entries(stats.topErrors)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5);
            for (const [error, count] of sortedErrors) {
                console.log(`   ${count}x ${error}`);
            }
        }
        if (Object.keys(stats.downloadsByDay).length > 0) {
            console.log('\n📅 Recent Activity:');
            const recentDays = Object.entries(stats.downloadsByDay)
                .sort(([a], [b]) => b.localeCompare(a))
                .slice(0, 7);
            for (const [day, count] of recentDays) {
                console.log(`   ${day}: ${count} downloads`);
            }
        }
    }
    /**
     * Handles the export subcommand
     */
    async handleExportCommand(exportArgs, destination, argv) {
        const format = argv.json ? 'json' : (argv.csv ? 'csv' : 'json');
        const outputFile = argv.output || `nget-history.${format}`;
        const options = {
            limit: argv.limit ? parseInt(argv.limit) : null,
            status: argv.status,
            since: argv.since ? new Date(argv.since) : null,
            until: argv.until ? new Date(argv.until) : null,
        };
        console.log(`📤 Exporting history to ${format.toUpperCase()} format...`);
        const exportData = await this.historyManager.exportHistory(destination, format, options);
        if (argv.output === '-' || outputFile === '-') {
            // Output to stdout
            console.log(exportData);
        }
        else {
            // Write to file
            const outputPath = path.resolve(outputFile);
            await fs.promises.writeFile(outputPath, exportData, 'utf8');
            console.log(`✅ History exported to: ${outputPath}`);
        }
    }
    /**
     * Format download status with emoji
     */
    formatStatus(status) {
        switch (status) {
            case 'success':
                return '✅ Success';
            case 'failed':
                return '❌ Failed';
            case 'in_progress':
                return '⏳ In Progress';
            default:
                return `❓ ${status}`;
        }
    }
    /**
     * Format file size in human-readable format
     */
    formatSize(bytes) {
        if (!bytes || bytes === 0) {
            return '0 B';
        }
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        const size = (bytes / Math.pow(1024, i)).toFixed(1);
        return `${size} ${sizes[i]}`;
    }
    /**
     * Shows help information for history commands
     */
    showHelp() {
        console.log('');
        console.log('History Commands:');
        console.log('  show                Show recent download history');
        console.log('  clear               Clear all download history');
        console.log('  search <term>       Search downloads by URL or filename');
        console.log('  stats               Show download statistics');
        console.log('  export              Export history data');
        console.log('');
        console.log('Show Options:');
        console.log('  --limit <number>    Maximum number of entries to show (default: 50)');
        console.log('  --status <status>   Filter by status (success, failed, in_progress)');
        console.log('  --since <date>      Show entries after this date');
        console.log('  --until <date>      Show entries before this date');
        console.log('');
        console.log('Clear Options:');
        console.log('  --confirm           Confirm deletion');
        console.log('  --force             Skip confirmation warning');
        console.log('');
        console.log('Search Options:');
        console.log('  --limit <number>    Maximum number of results (default: 100)');
        console.log('  --status <status>   Filter by status');
        console.log('');
        console.log('Stats Options:');
        console.log('  --days <number>     Number of days to analyze (default: 30)');
        console.log('');
        console.log('Export Options:');
        console.log('  --json              Export as JSON (default)');
        console.log('  --csv               Export as CSV');
        console.log('  --output <file>     Output file (use "-" for stdout)');
        console.log('  --limit <number>    Maximum entries to export');
        console.log('  --status <status>   Filter by status');
        console.log('  --since <date>      Export entries after this date');
        console.log('  --until <date>      Export entries before this date');
        console.log('');
        console.log('Examples:');
        console.log('  nget history show                           Show recent downloads');
        console.log('  nget history show --limit 10 --status success');
        console.log('  nget history search "example.com"          Search by URL');
        console.log('  nget history stats --days 7                Weekly stats');
        console.log('  nget history export --csv --output report.csv');
        console.log('  nget history clear --confirm                Clear all history');
        console.log('');
    }
}
module.exports = HistoryCommands;
