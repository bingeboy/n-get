const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const {URL} = require('url');
const path = require('path');
// const fs = require('fs').promises; // TODO: Add back when file operations are implemented
const ui = require('./ui');

/**
 * Recursive web crawler for downloading entire websites and directory structures
 * Supports depth control, file filtering, and directory structure recreation
 */

class RecursiveCrawler {
    constructor(options = {}) {
        this.options = {
            maxDepth: options.maxDepth || 5,
            noParent: options.noParent || false,
            acceptPatterns: options.acceptPatterns || [],
            rejectPatterns: options.rejectPatterns || [],
            delayMs: options.delayMs || 1000,
            userAgent: options.userAgent || 'n-get-crawler/1.0',
            followExternalLinks: options.followExternalLinks || false,
            createDirectoryStructure: options.createDirectoryStructure !== false,
            maxConcurrent: options.maxConcurrent || 3,
            respectRobotsTxt: options.respectRobotsTxt !== false,
        };

        this.visited = new Set();
        this.discovered = new Map(); // URL -> {depth, parent, type}
        this.downloadQueue = [];
        this.robotsCache = new Map();
        this.stats = {
            pagesVisited: 0,
            filesDiscovered: 0,
            filesDownloaded: 0,
            totalSize: 0,
            errors: 0,
        };
    }

    /**
     * Check if URL matches accept/reject patterns
     */
    shouldDownloadFile(url) {
        const urlString = url.toString();
        const filename = path.basename(new URL(urlString).pathname);

        // Check reject patterns first
        if (this.options.rejectPatterns.length > 0) {
            for (const pattern of this.options.rejectPatterns) {
                const regex = this.globToRegex(pattern);
                if (regex.test(filename) || regex.test(urlString)) {
                    return false;
                }
            }
        }

        // Check accept patterns (if specified, must match)
        if (this.options.acceptPatterns.length > 0) {
            for (const pattern of this.options.acceptPatterns) {
                const regex = this.globToRegex(pattern);
                if (regex.test(filename) || regex.test(urlString)) {
                    return true;
                }
            }

            return false; // No accept pattern matched
        }

        return true; // No patterns specified or only reject patterns (and none matched)
    }

    /**
     * Convert glob pattern to regex
     */
    globToRegex(pattern) {
        // Escape special regex characters except * and ?
        const escaped = pattern
            .replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
            .replaceAll('*', '.*')
            .replaceAll('?', '.');
        return new RegExp(`^${escaped}$`, 'i');
    }

    /**
     * Check if URL should be crawled based on parent restrictions
     */
    shouldCrawlUrl(url, baseUrl, currentDepth) {
        if (currentDepth >= this.options.maxDepth) {
            return false;
        }

        if (this.visited.has(url.toString())) {
            return false;
        }

        // Check no-parent restriction
        if (this.options.noParent && baseUrl) {
            const _baseUrlObject = new URL(baseUrl);
            const basePath = baseUrlObject.pathname.replace(/\/[^/]*$/, '/'); // Remove filename, keep directory

            if (!url.pathname.startsWith(basePath)) {
                return false;
            }
        }

        // Check external links
        if (!this.options.followExternalLinks && baseUrl) {
            const _baseUrlObject = new URL(baseUrl);
            if (url.hostname !== baseUrlObject.hostname) {
                return false;
            }
        }

        return true;
    }

    /**
     * Fetch and parse robots.txt
     */
    async checkRobotsTxt(baseUrl) {
        if (!this.options.respectRobotsTxt) {
            return true;
        }

        const robotsUrl = new URL('/robots.txt', baseUrl).toString();

        if (this.robotsCache.has(robotsUrl)) {
            return this.robotsCache.get(robotsUrl);
        }

        try {
            const response = await fetch(robotsUrl, {
                headers: {'User-Agent': this.options.userAgent},
                timeout: 10000,
            });

            if (!response.ok) {
                this.robotsCache.set(robotsUrl, true); // No robots.txt = allowed
                return true;
            }

            const robotsText = await response.text();
            const allowed = this.parseRobotsTxt(robotsText, baseUrl);
            this.robotsCache.set(robotsUrl, allowed);
            return allowed;
        } catch {
            this.robotsCache.set(robotsUrl, true); // Error fetching = allow
            return true;
        }
    }

    /**
     * Parse robots.txt content
     */
    parseRobotsTxt(robotsText, url) {
        const lines = robotsText.split('\n');
        const userAgent = this.options.userAgent.toLowerCase();
        let _currentUserAgent = '';
        const disallowed = [];
        let inRelevantSection = false;

        for (const line of lines) {
            const trimmed = line.trim().toLowerCase();

            if (trimmed.startsWith('user-agent:')) {
                const agent = trimmed.slice(11).trim();
                inRelevantSection = agent === '*' || agent === userAgent || userAgent.includes(agent);
                _currentUserAgent = agent;
            } else if (inRelevantSection && trimmed.startsWith('disallow:')) {
                const path = trimmed.slice(9).trim();
                if (path) {
                    disallowed.push(path);
                }
            }
        }

        // Check if current URL is disallowed
        const urlPath = new URL(url).pathname;
        return !disallowed.some(path => urlPath.startsWith(path));
    }

    /**
     * Extract URLs from HTML content
     */
    extractUrlsFromHtml(html, baseUrl) {
        const urls = new Set();
        const _baseUrlObject = new URL(baseUrl);

        // Regex patterns for different link types
        const patterns = [
            // Href attributes (a, link tags)
            /(?:href\s*=\s*["']([^"']+)["'])/gi,
            // Src attributes (img, script, iframe, etc.)
            /(?:src\s*=\s*["']([^"']+)["'])/gi,
            // CSS @import and url() functions
            /@import\s+(?:url\()?["']?([^"')\s]+)["']?\)?/gi,
            /url\(["']?([^"')\s]+)["']?\)/gi,
            // Srcset attributes (responsive images)
            /(?:srcset\s*=\s*["']([^"']+)["'])/gi,
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                const urlString = match[1].trim();

                // Skip data URLs, mailto, tel, etc.
                if (urlString.startsWith('data:')
                	|| urlString.startsWith('mailto:')
                	|| urlString.startsWith('tel:')
                	|| urlString.startsWith('javascript:')
                	|| urlString.startsWith('#')) {
                    continue;
                }

                try {
                    const absoluteUrl = new URL(urlString, baseUrl);

                    // Only collect HTTP/HTTPS URLs
                    if (absoluteUrl.protocol === 'http:' || absoluteUrl.protocol === 'https:') {
                        urls.add(absoluteUrl.toString());
                    }
                } catch {
                    // Invalid URL, skip
                    continue;
                }
            }
        }

        // Handle srcset which can contain multiple URLs with descriptors
        const srcsetPattern = /srcset\s*=\s*["']([^"']+)["']/gi;
        let srcsetMatch;
        while ((srcsetMatch = srcsetPattern.exec(html)) !== null) {
            const srcsetValue = srcsetMatch[1];
            const srcsetUrls = srcsetValue.split(',').map(item => item.trim().split(/\s+/)[0]);

            for (const srcUrl of srcsetUrls) {
                try {
                    const absoluteUrl = new URL(srcUrl, baseUrl);
                    if (absoluteUrl.protocol === 'http:' || absoluteUrl.protocol === 'https:') {
                        urls.add(absoluteUrl.toString());
                    }
                } catch {
                    continue;
                }
            }
        }

        return [...urls];
    }

    /**
     * Determine if URL points to a downloadable file or crawlable page
     */
    classifyUrl(url) {
        const urlObject = new URL(url);
        const pathname = urlObject.pathname.toLowerCase();
        const extension = path.extname(pathname).slice(1);

        // Common web page extensions that should be crawled
        const crawlableExtensions = ['html', 'htm', 'xhtml', 'php', 'asp', 'jsp', 'cfm', ''];

        // Common downloadable file extensions
        const downloadableExtensions = [
            // Documents
            'pdf',
            'doc',
            'docx',
            'xls',
            'xlsx',
            'ppt',
            'pptx',
            'txt',
            'rtf',
            'odt',
            // Images
            'jpg',
            'jpeg',
            'png',
            'gif',
            'svg',
            'bmp',
            'tiff',
            'webp',
            'ico',
            // Videos
            'mp4',
            'avi',
            'mkv',
            'mov',
            'wmv',
            'flv',
            'webm',
            'm4v',
            // Audio
            'mp3',
            'wav',
            'flac',
            'aac',
            'ogg',
            'm4a',
            'wma',
            // Archives
            'zip',
            'rar',
            '7z',
            'tar',
            'gz',
            'bz2',
            'xz',
            // Software
            'exe',
            'msi',
            'dmg',
            'pkg',
            'deb',
            'rpm',
            'appimage',
            // Code/Data
            'js',
            'css',
            'json',
            'xml',
            'csv',
            'sql',
        ];

        if (crawlableExtensions.includes(extension)) {
            return 'crawlable';
        }

        if (downloadableExtensions.includes(extension)) {
            return 'downloadable';
        }

        if (pathname.endsWith('/') || !extension) {
            // Directory or no extension - likely crawlable
            return 'crawlable';
        }

        // Unknown extension - treat as downloadable to be safe
        return 'downloadable';
    }

    /**
     * Crawl a single URL and discover linked resources
     */
    async crawlUrl(url, depth = 0, parentUrl = null) {
        if (this.visited.has(url)) {
            return [];
        }

        this.visited.add(url);
        const _urlObject = new URL(url);

        ui.displayCrawlProgress({
            pagesVisited: this.stats.pagesVisited + 1,
            filesFound: this.stats.filesDiscovered,
            currentDepth: depth,
            maxDepth: this.options.maxDepth,
            currentUrl: url,
        });

        try {
            // Check robots.txt
            const robotsAllowed = await this.checkRobotsTxt(url);
            if (!robotsAllowed) {
                ui.displayWarning(`Robots.txt disallows crawling: ${url}`);
                return [];
            }

            // Fetch the page
            const response = await fetch(url, {
                headers: {
                    'User-Agent': this.options.userAgent,
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
                timeout: 30000,
            });

            if (!response.ok) {
                ui.displayWarning(`HTTP ${response.status} for: ${url}`);
                this.stats.errors++;
                return [];
            }

            const contentType = response.headers.get('content-type') || '';

            // Only parse HTML-like content for links
            if (!contentType.includes('text/html')
            	&& !contentType.includes('application/xhtml')
            	&& !contentType.includes('text/xml')) {
                // This is a file to download, not crawl
                return [{
                    url,
                    type: 'downloadable',
                    depth,
                    parent: parentUrl,
                }];
            }

            const html = await response.text();
            this.stats.pagesVisited++;

            // Extract URLs from the HTML
            const discoveredUrls = this.extractUrlsFromHtml(html, url);
            const results = [];

            for (const discoveredUrl of discoveredUrls) {
                const discoveredUrlObject = new URL(discoveredUrl);
                const urlType = this.classifyUrl(discoveredUrl);

                // Add to discovered set
                if (!this.discovered.has(discoveredUrl)) {
                    this.discovered.set(discoveredUrl, {
                        depth: depth + 1,
                        parent: url,
                        type: urlType,
                    });

                    if (urlType === 'downloadable') {
                        this.stats.filesDiscovered++;

                        // Check if this file should be downloaded
                        if (this.shouldDownloadFile(discoveredUrlObject)) {
                            results.push({
                                url: discoveredUrl,
                                type: 'downloadable',
                                depth: depth + 1,
                                parent: url,
                            });
                        }
                    } else if (urlType === 'crawlable' // Check if we should crawl this URL
                    	&& this.shouldCrawlUrl(discoveredUrlObject, url, depth + 1)) {
                        results.push({
                            url: discoveredUrl,
                            type: 'crawlable',
                            depth: depth + 1,
                            parent: url,
                        });
                    }
                }
            }

            // Add small delay to be polite to servers
            if (this.options.delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, this.options.delayMs));
            }

            return results;
        } catch (error) {
            ui.displayError(`Crawl error for ${url}: ${error.message}`);
            this.stats.errors++;
            return [];
        }
    }

    /**
     * Recursively crawl starting from initial URLs
     */
    async crawl(initialUrls) {
        const crawlQueue = initialUrls.map(url => ({
            url,
            type: 'crawlable',
            depth: 0,
            parent: null,
        }));

        const downloadUrls = [];
        const processed = new Set();

        while (crawlQueue.length > 0) {
            const batch = crawlQueue.splice(0, this.options.maxConcurrent);
            const crawlPromises = batch.map(async item => {
                if (processed.has(item.url)) {
                    return [];
                }

                processed.add(item.url);

                if (item.type === 'downloadable') {
                    downloadUrls.push(item);
                    return [];
                }

                return await this.crawlUrl(item.url, item.depth, item.parent);
            });

            const results = await Promise.all(crawlPromises);

            // Add discovered URLs to appropriate queues
            for (const resultSet of results) {
                for (const item of resultSet) {
                    if (item.type === 'crawlable' && item.depth < this.options.maxDepth) {
                        crawlQueue.push(item);
                    } else if (item.type === 'downloadable') {
                        downloadUrls.push(item);
                    }
                }
            }
        }

        return downloadUrls;
    }

    /**
     * Generate local file path that recreates directory structure
     */
    generateLocalPath(url, baseDestination) {
        const urlObject = new URL(url);

        if (!this.options.createDirectoryStructure) {
            // Just use filename
            return path.join(baseDestination, path.basename(urlObject.pathname) || 'index.html');
        }

        // Recreate directory structure
        let localPath = path.join(baseDestination, urlObject.hostname);

        // Add port if not default
        if (urlObject.port
        	&& !((urlObject.protocol === 'http:' && urlObject.port === '80')
        		|| (urlObject.protocol === 'https:' && urlObject.port === '443'))) {
            localPath += `_${urlObject.port}`;
        }

        // Add pathname
        const pathname = urlObject.pathname === '/' ? '/index.html' : urlObject.pathname;
        localPath = path.join(localPath, pathname.slice(1)); // Remove leading slash

        // Ensure we have a filename
        if (localPath.endsWith('/')) {
            localPath = path.join(localPath, 'index.html');
        }

        // Handle query parameters (create a safe filename)
        if (urlObject.search) {
            const extension = path.extname(localPath);
            const base = localPath.slice(0, Math.max(0, localPath.length - extension.length));
            const query = urlObject.search.slice(1).replaceAll(/[^a-zA-Z\d]/g, '_');
            localPath = `${base}_${query}${extension}`;
        }

        return localPath;
    }

    /**
     * Get crawling statistics
     */
    getStats() {
        return {
            ...this.stats,
            visitedUrls: this.visited.size,
            discoveredUrls: this.discovered.size,
        };
    }

    /**
     * Reset crawler state
     */
    reset() {
        this.visited.clear();
        this.discovered.clear();
        this.downloadQueue = [];
        this.robotsCache.clear();
        this.stats = {
            pagesVisited: 0,
            filesDiscovered: 0,
            filesDownloaded: 0,
            totalSize: 0,
            errors: 0,
        };
    }
}

module.exports = RecursiveCrawler;
