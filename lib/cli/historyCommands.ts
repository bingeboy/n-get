/**
 * @fileoverview History command-line interface
 * Handles download history management, search, analytics, and export commands
 * @module HistoryCommands
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

import HistoryManager = require('../services/HistoryManager');
import OutputFormatterService = require('../services/OutputFormatterService');

/**
 * Handler for history CLI commands
 * Provides functionality to view, search, analyze, and manage download history
 */
class HistoryCommands {
    historyManager: InstanceType<typeof HistoryManager>;
    outputFormatter: InstanceType<typeof OutputFormatterService>;

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
    async execute(args: string[], argv: any): Promise<void> {
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
        } catch (error: any) {
            console.error(`History command failed: ${error.message}`);
            process.exit(1);
        }
    }

    /**
     * Extracts agent-identity filters from argv.
     * These are opaque, caller-supplied identifiers matched exactly.
     */
    identityFilters(argv: any): Record<string, string | undefined> {
        return {
            agentId: argv['agent-id'],
            sessionId: argv['session-id'],
            requestId: argv['request-id'],
            conversationId: argv['conversation-id'],
        };
    }

    /**
     * Parses a --since/--until value. Accepts anything Date can parse, plus
     * relative durations like "45s", "30m", "1h", "7d", "2w" (meaning "that
     * long before now").
     */
    parseDateOption(value: string): Date {
        const relative = /^(\d+)([smhdw])$/.exec(value);
        if (relative) {
            const amount = parseInt(relative[1], 10);
            const unitMs: Record<string, number> = {
                s: 1000,
                m: 60 * 1000,
                h: 60 * 60 * 1000,
                d: 24 * 60 * 60 * 1000,
                w: 7 * 24 * 60 * 60 * 1000,
            };
            return new Date(Date.now() - amount * unitMs[relative[2]]);
        }
        return new Date(value);
    }

    /**
     * Handles the show subcommand
     */
    async handleShowCommand(destination: string, argv: any): Promise<void> {
        const options = {
            limit: argv.limit ? parseInt(argv.limit) : 50,
            status: argv.status,
            since: argv.since ? this.parseDateOption(argv.since) : null,
            until: argv.until ? this.parseDateOption(argv.until) : null,
            ...this.identityFilters(argv),
        };

        const entries = await this.historyManager.getHistory(destination, options);

        // Check for structured output format.
        //
        // This is deliberately ahead of the empty-result check. An empty
        // history is a normal, valid result — for an agent it is the single
        // most likely one, since a fresh environment has no history yet — and
        // it still has to come back as a parseable payload with an empty
        // entries array. Returning "No download history found." here made the
        // command emit unparseable text in exactly the case an agent hits
        // first. formatHistoryOutput already renders an empty array correctly
        // (totalEntries 0, entries []); it was simply never reached.
        const outputFormat = argv['output-format'] || 'text';

        if (outputFormat !== 'text') {
            try {
                const formattedOutput = this.outputFormatter.formatHistoryOutput(entries, {
                    format: outputFormat,
                    compact: argv.quiet
                });
                console.log(formattedOutput);
                return;
            } catch (error: any) {
                console.error(`Error formatting output as ${outputFormat}:`, error.message);
                // Fall back to text output
            }
        }

        // Text mode only: a human reads a sentence, not an empty table.
        if (entries.length === 0) {
            console.log('No download history found.');
            return;
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

            if (entry.agentId) {
                console.log(`   🤖 Agent: ${entry.agentId}`);
            }

            if (entry.sessionId) {
                console.log(`   🧵 Session: ${entry.sessionId}`);
            }

            if (entry.conversationId) {
                console.log(`   💬 Conversation: ${entry.conversationId}`);
            }

            console.log('');
        }
    }

    /**
     * Handles the clear subcommand
     */
    async handleClearCommand(destination: string, argv: any): Promise<void> {
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
    async handleSearchCommand(searchArgs: string[], destination: string, argv: any): Promise<void> {
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
            ...this.identityFilters(argv),
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
    async handleStatsCommand(destination: string, argv: any): Promise<void> {
        const days = argv.days ? parseInt(argv.days) : 30;
        const stats = await this.historyManager.getStatistics(destination, {days});

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
                .sort(([,a], [,b]) => (b as number) - (a as number))
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
    async handleExportCommand(exportArgs: string[], destination: string, argv: any): Promise<void> {
        const format = argv.json ? 'json' : (argv.csv ? 'csv' : 'json');
        const outputFile = argv.output || `nget-history.${format}`;

        const options = {
            limit: argv.limit ? parseInt(argv.limit) : null,
            status: argv.status,
            since: argv.since ? this.parseDateOption(argv.since) : null,
            until: argv.until ? this.parseDateOption(argv.until) : null,
            ...this.identityFilters(argv),
        };

        console.log(`📤 Exporting history to ${format.toUpperCase()} format...`);

        const exportData: string = await this.historyManager.exportHistory(destination, format, options);

        if (argv.output === '-' || outputFile === '-') {
            // Output to stdout
            console.log(exportData);
        } else {
            // Write to file
            const outputPath = path.resolve(outputFile);
            await fs.promises.writeFile(outputPath, exportData, 'utf8');
            console.log(`✅ History exported to: ${outputPath}`);
        }
    }

    /**
     * Format download status with emoji
     */
    formatStatus(status: string): string {
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
    formatSize(bytes: number): string {
        if (!bytes || bytes === 0) {return '0 B';}

        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        const size = (bytes / Math.pow(1024, i)).toFixed(1);

        return `${size} ${sizes[i]}`;
    }

    /**
     * Shows help information for history commands
     */
    showHelp(): void {
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
        console.log('  --since <date>      Show entries after this date (or relative: 30m, 1h, 7d, 2w)');
        console.log('  --until <date>      Show entries before this date (or relative)');
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
        console.log('  --since <date>      Export entries after this date (or relative: 1h, 7d)');
        console.log('  --until <date>      Export entries before this date (or relative)');
        console.log('');
        console.log('Agent Filters (show, search, export):');
        console.log('  --agent-id <id>         Filter by agent identifier');
        console.log('  --session-id <id>       Filter by session identifier');
        console.log('  --request-id <id>       Filter by request identifier');
        console.log('  --conversation-id <id>  Filter by conversation identifier');
        console.log('');
        console.log('Examples:');
        console.log('  nget history show                           Show recent downloads');
        console.log('  nget history show --limit 10 --status success');
        console.log('  nget history show --agent-id my-agent --since 1h --output-format json');
        console.log('  nget history search "example.com"          Search by URL');
        console.log('  nget history stats --days 7                Weekly stats');
        console.log('  nget history export --csv --output report.csv');
        console.log('  nget history clear --confirm                Clear all history');
        console.log('');
    }
}

export = HistoryCommands;
