const path = require('path');
const fs = require('fs').promises;
const recursivePipe = require('./recursivePipe');
const RecursiveCrawler = require('./recursiveCrawler');
const ui = require('./ui');

/**
 * Recursive downloader that combines crawling and downloading functionality
 * Provides wget-like recursive downloading with fine-tuned control
 */

class RecursiveDownloader {
    constructor(options = {}) {
        this.options = {
            // Crawler options
            maxDepth: options.level || options.maxDepth || 5,
            noParent: options.noParent || false,
            acceptPatterns: options.accept || [],
            rejectPatterns: options.reject || [],
            followExternalLinks: options.followExternalLinks || false,
            
            // Download options
            enableResume: options.enableResume !== false,
            createDirectoryStructure: options.createDirectoryStructure !== false,
            maxConcurrentDownloads: options.maxConcurrentDownloads || 3,
            
            // Crawler behavior
            delayMs: options.delayMs || 1000,
            respectRobotsTxt: options.respectRobotsTxt !== false,
            userAgent: options.userAgent || 'n-get-recursive/1.0',
            
            // SSH options (passed through)
            sshOptions: options.sshOptions || {}
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
            maxConcurrent: Math.min(this.options.maxConcurrentDownloads, 3) // Limit crawling concurrency
        });
        
        this.downloadStats = {
            totalUrls: 0,
            downloadedFiles: 0,
            failedFiles: 0,
            skippedFiles: 0,
            totalBytes: 0,
            startTime: null,
            endTime: null
        };
    }

    /**
     * Validate and prepare patterns for accept/reject filtering
     */
    static parsePatterns(patterns) {
        if (!patterns) return [];
        if (typeof patterns === 'string') {
            return patterns.split(',').map(p => p.trim()).filter(p => p.length > 0);
        }
        if (Array.isArray(patterns)) {
            return patterns.filter(p => typeof p === 'string' && p.length > 0);
        }
        return [];
    }

    /**
     * Create directory structure for a file path
     */
    async ensureDirectoryExists(filePath) {
        const directory = path.dirname(filePath);
        try {
            await fs.mkdir(directory, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }

    /**
     * Download files with proper directory structure
     */
    async downloadDiscoveredFiles(discoveredFiles, baseDestination) {
        if (discoveredFiles.length === 0) {
            ui.displayInfo('No files found to download');
            return [];
        }

        ui.displayInfo(`Found ${discoveredFiles.length} files to download`);
        
        // Group files by directory to create structure efficiently
        const filesByDirectory = new Map();
        
        for (const fileItem of discoveredFiles) {
            const localPath = this.crawler.generateLocalPath(fileItem.url, baseDestination);
            const directory = path.dirname(localPath);
            
            if (!filesByDirectory.has(directory)) {
                filesByDirectory.set(directory, []);
            }
            
            filesByDirectory.get(directory).push({
                ...fileItem,
                localPath: localPath
            });
        }

        // Create all necessary directories
        ui.displayInfo(`Creating directory structure...`);
        for (const directory of filesByDirectory.keys()) {
            await this.ensureDirectoryExists(path.join(directory, 'dummy'));
        }

        // Download files in batches
        const results = [];
        const urls = discoveredFiles.map(f => f.url);
        
        // Use existing recursivePipe but download to specific paths
        try {
            // Create a mapping of URLs to their target paths
            const urlToPathMap = new Map();
            for (const fileItem of discoveredFiles) {
                const localPath = this.crawler.generateLocalPath(fileItem.url, baseDestination);
                urlToPathMap.set(fileItem.url, localPath);
            }

            // Download files using existing pipeline with custom destination handling
            const downloadResults = await this.downloadWithCustomPaths(
                urls, 
                urlToPathMap, 
                this.options.enableResume,
                this.options.sshOptions
            );

            return downloadResults;

        } catch (error) {
            ui.displayError(`Batch download failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Custom download function that respects the directory structure
     */
    async downloadWithCustomPaths(urls, urlToPathMap, enableResume, sshOptions) {
        const results = [];
        const stats = {
            totalFiles: urls.length,
            successCount: 0,
            errorCount: 0,
            resumedCount: 0,
            totalBytes: 0,
            totalTime: 0,
            speeds: []
        };

        ui.displayBanner();
        ui.displayInfo(`Starting recursive download of ${urls.length} file(s)...`);

        const overallStartTime = Date.now();

        // Process downloads in batches to respect concurrency limits
        const batchSize = this.options.maxConcurrentDownloads;
        
        for (let i = 0; i < urls.length; i += batchSize) {
            const batch = urls.slice(i, i + batchSize);
            const batchPromises = batch.map(async (url, batchIndex) => {
                const globalIndex = i + batchIndex;
                const targetPath = urlToPathMap.get(url);
                const targetDir = path.dirname(targetPath);
                const filename = path.basename(targetPath);

                try {
                    // Ensure target directory exists
                    await this.ensureDirectoryExists(targetPath);

                    const result = await this.downloadSingleFile(
                        url, 
                        targetPath,
                        globalIndex + 1, 
                        urls.length, 
                        enableResume, 
                        sshOptions
                    );

                    if (result.alreadyComplete) {
                        results.push({
                            url,
                            filePath: result.path,
                            size: result.size,
                            success: true,
                            alreadyComplete: true
                        });
                        stats.successCount++;
                    } else {
                        results.push({
                            url,
                            filePath: result.path,
                            size: result.size,
                            duration: result.duration,
                            speed: result.speed,
                            resumed: result.resumed,
                            success: true
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
                    }

                } catch (error) {
                    ui.displayError(`Failed to download ${url}: ${error.message}`);
                    results.push({ url, error: error.message, success: false });
                    stats.errorCount++;
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
            ? stats.speeds.reduce((a, b) => a + b, 0) / stats.speeds.length 
            : 0;

        // Display comprehensive summary
        ui.displaySummary({
            totalFiles: stats.totalFiles,
            successCount: stats.successCount,
            errorCount: stats.errorCount,
            resumedCount: stats.resumedCount,
            totalBytes: stats.totalBytes,
            totalTime: overallTime,
            averageSpeed: stats.averageSpeed
        });

        return results;
    }

    /**
     * Download a single file to a specific path
     */
    async downloadSingleFile(url, targetPath, index, total, enableResume, sshOptions) {
        const { downloadFile } = require('./recursivePipe');
        
        // Get the directory and filename
        const targetDir = path.dirname(targetPath);
        const originalFilename = path.basename(targetPath);
        
        // Download to the target directory
        const result = await downloadFile(url, targetDir, index, total, enableResume, sshOptions);
        
        // If the downloaded file has a different name than what we want, rename it
        if (result.path && path.basename(result.path) !== originalFilename) {
            const newPath = path.join(targetDir, originalFilename);
            try {
                await fs.rename(result.path, newPath);
                result.path = newPath;
            } catch (error) {
                // If rename fails, just use the original path
                ui.displayWarning(`Could not rename ${path.basename(result.path)} to ${originalFilename}`);
            }
        }
        
        return result;
    }

    /**
     * Main recursive download function
     */
    async recursiveDownload(initialUrls, destination) {
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
            const discoveredFiles = await this.crawler.crawl(initialUrls);
            
            const crawlStats = this.crawler.getStats();
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

        } catch (error) {
            ui.displayError(`Recursive download failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Display comprehensive final summary
     */
    displayFinalSummary(crawlStats) {
        const duration = (this.downloadStats.endTime - this.downloadStats.startTime) / 1000;
        
        console.log(`\n${'═'.repeat(70)}`.cyan);
        console.log(`${ui.emojis.success} Recursive Download Complete`.bold.green);
        console.log(`${'═'.repeat(70)}`.cyan);
        
        console.log(`${ui.emojis.search} Crawling Statistics:`.bold.yellow);
        console.log(`  • Pages visited: ${crawlStats.pagesVisited}`);
        console.log(`  • URLs discovered: ${crawlStats.discoveredUrls}`);
        console.log(`  • Max depth reached: ${this.options.maxDepth}`);
        console.log(`  • Crawl errors: ${crawlStats.errors}`);
        
        console.log(`\n${ui.emojis.downloading} Download Statistics:`.bold.blue);
        console.log(`  • Total files: ${this.downloadStats.totalUrls}`);
        console.log(`  • Successfully downloaded: ${this.downloadStats.downloadedFiles}`);
        console.log(`  • Failed downloads: ${this.downloadStats.failedFiles}`);
        console.log(`  • Total time: ${duration.toFixed(1)}s`);
        
        if (this.downloadStats.totalBytes > 0) {
            console.log(`  • Total size: ${ui.formatBytes(this.downloadStats.totalBytes)}`);
        }
        
        console.log(`${'═'.repeat(70)}`.cyan);
    }

    /**
     * Get download statistics
     */
    getDownloadStats() {
        return {
            ...this.downloadStats,
            crawlStats: this.crawler.getStats()
        };
    }
}

module.exports = RecursiveDownloader;