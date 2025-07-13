const cliProgress = require('cli-progress');
const colors = require('colors');
const path = require('path');

/**
 * Enhanced UI components for n-get with progress bars and emojis
 */

class UIManager {
    constructor() {
        this.multibar = null;
        this.spinners = new Map();
        this.enableEmojis = this.checkEmojiSupport();
    }

    checkEmojiSupport() {
        // Check if terminal supports UTF-8 emojis
        return process.env.TERM !== 'dumb' && 
               process.platform !== 'win32' && 
               !process.env.CI;
    }

    // Emoji collections for different states
    get emojis() {
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
            partial: this.enableEmojis ? '📋' : '[PARTIAL]'
        };
    }

    // Get emoji for file type based on extension
    getFileTypeEmoji(filename) {
        const ext = filename.toLowerCase().split('.').pop();
        const typeMap = {
            // Archives
            'zip': this.emojis.archive,
            'tar': this.emojis.archive,
            'gz': this.emojis.archive,
            'rar': this.emojis.archive,
            '7z': this.emojis.archive,
            
            // Documents
            'pdf': this.emojis.document,
            'doc': this.emojis.document,
            'docx': this.emojis.document,
            'txt': this.emojis.document,
            'md': this.emojis.document,
            
            // Images
            'jpg': this.emojis.image,
            'jpeg': this.emojis.image,
            'png': this.emojis.image,
            'gif': this.emojis.image,
            'svg': this.emojis.image,
            
            // Videos
            'mp4': this.emojis.video,
            'avi': this.emojis.video,
            'mkv': this.emojis.video,
            'mov': this.emojis.video,
            
            // Audio
            'mp3': this.emojis.audio,
            'wav': this.emojis.audio,
            'flac': this.emojis.audio,
            
            // Code
            'js': this.emojis.code,
            'py': this.emojis.code,
            'java': this.emojis.code,
            'cpp': this.emojis.code,
            'html': this.emojis.code
        };
        
        return typeMap[ext] || this.emojis.unknown;
    }

    // Create a progress bar for downloads
    createProgressBar(label, total) {
        if (!this.multibar) {
            this.multibar = new cliProgress.MultiBar({
                clearOnComplete: false,
                hideCursor: true,
                format: ' {bar} {percentage}% | {filename} | {value}/{total} | {speed} | ETA: {eta}s',
                barCompleteChar: this.enableEmojis ? '█' : '#',
                barIncompleteChar: this.enableEmojis ? '░' : '-',
                barsize: 30
            }, cliProgress.Presets.shades_classic);
        }

        return this.multibar.create(total, 0, {
            filename: label,
            speed: 'N/A'
        });
    }

    // Create a simple text-based spinner for indeterminate operations
    createSpinner(text, emoji = this.emojis.gear) {
        const mockSpinner = {
            start: () => console.log(`${emoji} ${text}...`),
            succeed: (msg) => console.log(`${this.emojis.completed} ${msg || text}`),
            fail: (msg) => console.log(`${this.emojis.error} ${msg || text}`),
            stop: () => {}
        };
        
        const id = Date.now().toString();
        this.spinners.set(id, mockSpinner);
        return { id, spinner: mockSpinner };
    }

    // Stop a specific spinner
    stopSpinner(id, success = true, message = '') {
        const spinner = this.spinners.get(id);
        if (spinner) {
            if (success) {
                spinner.succeed(message || spinner.text);
            } else {
                spinner.fail(message || spinner.text);
            }
            this.spinners.delete(id);
        }
    }

    // Display enhanced download info
    displayDownloadStart(filename, fileSize, index, total, isResume = false, resumeFrom = 0) {
        const emoji = this.getFileTypeEmoji(filename);
        const sizeText = fileSize ? ` (${this.formatBytes(fileSize)})` : '';
        const resumeText = isResume ? ` ${this.emojis.resume} Resuming from ${this.formatBytes(resumeFrom)}` : '';
        
        console.log(`\n${this.emojis.downloading} [${index}/${total}] ${emoji} ${filename}${sizeText}${resumeText}`);
    }

    // Display download completion
    displayDownloadComplete(filename, fileSize, duration, speed) {
        const emoji = this.getFileTypeEmoji(filename);
        const sizeText = fileSize ? ` ${this.emojis.size} ${this.formatBytes(fileSize)}` : '';
        const speedText = speed ? ` ${this.emojis.speed} ${this.formatSpeed(speed)}` : '';
        const timeText = ` ${this.emojis.clock} ${duration.toFixed(1)}s`;
        
        console.log(`${this.emojis.completed} ${emoji} ${filename}${sizeText}${speedText}${timeText}`);
    }

    // Display error with context
    displayError(message, context = '') {
        const contextText = context ? ` (${context})` : '';
        console.log(`${this.emojis.error} ${message}${contextText}`.red);
    }

    // Display warning
    displayWarning(message) {
        console.log(`${this.emojis.warning} ${message}`.yellow);
    }

    // Display info message
    displayInfo(message) {
        console.log(`${this.emojis.info} ${message}`.cyan);
    }

    // Display resume information
    displayResumeInfo(filename, resumeFrom, totalSize) {
        const percentage = totalSize ? ((resumeFrom / totalSize) * 100).toFixed(1) : '??';
        console.log(`${this.emojis.resume} Resuming ${filename} from ${this.formatBytes(resumeFrom)} (${percentage}%)`.yellow);
    }

    // Display resumable downloads list
    displayResumableList(resumableDownloads) {
        if (resumableDownloads.length === 0) {
            console.log(`${this.emojis.info} No resumable downloads found`.cyan);
            return;
        }

        console.log(`\n${this.emojis.partial} Found ${resumableDownloads.length} resumable download(s):`.bold.cyan);
        console.log('━'.repeat(60).gray);
        
        resumableDownloads.forEach((download, index) => {
            const filename = path.basename(download.filePath);
            const progress = download.totalSize ? 
                ((download.currentSize / download.totalSize) * 100).toFixed(1) : '??';
            const sizeText = `${this.formatBytes(download.currentSize)}/${this.formatBytes(download.totalSize)}`;
            
            console.log(`${index + 1}. ${this.getFileTypeEmoji(filename)} ${filename}`);
            console.log(`   ${this.emojis.size} ${sizeText} (${progress}% complete)`.gray);
            console.log(`   ${this.emojis.network} ${download.url}`.gray);
        });
        console.log('━'.repeat(60).gray);
    }

    // Display success message
    displaySuccess(message) {
        console.log(`${this.emojis.success} ${message}`.green);
    }

    // Display summary with statistics including resume info
    displaySummary(stats) {
        const {
            totalFiles,
            successCount,
            errorCount,
            resumedCount,
            totalBytes,
            totalTime,
            averageSpeed
        } = stats;

        console.log(`\n${'═'.repeat(60)}`.cyan);
        console.log(`${this.emojis.success} Download Summary`.bold.green);
        console.log(`${'═'.repeat(60)}`.cyan);
        
        console.log(`${this.emojis.completed} Successful: ${successCount}/${totalFiles}`.green);
        
        if (resumedCount > 0) {
            console.log(`${this.emojis.resume} Resumed: ${resumedCount}/${totalFiles}`.yellow);
        }
        
        if (errorCount > 0) {
            console.log(`${this.emojis.error} Failed: ${errorCount}/${totalFiles}`.red);
        }
        
        if (totalBytes > 0) {
            console.log(`${this.emojis.size} Total size: ${this.formatBytes(totalBytes)}`.blue);
        }
        
        if (totalTime > 0) {
            console.log(`${this.emojis.clock} Total time: ${(totalTime / 1000).toFixed(1)}s`.yellow);
        }
        
        if (averageSpeed > 0) {
            console.log(`${this.emojis.speed} Average speed: ${this.formatSpeed(averageSpeed)}`.magenta);
        }
        
        console.log(`${'═'.repeat(60)}`.cyan);
    }

    // Display crawling progress
    displayCrawlProgress(stats) {
        const {
            pagesVisited,
            filesFound,
            currentDepth,
            maxDepth,
            currentUrl
        } = stats;

        console.log(`${this.emojis.search} Crawling... Pages: ${pagesVisited} | Files: ${filesFound} | Depth: ${currentDepth}/${maxDepth}`);
        if (currentUrl) {
            console.log(`${this.emojis.network} Current: ${currentUrl}`.gray);
        }
    }

    // Format bytes to human readable
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
    }

    // Format speed to human readable
    formatSpeed(bytesPerSecond) {
        return `${this.formatBytes(bytesPerSecond)}/s`;
    }

    // Show ASCII art banner
    displayBanner() {
        if (!this.enableEmojis) return;
        
        console.log(`
${'n-get'.bold.cyan}
${'━'.repeat(40).gray}
        `.trim());
    }

    // Clean up resources
    cleanup() {
        // Stop all remaining spinners
        for (const [id, spinner] of this.spinners) {
            spinner.stop();
        }
        this.spinners.clear();

        // Stop multibar
        if (this.multibar) {
            this.multibar.stop();
            // Clear the progress bar line
            process.stdout.write('\x1b[1A\x1b[2K');
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

module.exports = ui;