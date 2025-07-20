/**
 * Concurrency Limiter for controlling simultaneous operations
 * Implements a semaphore-like pattern to limit concurrent downloads
 */

class ConcurrencyLimiter {
    constructor(maxConcurrent = 3) {
        this.maxConcurrent = maxConcurrent;
        this.running = 0;
        this.queue = [];
    }

    /**
     * Execute a function with concurrency control
     * @param {Function} fn - Async function to execute
     * @param {...any} args - Arguments to pass to the function
     * @returns {Promise} Promise that resolves when function completes
     */
    async execute(fn, ...args) {
        return new Promise((resolve, reject) => {
            this.queue.push({
                fn,
                args,
                resolve,
                reject,
            });
            this.process();
        });
    }

    /**
     * Process the queue of pending operations
     */
    async process() {
        if (this.running >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }

        this.running++;
        const {fn, args, resolve, reject} = this.queue.shift();

        try {
            const result = await fn(...args);
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.running--;
            this.process(); // Process next item in queue
        }
    }

    /**
     * Get current statistics
     * @returns {Object} Current running and queued counts
     */
    getStats() {
        return {
            running: this.running,
            queued: this.queue.length,
            maxConcurrent: this.maxConcurrent,
        };
    }

    /**
     * Update the maximum concurrent limit
     * @param {number} newLimit - New concurrency limit
     */
    setMaxConcurrent(newLimit) {
        this.maxConcurrent = Math.max(1, newLimit);
        // Process queue in case we increased the limit
        this.process();
    }
}

module.exports = ConcurrencyLimiter;
