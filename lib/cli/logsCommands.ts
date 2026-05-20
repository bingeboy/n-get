/**
 * @fileoverview Logs command-line interface
 * Handles logs format configuration and management commands
 * @module LogsCommands
 */

interface ParsedArgv {
    json?: boolean;
    csv?: boolean;
    text?: boolean;
    [key: string]: unknown;
}

/**
 * Handler for logs CLI commands
 * Provides functionality to manage logging format and configuration
 */
class LogsCommands {
    private validFormats: string[];
    private defaultFormat: string;

    /**
     * Creates a new LogsCommands instance
     */
    constructor() {
        this.validFormats = ['text', 'json', 'csv'];
        this.defaultFormat = 'text';
    }

    /**
     * Executes a logs command based on arguments
     * @param args - Command arguments
     * @param argv - Parsed CLI arguments
     */
    async execute(args: string[], argv: ParsedArgv): Promise<void> {
        if (args.length === 0) {
            this.showHelp();
            return;
        }

        const command = args[0];

        switch (command) {
        case 'format':
            await this.handleFormatCommand(args.slice(1), argv);
            break;
        default:
            console.error(`Unknown logs command: ${command}`);
            this.showHelp();
            process.exit(1);
        }
    }

    /**
     * Handles the format subcommand
     * @param args - Format command arguments
     * @param argv - Parsed CLI arguments
     */
    async handleFormatCommand(args: string[], argv: ParsedArgv): Promise<void> {
        // Check for format flags
        if (argv.json) {
            console.log('Logging format set to: json');
            process.env.NGET_LOG_FORMAT = 'json';
            return;
        }

        if (argv.csv) {
            console.log('Logging format set to: csv');
            process.env.NGET_LOG_FORMAT = 'csv';
            return;
        }

        if (argv.text) {
            console.log('Logging format set to: text');
            process.env.NGET_LOG_FORMAT = 'text';
            return;
        }

        // No flags provided, show current format
        const currentFormat = process.env.NGET_LOG_FORMAT || this.defaultFormat;
        console.log(`Current logging format: ${currentFormat}`);
        console.log('Available formats: text, json, csv');
        console.log('');
        console.log('Usage:');
        console.log('  nget logs format --json    Set JSON format');
        console.log('  nget logs format --csv     Set CSV format');
        console.log('  nget logs format --text    Set text format (default)');
    }

    /**
     * Shows help information for logs commands
     */
    showHelp(): void {
        console.log('');
        console.log('Logs Commands:');
        console.log('  format              Show or set logging format');
        console.log('');
        console.log('Format Options:');
        console.log('  --json              Use JSON structured logging');
        console.log('  --csv               Use CSV logging format');
        console.log('  --text              Use human-readable text format (default)');
        console.log('');
        console.log('Examples:');
        console.log('  nget logs format                    Show current format');
        console.log('  nget logs format --json             Set JSON format');
        console.log('  nget logs format --csv              Set CSV format');
        console.log('  nget logs format --text             Set text format');
        console.log('');
    }
}

export = LogsCommands;
