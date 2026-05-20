/**
 * @fileoverview Enhanced UI components for n-get with progress bars, emojis, and terminal output
 * Provides a comprehensive set of UI utilities for displaying download progress, status messages,
 * file type indicators, and formatted output with emoji support detection
 * @module ui
 */

import * as path from 'node:path';

import * as cliProgress from 'cli-progress';
// Colors is imported to extend String.prototype with color methods
require('colors');

interface EmojiMap {
    downloading: string;
    completed: string;
    error: string;
    warning: string;
    archive: string;
    document: string;
    image: string;
    video: string;
    audio: string;
    code: string;
    unknown: string;
    search: string;
    network: string;
    folder: string;
    rocket: string;
    gear: string;
    info: string;
    success: string;
    clock: string;
    size: string;
    speed: string;
    resume: string;
    pause: string;
    restart: string;
    partial: string;
    [key: string]: string;
}

interface MockSpinner {
    start: () => void;
    succeed: (message?: string) => void;
    fail: (message?: string) => void;
    stop: () => void;
}

interface SpinnerHandle {
    id: string;
    spinner: MockSpinner;
}

interface DisplaySummaryStats {
    totalFiles: number;
    successCount: number;
    errorCount: number;
    resumedCount: number;
    totalBytes: number;
    totalTime: number;
    averageSpeed: number;
    filePaths?: string[];
}

interface CrawlProgressStats {
    pagesVisited: number;
    filesFound: number;
    currentDepth: number;
    maxDepth: number;
    currentUrl?: string;
}

interface ResumableDownloadItem {
    filePath: string;
    url: string;
    currentSize: number;
    totalSize: number;
}

/**
 * Enhanced UI manager for n-get with cross-platform emoji support and progress tracking
 * Handles all terminal output including progress bars, status messages, and formatted displays
 */
class UIManager {
    multibar: cliProgress.MultiBar | null;
    spinners: Map<string, MockSpinner>;
    enableEmojis: boolean;

    /**
     * Creates a new UIManager instance
     */
    constructor() {
        this.multibar = null;
        this.spinners = new Map();
        this.enableEmojis = this.checkEmojiSupport();
    }

    /**
     * Detects if the current terminal supports UTF-8 emojis
     */
    checkEmojiSupport(): boolean {
        return process.env.TERM !== 'dumb'
        	&& process.platform !== 'win32'
        	&& !process.env.CI;
    }

    // Emoji collections for different states
    get emojis(): EmojiMap {
        return {
            // Download states
            downloading: this.enableEmojis ? '⬇️' : '>>',
            completed: this.enableEmojis ? '✅' : '[OK]',
            error: this.enableEmojis ? '❌' : '[ERR]',
            warning: this.enableEmojis ? '⚠️' : '[WARN]',

            // File types
            archive: this.enableEmojis ? '📦' : '[ZIP]',
            document: this.enableEmojis ? '📄' : '[DOC]',
            image: this.enableEmojis ? '🖼️' : '[IMG]',
            video: this.enableEmojis ? '🎬' : '[VID]',
            audio: this.enableEmojis ? '🎵' : '[AUD]',
            code: this.enableEmojis ? '💻' : '[CODE]',
            unknown: this.enableEmojis ? '📁' : '[FILE]',

            // Operations
            search: this.enableEmojis ? '🔍' : '[FIND]',
            network: this.enableEmojis ? '🌐' : '[NET]',
            folder: this.enableEmojis ? '📂' : '[DIR]',
            rocket: this.enableEmojis ? '🚀' : '[GO]',
            gear: this.enableEmojis ? '⚙️' : '[CONF]',

            // Status
            info: this.enableEmojis ? 'ℹ️' : '[INFO]',
            success: this.enableEmojis ? '🎉' : '[SUCCESS]',
            clock: this.enableEmojis ? '⏱️' : '[TIME]',
            size: this.enableEmojis ? '📏' : '[SIZE]',
            speed: this.enableEmojis ? '⚡' : '[SPEED]',

            // Resume functionality
            resume: this.enableEmojis ? '▶️' : '[RESUME]',
            pause: this.enableEmojis ? '⏸️' : '[PAUSE]',
            restart: this.enableEmojis ? '🔄' : '[RESTART]',
            partial: this.enableEmojis ? '📋' : '[PARTIAL]',
        };
    }

    // Get emoji for file type based on extension
    getFileTypeEmoji(filename: string): string {
        const extension = filename.toLowerCase().split('.').pop() || '';
        const typeMap: Record<string, string> = {
            // Archives
            zip: this.emojis.archive,
            tar: this.emojis.archive,
            gz: this.emojis.archive,
            rar: this.emojis.archive,
            '7z': this.emojis.archive,

            // Documents
            pdf: this.emojis.document,
            doc: this.emojis.document,
            docx: this.emojis.document,
            txt: this.emojis.document,
            md: this.emojis.document,

            // Images
            jpg: this.emojis.image,
            jpeg: this.emojis.image,
            png: this.emojis.image,
            gif: this.emojis.image,
            svg: this.emojis.image,

            // Videos
            mp4: this.emojis.video,
            avi: this.emojis.video,
            mkv: this.emojis.video,
            mov: this.emojis.video,

            // Audio
            mp3: this.emojis.audio,
            wav: this.emojis.audio,
            flac: this.emojis.audio,

            // Code
            js: this.emojis.code,
            py: this.emojis.code,
            java: this.emojis.code,
            cpp: this.emojis.code,
            html: this.emojis.code,
        };

        return typeMap[extension] || this.emojis.unknown;
    }

    // Create a progress bar for downloads
    createProgressBar(label: string, total: number): cliProgress.SingleBar {
        this.multibar ||= new cliProgress.MultiBar({
            clearOnComplete: false,
            hideCursor: true,
            format: ' {bar} {percentage}% | {filename} | {value}/{total} | {speed} | ETA: {eta}s',
            barCompleteChar: this.enableEmojis ? '█' : '#',
            barIncompleteChar: this.enableEmojis ? '░' : '-',
            barsize: 30,
        }, cliProgress.Presets.shades_classic);

        return this.multibar.create(total, 0, {
            filename: label,
            speed: 'N/A',
        });
    }

    // Create a simple text-based spinner for indeterminate operations
    createSpinner(text: string, emoji: string = this.emojis.gear): SpinnerHandle {
        const mockSpinner: MockSpinner = {
            start: () => console.log(`${emoji} ${text}...`),
            succeed: (message?: string) => console.log(`${this.emojis.completed} ${message || text}`),
            fail: (message?: string) => console.log(`${this.emojis.error} ${message || text}`),
            stop() {},
        };

        const id = Date.now().toString();
        this.spinners.set(id, mockSpinner);
        return {id, spinner: mockSpinner};
    }

    // Stop a specific spinner
    stopSpinner(id: string, success: boolean = true, message: string = ''): void {
        const spinner = this.spinners.get(id);
        if (spinner) {
            if (success) {
                spinner.succeed(message || (spinner as any).text);
            } else {
                spinner.fail(message || (spinner as any).text);
            }

            this.spinners.delete(id);
        }
    }

    // Display enhanced download info
    displayDownloadStart(filename: string, fileSize: number, index: number, total: number, isResume: boolean = false, resumeFrom: number = 0): void {
        const emoji = this.getFileTypeEmoji(filename);
        const sizeText = fileSize ? ` (${this.formatBytes(fileSize)})` : '';
        const resumeText = isResume ? ` ${this.emojis.resume} Resuming from ${this.formatBytes(resumeFrom)}` : '';

        console.log(`\n${this.emojis.downloading} [${index}/${total}] ${emoji} ${filename}${sizeText}${resumeText}`);
    }

    // Display download completion
    displayDownloadComplete(filename: string, fileSize: number, duration: number, speed: number): void {
        const emoji = this.getFileTypeEmoji(filename);
        const sizeText = fileSize ? ` ${this.emojis.size} ${this.formatBytes(fileSize)}` : '';
        const speedText = speed ? ` ${this.emojis.speed} ${this.formatSpeed(speed)}` : '';
        const timeText = ` ${this.emojis.clock} ${duration.toFixed(1)}s`;

        console.log(`${this.emojis.completed} ${emoji} ${filename}${sizeText}${speedText}${timeText}`);
    }

    // Display error with context
    displayError(message: string, context: string = ''): void {
        const contextText = context ? ` (${context})` : '';
        console.log((`${this.emojis.error} ${message}${contextText}` as any).red);
    }

    // Display warning
    displayWarning(message: string): void {
        console.log((`${this.emojis.warning} ${message}` as any).yellow);
    }

    // Display info message
    displayInfo(message: string): void {
        console.log((`${this.emojis.info} ${message}` as any).cyan);
    }

    // Display resume information
    displayResumeInfo(filename: string, resumeFrom: number, totalSize: number): void {
        const percentage = totalSize ? ((resumeFrom / totalSize) * 100).toFixed(1) : '??';
        console.log((`${this.emojis.resume} Resuming ${filename} from ${this.formatBytes(resumeFrom)} (${percentage}%)` as any).yellow);
    }

    // Display resumable downloads list
    displayResumableList(resumableDownloads: ResumableDownloadItem[]): void {
        if (resumableDownloads.length === 0) {
            console.log((`${this.emojis.info} No resumable downloads found` as any).cyan);
            return;
        }

        console.log((`\n${this.emojis.partial} Found ${resumableDownloads.length} resumable download(s):` as any).bold.cyan);
        console.log(('━'.repeat(60) as any).gray);

        resumableDownloads.forEach((download, index) => {
            const filename = path.basename(download.filePath);
            const progress = download.totalSize
                ? ((download.currentSize / download.totalSize) * 100).toFixed(1)
                : '??';
            const sizeText = `${this.formatBytes(download.currentSize)}/${this.formatBytes(download.totalSize)}`;

            console.log(`${index + 1}. ${this.getFileTypeEmoji(filename)} ${filename}`);
            console.log((`   ${this.emojis.size} ${sizeText} (${progress}% complete)` as any).gray);
            console.log((`   ${this.emojis.network} ${download.url}` as any).gray);
        });
        console.log(('━'.repeat(60) as any).gray);
    }

    // Display success message
    displaySuccess(message: string): void {
        console.log((`${this.emojis.success} ${message}` as any).green);
    }

    // Display summary with statistics including resume info
    displaySummary(stats: DisplaySummaryStats): void {
        const {
            totalFiles,
            successCount,
            errorCount,
            resumedCount,
            totalBytes,
            totalTime,
            averageSpeed,
            filePaths,
        } = stats;

        console.log((`\n${'═'.repeat(60)}` as any).cyan);

        // Show error state if no successful downloads, otherwise show success
        if (successCount === 0 && errorCount > 0) {
            console.log((`${this.emojis.error} Download Summary` as any).bold.red);
        } else {
            console.log((`${this.emojis.success} Download Summary` as any).bold.green);
        }

        console.log((`${'═'.repeat(60)}` as any).cyan);

        console.log((`${this.emojis.completed} Successful: ${successCount}/${totalFiles}` as any).green);

        if (resumedCount > 0) {
            console.log((`${this.emojis.resume} Resumed: ${resumedCount}/${totalFiles}` as any).yellow);
        }

        if (errorCount > 0) {
            console.log((`${this.emojis.error} Failed: ${errorCount}/${totalFiles}` as any).red);
        }

        if (totalBytes > 0) {
            console.log((`${this.emojis.size} Total size: ${this.formatBytes(totalBytes)}` as any).blue);
        }

        if (totalTime > 0) {
            console.log((`${this.emojis.clock} Total time: ${(totalTime / 1000).toFixed(1)}s` as any).yellow);
        }

        // Display file paths
        if (filePaths && filePaths.length > 0) {
            console.log((`${this.emojis.folder} Downloaded files:` as any).cyan);
            filePaths.forEach((filePath, index) => {
                const displayPath = path.relative(process.cwd(), filePath) || path.basename(filePath);
                console.log((`  ${index + 1}. ${displayPath}` as any).gray);
            });
        }

        if (averageSpeed > 0) {
            console.log((`${this.emojis.speed} Average speed: ${this.formatSpeed(averageSpeed)}` as any).magenta);
        }

        console.log((`${'═'.repeat(60)}` as any).cyan);
    }

    // Display crawling progress
    displayCrawlProgress(stats: CrawlProgressStats): void {
        const {
            pagesVisited,
            filesFound,
            currentDepth,
            maxDepth,
            currentUrl,
        } = stats;

        console.log(`${this.emojis.search} Crawling... Pages: ${pagesVisited} | Files: ${filesFound} | Depth: ${currentDepth}/${maxDepth}`);
        if (currentUrl) {
            console.log((`${this.emojis.network} Current: ${currentUrl}` as any).gray);
        }
    }

    // Format bytes to human readable
    formatBytes(bytes: number): string {
        if (bytes === 0) {
            return '0 B';
        }

        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
    }

    // Format speed to human readable
    formatSpeed(bytesPerSecond: number): string {
        return `${this.formatBytes(bytesPerSecond)}/s`;
    }

    // Show ASCII art banner
    displayBanner(): void {
        if (!this.enableEmojis) {
            return;
        }

        console.log(`
${('n-get' as any).bold.cyan}
${('━'.repeat(40) as any).gray}
        `.trim());
    }

    // Clean up resources
    cleanup(): void {
        // Stop all remaining spinners
        for (const [_id, spinner] of this.spinners) {
            spinner.stop();
        }

        this.spinners.clear();

        // Stop multibar
        if (this.multibar) {
            this.multibar.stop();
            // Clear the progress bar line
            process.stdout.write('[1A[2K');
            this.multibar = null;
        }
    }
}

// Singleton instance
const ui = new UIManager();

// Graceful cleanup on exit
process.on('SIGINT', () => {
    ui.cleanup();
    process.exit(0);
});

process.on('SIGTERM', () => {
    ui.cleanup();
    process.exit(0);
});

export = ui;
