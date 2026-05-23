import * as path from 'node:path';

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

interface ProgressBar {
    update(value: number, payload?: Record<string, unknown>): void;
    stop(): void;
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

class UIManager {
    spinners: Map<string, MockSpinner>;
    enableEmojis: boolean;

    constructor() {
        this.spinners = new Map();
        this.enableEmojis = this.checkEmojiSupport();
    }

    checkEmojiSupport(): boolean {
        return process.env.TERM !== 'dumb'
            && process.platform !== 'win32'
            && !process.env.CI;
    }

    get emojis(): EmojiMap {
        return {
            downloading: this.enableEmojis ? '⬇️' : '>>',
            completed:   this.enableEmojis ? '✅' : '[OK]',
            error:       this.enableEmojis ? '❌' : '[ERR]',
            warning:     this.enableEmojis ? '⚠️' : '[WARN]',
            archive:     this.enableEmojis ? '📦' : '[ZIP]',
            document:    this.enableEmojis ? '📄' : '[DOC]',
            image:       this.enableEmojis ? '🖼️' : '[IMG]',
            video:       this.enableEmojis ? '🎬' : '[VID]',
            audio:       this.enableEmojis ? '🎵' : '[AUD]',
            code:        this.enableEmojis ? '💻' : '[CODE]',
            unknown:     this.enableEmojis ? '📁' : '[FILE]',
            search:      this.enableEmojis ? '🔍' : '[FIND]',
            network:     this.enableEmojis ? '🌐' : '[NET]',
            folder:      this.enableEmojis ? '📂' : '[DIR]',
            rocket:      this.enableEmojis ? '🚀' : '[GO]',
            gear:        this.enableEmojis ? '⚙️' : '[CONF]',
            info:        this.enableEmojis ? 'ℹ️' : '[INFO]',
            success:     this.enableEmojis ? '🎉' : '[SUCCESS]',
            clock:       this.enableEmojis ? '⏱️' : '[TIME]',
            size:        this.enableEmojis ? '📏' : '[SIZE]',
            speed:       this.enableEmojis ? '⚡' : '[SPEED]',
            resume:      this.enableEmojis ? '▶️' : '[RESUME]',
            pause:       this.enableEmojis ? '⏸️' : '[PAUSE]',
            restart:     this.enableEmojis ? '🔄' : '[RESTART]',
            partial:     this.enableEmojis ? '📋' : '[PARTIAL]',
        };
    }

    getFileTypeEmoji(filename: string): string {
        const extension = filename.toLowerCase().split('.').pop() || '';
        const typeMap: Record<string, string> = {
            zip: this.emojis.archive, tar: this.emojis.archive, gz: this.emojis.archive,
            rar: this.emojis.archive, '7z': this.emojis.archive,
            pdf: this.emojis.document, doc: this.emojis.document, docx: this.emojis.document,
            txt: this.emojis.document, md: this.emojis.document,
            jpg: this.emojis.image, jpeg: this.emojis.image, png: this.emojis.image,
            gif: this.emojis.image, svg: this.emojis.image,
            mp4: this.emojis.video, avi: this.emojis.video, mkv: this.emojis.video, mov: this.emojis.video,
            mp3: this.emojis.audio, wav: this.emojis.audio, flac: this.emojis.audio,
            js: this.emojis.code, py: this.emojis.code, java: this.emojis.code,
            cpp: this.emojis.code, html: this.emojis.code,
        };
        return typeMap[extension] || this.emojis.unknown;
    }

    createProgressBar(_label: string, _total: number): ProgressBar {
        return { update() {}, stop() {} };
    }

    createSpinner(text: string, emoji: string = this.emojis.gear): SpinnerHandle {
        const mockSpinner: MockSpinner = {
            start:   () => console.log(`${emoji} ${text}...`),
            succeed: (message?: string) => console.log(`${this.emojis.completed} ${message || text}`),
            fail:    (message?: string) => console.log(`${this.emojis.error} ${message || text}`),
            stop:    () => {},
        };
        const id = Date.now().toString();
        this.spinners.set(id, mockSpinner);
        return { id, spinner: mockSpinner };
    }

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

    displayDownloadStart(filename: string, fileSize: number, index: number, total: number, isResume: boolean = false, resumeFrom: number = 0): void {
        const emoji = this.getFileTypeEmoji(filename);
        const sizeText = fileSize ? ` (${this.formatBytes(fileSize)})` : '';
        const resumeText = isResume ? ` ${this.emojis.resume} Resuming from ${this.formatBytes(resumeFrom)}` : '';
        console.log(`\n${this.emojis.downloading} [${index}/${total}] ${emoji} ${filename}${sizeText}${resumeText}`);
    }

    displayDownloadComplete(filename: string, fileSize: number, duration: number, speed: number): void {
        const emoji = this.getFileTypeEmoji(filename);
        const sizeText = fileSize ? ` ${this.emojis.size} ${this.formatBytes(fileSize)}` : '';
        const speedText = speed ? ` ${this.emojis.speed} ${this.formatSpeed(speed)}` : '';
        const timeText = ` ${this.emojis.clock} ${duration.toFixed(1)}s`;
        console.log(`${this.emojis.completed} ${emoji} ${filename}${sizeText}${speedText}${timeText}`);
    }

    displayError(message: string, context: string = ''): void {
        const contextText = context ? ` (${context})` : '';
        console.log(`${this.emojis.error} ${message}${contextText}`);
    }

    displayWarning(message: string): void {
        console.log(`${this.emojis.warning} ${message}`);
    }

    displayInfo(message: string): void {
        console.log(`${this.emojis.info} ${message}`);
    }

    displayResumeInfo(filename: string, resumeFrom: number, totalSize: number): void {
        const percentage = totalSize ? ((resumeFrom / totalSize) * 100).toFixed(1) : '??';
        console.log(`${this.emojis.resume} Resuming ${filename} from ${this.formatBytes(resumeFrom)} (${percentage}%)`);
    }

    displayResumableList(resumableDownloads: ResumableDownloadItem[]): void {
        if (resumableDownloads.length === 0) {
            console.log(`${this.emojis.info} No resumable downloads found`);
            return;
        }
        console.log(`\n${this.emojis.partial} Found ${resumableDownloads.length} resumable download(s):`);
        console.log('━'.repeat(60));
        resumableDownloads.forEach((download, index) => {
            const filename = path.basename(download.filePath);
            const progress = download.totalSize
                ? ((download.currentSize / download.totalSize) * 100).toFixed(1)
                : '??';
            const sizeText = `${this.formatBytes(download.currentSize)}/${this.formatBytes(download.totalSize)}`;
            console.log(`${index + 1}. ${this.getFileTypeEmoji(filename)} ${filename}`);
            console.log(`   ${this.emojis.size} ${sizeText} (${progress}% complete)`);
            console.log(`   ${this.emojis.network} ${download.url}`);
        });
        console.log('━'.repeat(60));
    }

    displaySuccess(message: string): void {
        console.log(`${this.emojis.success} ${message}`);
    }

    displaySummary(stats: DisplaySummaryStats): void {
        const { totalFiles, successCount, errorCount, resumedCount, totalBytes, totalTime, averageSpeed, filePaths } = stats;
        console.log(`\n${'═'.repeat(60)}`);
        if (successCount === 0 && errorCount > 0) {
            console.log(`${this.emojis.error} Download Summary`);
        } else {
            console.log(`${this.emojis.success} Download Summary`);
        }
        console.log(`${'═'.repeat(60)}`);
        console.log(`${this.emojis.completed} Successful: ${successCount}/${totalFiles}`);
        if (resumedCount > 0) console.log(`${this.emojis.resume} Resumed: ${resumedCount}/${totalFiles}`);
        if (errorCount > 0)   console.log(`${this.emojis.error} Failed: ${errorCount}/${totalFiles}`);
        if (totalBytes > 0)   console.log(`${this.emojis.size} Total size: ${this.formatBytes(totalBytes)}`);
        if (totalTime > 0)    console.log(`${this.emojis.clock} Total time: ${(totalTime / 1000).toFixed(1)}s`);
        if (filePaths && filePaths.length > 0) {
            console.log(`${this.emojis.folder} Downloaded files:`);
            filePaths.forEach((filePath, index) => {
                const displayPath = path.relative(process.cwd(), filePath) || path.basename(filePath);
                console.log(`  ${index + 1}. ${displayPath}`);
            });
        }
        if (averageSpeed > 0) console.log(`${this.emojis.speed} Average speed: ${this.formatSpeed(averageSpeed)}`);
        console.log(`${'═'.repeat(60)}`);
    }

    displayCrawlProgress(stats: CrawlProgressStats): void {
        const { pagesVisited, filesFound, currentDepth, maxDepth, currentUrl } = stats;
        console.log(`${this.emojis.search} Crawling... Pages: ${pagesVisited} | Files: ${filesFound} | Depth: ${currentDepth}/${maxDepth}`);
        if (currentUrl) console.log(`${this.emojis.network} Current: ${currentUrl}`);
    }

    formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
    }

    formatSpeed(bytesPerSecond: number): string {
        return `${this.formatBytes(bytesPerSecond)}/s`;
    }

    displayBanner(): void {
        if (!this.enableEmojis) return;
        console.log(`\nn-get\n${'━'.repeat(40)}`);
    }

    cleanup(): void {
        for (const [_id, spinner] of this.spinners) spinner.stop();
        this.spinners.clear();
    }
}

const ui = new UIManager();

process.on('SIGINT',  () => { ui.cleanup(); process.exit(0); });
process.on('SIGTERM', () => { ui.cleanup(); process.exit(0); });

export = ui;
