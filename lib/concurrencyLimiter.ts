/**
 * Concurrency Limiter for controlling simultaneous operations
 * Implements a semaphore-like pattern to limit concurrent downloads
 */

interface QueueItem {
    fn: (...args: unknown[]) => Promise<unknown>;
    args: unknown[];
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
}

interface LimiterStats {
    running: number;
    queued: number;
    maxConcurrent: number;
}

class ConcurrencyLimiter {
    private maxConcurrent: number;
    private running: number;
    private queue: QueueItem[];

    constructor(maxConcurrent: number = 3) {
        this.maxConcurrent = maxConcurrent;
        this.running = 0;
        this.queue = [];
    }

    /**
     * Execute a function with concurrency control
     * @param fn - Async function to execute
     * @param args - Arguments to pass to the function
     * @returns Promise that resolves when function completes
     */
    async execute(fn: (...args: unknown[]) => Promise<unknown>, ...args: unknown[]): Promise<unknown> {
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
    async process(): Promise<void> {
        if (this.running >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }

        this.running++;
        const { fn, args, resolve, reject } = this.queue.shift()!;

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
     * @returns Current running and queued counts
     */
    getStats(): LimiterStats {
        return {
            running: this.running,
            queued: this.queue.length,
            maxConcurrent: this.maxConcurrent,
        };
    }

    /**
     * Update the maximum concurrent limit
     * @param newLimit - New concurrency limit
     */
    setMaxConcurrent(newLimit: number): void {
        this.maxConcurrent = Math.max(1, newLimit);
        // Process queue in case we increased the limit
        this.process();
    }
}

export = ConcurrencyLimiter;
