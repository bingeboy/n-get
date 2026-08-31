/**
 * @fileoverview Recursive downloader combining crawling and downloading functionality
 * Recursive site download with fine-tuned depth, host, and path filtering
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

import HistoryManager = require('./services/HistoryManager');

// These modules are .js — typed loosely
const RecursiveCrawler = require('./recursiveCrawler');
const ui: any = require('./ui');

interface RecursiveDownloaderOptions {
    level?: number;
    maxDepth?: number;
    noParent?: boolean;
    accept?: any;
    reject?: any;
    followExternalLinks?: boolean;
    enableResume?: boolean;
    createDirectoryStructure?: boolean;
    maxConcurrentDownloads?: number;
    delayMs?: number;
    respectRobotsTxt?: boolean;
    userAgent?: string;
    sshOptions?: Record<string, any>;
    /** Threaded to the crawler's SecurityService and to per-file downloads */
    configManager?: any;
    /** Injected security policy for the crawler (built from configManager otherwise) */
    securityService?: any;
    /** Caller-supplied agent identity for the download session */
    agentId?: string | null;
    /** Rest of the caller-supplied identity, persisted on every history entry */
    sessionId?: string | null;
    requestId?: string | null;
    conversationId?: string | null;
}

/**
 * Per-batch context for downloadWithCustomPaths. Optional so the method keeps
 * working for direct callers that only want files on disk.
 */
interface DownloadBatchContext {
    /** Directory whose .nget/ collects the batch (the -d destination) */
    historyRoot?: string;
    /** url -> crawl provenance, recorded in each history entry's metadata */
    discovered?: Map<string, { depth?: number; parent?: string | null }>;
}

interface DownloadStats {
    totalUrls: number;
    downloadedFiles: number;
    failedFiles: number;
    skippedFiles: number;
    totalBytes: number;
    startTime: number | null;
    endTime: number | null;
}

interface DownloadResult {
    url: string;
    filePath?: string;
    size?: number;
    duration?: number;
    speed?: number;
    resumed?: boolean;
    alreadyComplete?: boolean;
    success: boolean;
    error?: string;
}

interface BatchStats {
    totalFiles: number;
    successCount: number;
    errorCount: number;
    resumedCount: number;
    totalBytes: number;
    totalTime: number;
    speeds: number[];
    averageSpeed?: number;
}

/**
 * Recursive downloader that combines crawling and downloading functionality
 */
class RecursiveDownloader {
    options: {
        maxDepth: number;
        noParent: boolean;
        acceptPatterns: any[];
        rejectPatterns: any[];
        followExternalLinks: boolean;
        enableResume: boolean;
        createDirectoryStructure: boolean;
        maxConcurrentDownloads: number;
        delayMs: number;
        respectRobotsTxt: boolean;
        userAgent: string;
        sshOptions: Record<string, any>;
        configManager: any;
        agentId: string | null;
        sessionId: string | null;
        requestId: string | null;
        conversationId: string | null;
    };
    crawler: any;
    downloadStats: DownloadStats;

    constructor(options: RecursiveDownloaderOptions = {}) {
        this.options = {
            // Crawler options. ?? not || so an explicit 0 is honoured.
            maxDepth: options.level ?? options.maxDepth ?? 5,
            noParent: options.noParent || false,
            // Normalise here so CSV strings from the CLI (-A "*.pdf,*.zip")
            // become pattern arrays instead of being iterated character by
            // character inside the crawler.
            acceptPatterns: RecursiveDownloader.parsePatterns(options.accept),
            rejectPatterns: RecursiveDownloader.parsePatterns(options.reject),
            followExternalLinks: options.followExternalLinks || false,

            // Download options
            enableResume: options.enableResume !== false,
            createDirectoryStructure: options.createDirectoryStructure !== false,
            maxConcurrentDownloads: options.maxConcurrentDownloads || 3,

            // Crawler behavior
            delayMs: options.delayMs ?? 1000,
            respectRobotsTxt: options.respectRobotsTxt !== false,
            userAgent: options.userAgent || 'n-get-recursive/1.0',

            // SSH options (passed through)
            sshOptions: options.sshOptions || {},

            configManager: options.configManager ?? null,
            agentId: options.agentId ?? null,
            sessionId: options.sessionId ?? null,
            requestId: options.requestId ?? null,
            conversationId: options.conversationId ?? null,
        };

        this.crawler = new RecursiveCrawler({
            maxDepth: this.options.maxDepth,
            noParent: this.options.noParent,
            acceptPatterns: this.options.acceptPatterns,
            rejectPatterns: this.options.rejectPatterns,
            followExternalLinks: this.options.followExternalLinks,
            createDirectoryStructure: this.options.createDirectoryStructure,
            delayMs: this.options.delayMs,
            respectRobotsTxt: this.options.respectRobotsTxt,
            userAgent: this.options.userAgent,
            maxConcurrent: Math.min(this.options.maxConcurrentDownloads, 3), // Limit crawling concurrency
            configManager: this.options.configManager,
            securityService: options.securityService,
        });

        this.downloadStats = {
            totalUrls: 0,
            downloadedFiles: 0,
            failedFiles: 0,
            skippedFiles: 0,
            totalBytes: 0,
            startTime: null,
            endTime: null,
        };
    }

    /**
     * Validate and prepare patterns for accept/reject filtering
     */
    static parsePatterns(patterns: any): string[] {
        if (!patterns) {
            return [];
        }

        if (typeof patterns === 'string') {
            return patterns.split(',').map((p: string) => p.trim()).filter((p: string) => p.length > 0);
        }

        if (Array.isArray(patterns)) {
            return patterns.filter((p: any) => typeof p === 'string' && p.length > 0);
        }

        return [];
    }

    /**
     * Create directory structure for a file path
     */
    async ensureDirectoryExists(filePath: string): Promise<void> {
        const directory = path.dirname(filePath);
        try {
            await fs.promises.mkdir(directory, {recursive: true});
        } catch (error: any) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }

    /**
     * Download files with proper directory structure
     */
    async downloadDiscoveredFiles(discoveredFiles: any[], baseDestination: string): Promise<DownloadResult[]> {
        if (discoveredFiles.length === 0) {
            ui.displayInfo('No files found to download');
            return [];
        }

        ui.displayInfo(`Found ${discoveredFiles.length} files to download`);

        // Group files by directory to create structure efficiently
        const filesByDirectory = new Map<string, any[]>();

        for (const fileItem of discoveredFiles) {
            const localPath = this.crawler.generateLocalPath(fileItem.url, baseDestination);
            const directory = path.dirname(localPath);

            if (!filesByDirectory.has(directory)) {
                filesByDirectory.set(directory, []);
            }

            filesByDirectory.get(directory)!.push({
                ...fileItem,
                localPath,
            });
        }

        // Create all necessary directories
        ui.displayInfo('Creating directory structure...');
        for (const directory of filesByDirectory.keys()) {
            await this.ensureDirectoryExists(path.join(directory, 'dummy'));
        }

        // Download files in batches
        const _results: DownloadResult[] = []; // TODO: Implement batch result tracking
        const urls = discoveredFiles.map((f: any) => f.url);

        // Use existing download pipeline but download to specific paths
        try {
            // Create a mapping of URLs to their target paths
            const urlToPathMap = new Map<string, string>();
            for (const fileItem of discoveredFiles) {
                const localPath = this.crawler.generateLocalPath(fileItem.url, baseDestination);
                urlToPathMap.set(fileItem.url, localPath);
            }

            // Crawl provenance, keyed by URL, so each history entry can record
            // the depth it was found at and the page that linked to it.
            const discovered = new Map<string, { depth?: number; parent?: string | null }>();
            for (const fileItem of discoveredFiles) {
                discovered.set(fileItem.url, {depth: fileItem.depth, parent: fileItem.parent ?? null});
            }

            // Download files using existing pipeline with custom destination handling
            const downloadResults = await this.downloadWithCustomPaths(
                urls,
                urlToPathMap,
                this.options.enableResume,
                this.options.sshOptions,
                {historyRoot: baseDestination, discovered},
            );

            return downloadResults;
        } catch (error: any) {
            ui.displayError(`Batch download failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Custom download function that respects the directory structure
     */
    async downloadWithCustomPaths(urls: string[], urlToPathMap: Map<string, string>, enableResume: boolean, sshOptions: any, context: DownloadBatchContext = {}): Promise<DownloadResult[]> {
        const results: DownloadResult[] = [];
        const stats: BatchStats = {
            totalFiles: urls.length,
            successCount: 0,
            errorCount: 0,
            resumedCount: 0,
            totalBytes: 0,
            totalTime: 0,
            speeds: [],
        };

        ui.displayBanner();
        ui.displayInfo(`Starting recursive download of ${urls.length} file(s)...`);

        // One shared session for the whole recursive batch. Without this,
        // each bare downloadFile() call creates its own session and never
        // ends it — leaving phantom "active" sessions behind for jobs/MCP
        // observers. The shared session also applies the operator's security
        // config to every file and gives the run a single NDJSON stream.
        const {DownloadSession} = require('./core/DownloadSession');
        const session = new DownloadSession({
            quietMode: false,
            configManager: this.options.configManager,
            sessionId: this.options.sessionId ?? undefined,
            agentId: this.options.agentId,
        }).start();

        // Durable history for recursive runs. Flat downloads have always been
        // recorded; recursive ones were not, so anything fetched by a crawl was
        // invisible to `nget history` and to the MCP get_history tool once the
        // process exited — the live NDJSON stream was the only record.
        //
        // Entries are written to the batch's historyRoot rather than beside each
        // file: a crawl scatters files across a recreated directory tree, and
        // the history reader looks in exactly one directory.
        const historyManager = new HistoryManager();
        const batchCorrelationId = `recursive-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

        // sessionId comes from the session itself so history matches the live
        // NDJSON stream even when the caller supplied no id.
        const identity = {
            agentId:        this.options.agentId,
            sessionId:      session.id,
            requestId:      this.options.requestId,
            conversationId: this.options.conversationId,
        };

        // Crawl provenance for a URL, as recorded in history metadata.
        const provenanceOf = (url: string) => {
            const item = context.discovered?.get(url);
            return {
                recursive: true,
                depth:     item?.depth ?? null,
                sourceUrl: item?.parent ?? null,
            };
        };

        const overallStartTime = Date.now();

        // Process downloads in batches to respect concurrency limits
        const batchSize = this.options.maxConcurrentDownloads;

        for (let i = 0; i < urls.length; i += batchSize) {
            const batch = urls.slice(i, i + batchSize);
            const batchPromises = batch.map(async (url: string, batchIndex: number) => {
                const globalIndex = i + batchIndex;
                const targetPath = urlToPathMap.get(url)!;
                const _targetDir = path.dirname(targetPath);
                const _filename = path.basename(targetPath);

                try {
                    // Ensure target directory exists
                    await this.ensureDirectoryExists(targetPath);

                    const result: any = await this.downloadSingleFile(
                        url,
                        targetPath,
                        globalIndex + 1,
                        urls.length,
                        enableResume,
                        sshOptions,
                        session,
                    );

                    if (result.alreadyComplete) {
                        results.push({
                            url,
                            filePath: result.path,
                            size: result.size,
                            success: true,
                            alreadyComplete: true,
                        });
                        stats.successCount++;

                        await historyManager.logDownload({
                            url,
                            filePath:      result.path,
                            historyRoot:   context.historyRoot,
                            status:        'success',
                            size:          result.size,
                            duration:      0,
                            correlationId: batchCorrelationId,
                            ...identity,
                            metadata: {...provenanceOf(url), alreadyComplete: true},
                        });
                    } else {
                        results.push({
                            url,
                            filePath: result.path,
                            size: result.size,
                            duration: result.duration,
                            speed: result.speed,
                            resumed: result.resumed,
                            success: true,
                        });

                        stats.successCount++;
                        if (result.resumed) {
                            stats.resumedCount++;
                        }

                        stats.totalBytes += result.size;
                        stats.totalTime += result.duration;
                        if (result.speed > 0) {
                            stats.speeds.push(result.speed);
                        }

                        await historyManager.logDownload({
                            url,
                            filePath:      result.path,
                            historyRoot:   context.historyRoot,
                            status:        'success',
                            size:          result.size,
                            duration:      result.duration,
                            correlationId: batchCorrelationId,
                            ...identity,
                            metadata: {
                                ...provenanceOf(url),
                                resumed:    result.resumed,
                                resumeFrom: result.resumeFrom,
                                speed:      result.speed,
                            },
                        });
                    }
                } catch (error: any) {
                    ui.displayError(`Failed to download ${url}: ${error.message}`);
                    results.push({url, error: error.message, success: false});
                    stats.errorCount++;

                    // targetPath is where the file would have gone — recorded so a
                    // failed entry still says what was attempted and where.
                    await historyManager.logDownload({
                        url,
                        filePath:      targetPath,
                        historyRoot:   context.historyRoot,
                        status:        'failed',
                        error:         error.message,
                        correlationId: batchCorrelationId,
                        ...identity,
                        metadata: {...provenanceOf(url), index: globalIndex + 1, total: urls.length},
                    });
                }
            });

            await Promise.all(batchPromises);

            // Small delay between batches
            if (i + batchSize < urls.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Calculate final statistics
        const overallTime = Date.now() - overallStartTime;
        stats.averageSpeed = stats.speeds.length > 0
            ? stats.speeds.reduce((a: number, b: number) => a + b, 0) / stats.speeds.length
            : 0;

        // Extract file paths from successful downloads
        const filePaths = results
            .filter(result => result.success && result.filePath)
            .map(result => result.filePath as string);

        await session.end({
            stats: {
                total: stats.totalFiles,
                success: stats.successCount,
                errors: stats.errorCount,
                resumed: stats.resumedCount,
                bytes: stats.totalBytes,
                duration: overallTime,
                avg_speed: stats.averageSpeed,
                file_paths: filePaths,
            },
        });

        // Display comprehensive summary
        ui.displaySummary({
            totalFiles: stats.totalFiles,
            successCount: stats.successCount,
            errorCount: stats.errorCount,
            resumedCount: stats.resumedCount,
            totalBytes: stats.totalBytes,
            totalTime: overallTime,
            averageSpeed: stats.averageSpeed,
            filePaths,
        });

        return results;
    }

    /**
     * Download a single file to a specific path
     */
    async downloadSingleFile(url: string, targetPath: string, index: number, total: number, enableResume: boolean, sshOptions: any, session: any = null): Promise<any> {
        // downloadFile is attached as a property of the batch download() export
        const {downloadFile} = require('./downloader');
        if (typeof downloadFile !== 'function') {
            throw new TypeError('lib/downloader does not expose downloadFile — recursive downloads cannot proceed');
        }

        // Get the directory and filename
        const targetDir = path.dirname(targetPath);
        const originalFilename = path.basename(targetPath);

        // SSH credentials stay top-level (sftpManager reads options.keyPath
        // etc. directly); configManager rides along for session/security config.
        const downloadOptions: any = {
            ...sshOptions,
            configManager: this.options.configManager,
        };
        if (session) {
            downloadOptions._session = session;
        }

        // Download to the target directory
        const result: any = await downloadFile(url, targetDir, index, total, enableResume, downloadOptions);

        // If the downloaded file has a different name than what we want, rename it
        if (result.path && path.basename(result.path) !== originalFilename) {
            const newPath = path.join(targetDir, originalFilename);
            try {
                await fs.promises.rename(result.path, newPath);
                result.path = newPath;
            } catch {
                // If rename fails, just use the original path
                ui.displayWarning(`Could not rename ${path.basename(result.path)} to ${originalFilename}`);
            }
        }

        return result;
    }

    /**
     * Main recursive download function
     */
    async recursiveDownload(initialUrls: string[], destination: string): Promise<DownloadResult[]> {
        if (!Array.isArray(initialUrls) || initialUrls.length === 0) {
            throw new Error('No URLs provided for recursive download');
        }

        this.downloadStats.startTime = Date.now();

        try {
            ui.displayBanner();
            ui.displayInfo(`Starting recursive crawling from ${initialUrls.length} URL(s)...`);
            ui.displayInfo(`Max depth: ${this.options.maxDepth}, Destination: ${destination}`);

            if (this.options.acceptPatterns.length > 0) {
                ui.displayInfo(`Accept patterns: ${this.options.acceptPatterns.join(', ')}`);
            }

            if (this.options.rejectPatterns.length > 0) {
                ui.displayInfo(`Reject patterns: ${this.options.rejectPatterns.join(', ')}`);
            }

            // Phase 1: Crawl and discover files
            ui.displayInfo('Phase 1: Discovering files...');
            const discoveredFiles: any[] = await this.crawler.crawl(initialUrls);

            const crawlStats: any = this.crawler.getStats();
            ui.displayInfo(`Crawling complete: ${crawlStats.pagesVisited} pages visited, ${discoveredFiles.length} files discovered`);

            if (discoveredFiles.length === 0) {
                ui.displayWarning('No downloadable files found');
                return [];
            }

            // Phase 2: Download discovered files
            ui.displayInfo('Phase 2: Downloading files...');
            const downloadResults = await this.downloadDiscoveredFiles(discoveredFiles, destination);

            this.downloadStats.endTime = Date.now();
            this.downloadStats.totalUrls = discoveredFiles.length;
            this.downloadStats.downloadedFiles = downloadResults.filter(r => r.success).length;
            this.downloadStats.failedFiles = downloadResults.filter(r => !r.success).length;

            // Display final summary
            this.displayFinalSummary(crawlStats);

            return downloadResults;
        } catch (error: any) {
            ui.displayError(`Recursive download failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Display comprehensive final summary
     */
    displayFinalSummary(crawlStats: any): void {
        const duration = ((this.downloadStats.endTime! - this.downloadStats.startTime!) / 1000);

        console.log((`\n${'═'.repeat(70)}` as any).cyan);
        console.log((`${ui.emojis.success} Recursive Download Complete` as any).bold.green);
        console.log((`${'═'.repeat(70)}` as any).cyan);

        console.log((`${ui.emojis.search} Crawling Statistics:` as any).bold.yellow);
        console.log(`  • Pages visited: ${crawlStats.pagesVisited}`);
        console.log(`  • URLs discovered: ${crawlStats.discoveredUrls}`);
        console.log(`  • Max depth reached: ${this.options.maxDepth}`);
        console.log(`  • Crawl errors: ${crawlStats.errors}`);
        console.log(`  • Blocked by security policy: ${crawlStats.blocked ?? 0}`);

        console.log((`\n${ui.emojis.downloading} Download Statistics:` as any).bold.blue);
        console.log(`  • Total files: ${this.downloadStats.totalUrls}`);
        console.log(`  • Successfully downloaded: ${this.downloadStats.downloadedFiles}`);
        console.log(`  • Failed downloads: ${this.downloadStats.failedFiles}`);
        console.log(`  • Total time: ${duration.toFixed(1)}s`);

        if (this.downloadStats.totalBytes > 0) {
            console.log(`  • Total size: ${ui.formatBytes(this.downloadStats.totalBytes)}`);
        }

        console.log((`${'═'.repeat(70)}` as any).cyan);
    }

    /**
     * Get download statistics
     */
    getDownloadStats(): any {
        return {
            ...this.downloadStats,
            crawlStats: this.crawler.getStats(),
        };
    }
}

export = RecursiveDownloader;
