/**
 * @fileoverview Resilient download service with enterprise-grade retry logic
 * Implements exponential backoff, circuit breaker pattern, and comprehensive error recovery
 * @module ResilientDownloadService
 */

const DownloadError = require('../errors/DownloadError');

/**
 * Enterprise download service with advanced retry logic and error recovery
 * Provides exponential backoff, jitter, circuit breaker, and comprehensive error handling
 */
class ResilientDownloadService {
    /**
     * Creates a resilient download service
     * @param {Object} dependencies - Service dependencies
     * @param {Object} dependencies.httpClient - HTTP client for downloads
     * @param {Object} dependencies.logger - Structured logger instance
     * @param {Object} dependencies.config - Configuration object
     */
    constructor({ httpClient, logger, config }) {
        this.httpClient = httpClient;
        this.logger = logger;
        this.config = config;
        
        // Retry configuration with sensible defaults
        this.retryConfig = {
            maxRetries: config?.http?.maxRetries || 3,
            baseDelay: config?.http?.baseRetryDelay || 1000, // 1 second
            maxDelay: config?.http?.maxRetryDelay || 30000, // 30 seconds
            exponentialBase: config?.http?.exponentialBase || 2,
            jitterEnabled: config?.http?.jitterEnabled !== false,
            retryableErrors: config?.http?.retryableErrors || [
                'NETWORK_TIMEOUT',
                'NETWORK_UNREACHABLE',
                'CONNECTION_REFUSED',
                'HTTP_500',
                'HTTP_502',
                'HTTP_503',
                'HTTP_504',
                'TOO_MANY_REQUESTS',
                'RATE_LIMITED'
            ]
        };

        // Circuit breaker configuration
        this.circuitBreaker = {
            enabled: config?.circuitBreaker?.enabled !== false,
            failureThreshold: config?.circuitBreaker?.failureThreshold || 5,
            resetTimeout: config?.circuitBreaker?.resetTimeout || 60000, // 1 minute
            monitorWindow: config?.circuitBreaker?.monitorWindow || 300000, // 5 minutes
            state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
            failures: [],
            lastFailureTime: null,
            successCount: 0
        };
    }

    /**
     * Downloads a file with comprehensive retry logic and error recovery
     * @param {string} url - URL to download from
     * @param {string} destination - Local destination path
     * @param {Object} [options={}] - Download options
     * @param {number} [options.maxRetries] - Override default max retries
     * @param {boolean} [options.enableResume=true] - Enable resume functionality
     * @param {Object} [options.headers={}] - Additional HTTP headers
     * @param {Function} [options.progressCallback] - Progress callback function
     * @returns {Promise<Object>} Download result with metrics
     * @throws {DownloadError} When download fails after all retries
     */
    async downloadWithRetry(url, destination, options = {}) {
        const startTime = Date.now();
        const maxRetries = options.maxRetries !== undefined ? options.maxRetries : this.retryConfig.maxRetries;
        
        // Check circuit breaker state
        if (this.circuitBreaker.enabled && this.isCircuitOpen(url)) {
            throw new DownloadError(
                'CIRCUIT_BREAKER_OPEN',
                `Circuit breaker is open for ${url}. Service temporarily unavailable.`,
                { 
                    url,
                    circuitState: this.circuitBreaker.state,
                    failureCount: this.circuitBreaker.failures.length
                }
            );
        }

        let lastError;
        let attemptStartTime;

        this.logger.info('Starting resilient download', {
            url,
            destination,
            maxRetries,
            circuitBreakerEnabled: this.circuitBreaker.enabled
        });

        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            attemptStartTime = Date.now();
            
            try {
                const result = await this.attemptDownload(url, destination, options, attempt);
                
                // Record success for circuit breaker
                this.recordSuccess(url);
                
                if (attempt > 1) {
                    this.logger.info('Download recovered after retries', {
                        url,
                        attempt,
                        totalAttempts: maxRetries + 1,
                        totalDuration: Date.now() - startTime,
                        recoveryTime: Date.now() - attemptStartTime
                    });
                }

                return {
                    ...result,
                    retryInfo: {
                        attempts: attempt,
                        totalDuration: Date.now() - startTime,
                        recovered: attempt > 1
                    }
                };

            } catch (error) {
                lastError = error;
                const attemptDuration = Date.now() - attemptStartTime;

                // Record failure for circuit breaker
                this.recordFailure(url, error);

                // Check if error is retryable
                if (!this.isRetryableError(error) || attempt > maxRetries) {
                    this.logger.error('Download failed permanently', {
                        url,
                        attempt,
                        error: error.message,
                        errorCode: error.code,
                        retryable: this.isRetryableError(error),
                        duration: attemptDuration
                    });
                    break;
                }

                const backoffDelay = this.calculateBackoffDelay(attempt);
                
                this.logger.warn('Download attempt failed, retrying', {
                    url,
                    attempt,
                    maxRetries,
                    error: error.message,
                    errorCode: error.code,
                    retryInMs: backoffDelay,
                    duration: attemptDuration
                });

                // Wait before retry with exponential backoff
                await this.sleep(backoffDelay);
            }
        }

        // All retries exhausted
        const totalDuration = Date.now() - startTime;
        
        this.logger.error('Download failed after all retries', {
            url,
            attempts: maxRetries + 1,
            totalDuration,
            finalError: lastError.message,
            finalErrorCode: lastError.code
        });

        throw new DownloadError(
            'DOWNLOAD_FAILED_AFTER_RETRIES',
            `Download failed after ${maxRetries + 1} attempts: ${lastError.message}`,
            { 
                originalError: lastError,
                attempts: maxRetries + 1,
                url,
                totalDuration,
                retryHistory: this.getRetryHistory(url)
            }
        );
    }

    /**
     * Attempts a single download operation
     * @param {string} url - URL to download
     * @param {string} destination - Destination path
     * @param {Object} options - Download options
     * @param {number} attempt - Current attempt number
     * @returns {Promise<Object>} Download result
     * @private
     */
    async attemptDownload(url, destination, options, attempt) {
        try {
            // Use existing download logic from recursivePipe
            const recursivePipe = require('../recursivePipe');
            const results = await recursivePipe([url], destination, {
                enableResume: options.enableResume !== false,
                quietMode: true, // Suppress UI output for service calls
                maxConcurrent: 1,
                sshOptions: options.sshOptions || {}
            });

            if (!results || results.length === 0 || !results[0].success) {
                const error = results?.[0]?.error || 'Unknown download error';
                throw new DownloadError('DOWNLOAD_FAILED', error, { url, attempt });
            }

            return results[0];

        } catch (error) {
            // Wrap non-DownloadError instances
            if (!(error instanceof DownloadError)) {
                if (error.message.includes('timeout') || error.code === 'ETIMEDOUT') {
                    throw DownloadError.networkError(error.message, url, { attempt });
                } else if (error.message.includes('ENOTFOUND')) {
                    throw DownloadError.networkError(error.message, url, { attempt });
                } else if (error.message.includes('ECONNREFUSED')) {
                    throw DownloadError.networkError(error.message, url, { attempt });
                } else if (error.message.includes('HTTP')) {
                    const statusMatch = error.message.match(/HTTP (\d+)/);
                    if (statusMatch) {
                        const statusCode = parseInt(statusMatch[1]);
                        throw DownloadError.httpError(statusCode, error.message, url, { attempt });
                    }
                }
                
                throw new DownloadError('UNKNOWN_ERROR', error.message, { originalError: error, url, attempt });
            }
            
            throw error;
        }
    }

    /**
     * Calculates exponential backoff delay with jitter
     * @param {number} attempt - Current attempt number (1-based)
     * @returns {number} Delay in milliseconds
     * @private
     */
    calculateBackoffDelay(attempt) {
        const exponentialDelay = this.retryConfig.baseDelay * 
            Math.pow(this.retryConfig.exponentialBase, attempt - 1);
        
        let delay = Math.min(exponentialDelay, this.retryConfig.maxDelay);
        
        // Add jitter to prevent thundering herd effect
        if (this.retryConfig.jitterEnabled) {
            const jitter = Math.random() * 0.3 * delay; // Up to 30% jitter
            delay = delay + jitter;
        }
        
        return Math.floor(delay);
    }

    /**
     * Determines if an error is retryable based on configuration
     * @param {Error|DownloadError} error - Error to check
     * @returns {boolean} True if error is retryable
     * @private
     */
    isRetryableError(error) {
        if (error instanceof DownloadError) {
            return this.retryConfig.retryableErrors.includes(error.code);
        }
        
        // Fallback for non-DownloadError instances
        const message = error.message.toLowerCase();
        return message.includes('timeout') ||
               message.includes('econnreset') ||
               message.includes('econnrefused') ||
               message.includes('502') ||
               message.includes('503') ||
               message.includes('504');
    }

    /**
     * Records a successful download for circuit breaker
     * @param {string} url - URL that succeeded
     * @private
     */
    recordSuccess(url) {
        if (!this.circuitBreaker.enabled) return;

        this.circuitBreaker.successCount++;
        
        // If circuit was half-open and we got success, close it
        if (this.circuitBreaker.state === 'HALF_OPEN') {
            this.circuitBreaker.state = 'CLOSED';
            this.circuitBreaker.failures = [];
            this.logger.info('Circuit breaker closed after successful recovery', { url });
        }
    }

    /**
     * Records a failed download for circuit breaker
     * @param {string} url - URL that failed
     * @param {Error} error - Error that occurred
     * @private
     */
    recordFailure(url, error) {
        if (!this.circuitBreaker.enabled) return;

        const now = Date.now();
        this.circuitBreaker.failures.push({
            timestamp: now,
            url,
            error: error.code || error.message
        });
        this.circuitBreaker.lastFailureTime = now;

        // Clean old failures outside the monitor window
        this.circuitBreaker.failures = this.circuitBreaker.failures.filter(
            failure => now - failure.timestamp < this.circuitBreaker.monitorWindow
        );

        // Check if we should open the circuit
        if (this.circuitBreaker.failures.length >= this.circuitBreaker.failureThreshold &&
            this.circuitBreaker.state === 'CLOSED') {
            
            this.circuitBreaker.state = 'OPEN';
            this.logger.warn('Circuit breaker opened due to repeated failures', {
                url,
                failureCount: this.circuitBreaker.failures.length,
                threshold: this.circuitBreaker.failureThreshold
            });
        }
    }

    /**
     * Checks if circuit breaker is open for a URL
     * @param {string} url - URL to check
     * @returns {boolean} True if circuit is open
     * @private
     */
    isCircuitOpen(url) {
        if (!this.circuitBreaker.enabled) return false;

        const now = Date.now();

        // If circuit is open, check if we should move to half-open
        if (this.circuitBreaker.state === 'OPEN') {
            if (now - this.circuitBreaker.lastFailureTime > this.circuitBreaker.resetTimeout) {
                this.circuitBreaker.state = 'HALF_OPEN';
                this.logger.info('Circuit breaker moved to half-open state', { url });
                return false;
            }
            return true;
        }

        return false;
    }

    /**
     * Gets retry history for a URL (for debugging)
     * @param {string} url - URL to get history for
     * @returns {Array} Recent failure history
     * @private
     */
    getRetryHistory(url) {
        if (!this.circuitBreaker.enabled) return [];
        
        return this.circuitBreaker.failures
            .filter(failure => failure.url === url)
            .slice(-5) // Last 5 failures
            .map(failure => ({
                timestamp: failure.timestamp,
                error: failure.error,
                timeAgo: Date.now() - failure.timestamp
            }));
    }

    /**
     * Sleep utility for retry delays
     * @param {number} ms - Milliseconds to sleep
     * @returns {Promise<void>}
     * @private
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Gets current circuit breaker status
     * @returns {Object} Circuit breaker status
     */
    getCircuitBreakerStatus() {
        return {
            enabled: this.circuitBreaker.enabled,
            state: this.circuitBreaker.state,
            failureCount: this.circuitBreaker.failures.length,
            successCount: this.circuitBreaker.successCount,
            lastFailureTime: this.circuitBreaker.lastFailureTime,
            recentFailures: this.circuitBreaker.failures.slice(-3)
        };
    }

    /**
     * Resets circuit breaker state (for testing or manual recovery)
     */
    resetCircuitBreaker() {
        this.circuitBreaker.state = 'CLOSED';
        this.circuitBreaker.failures = [];
        this.circuitBreaker.lastFailureTime = null;
        this.circuitBreaker.successCount = 0;
        
        this.logger.info('Circuit breaker manually reset');
    }
}

module.exports = ResilientDownloadService;