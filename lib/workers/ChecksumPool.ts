/**
 * @fileoverview ChecksumPool — worker-thread pool for CPU-bound hash computation.
 *
 * Downloads are I/O-bound and run fine on the event loop.
 * Checksum computation is CPU-bound and blocks on large files.
 * This pool off-loads that work to up to min(cpus, 4) threads.
 *
 * Usage:
 *   const pool = new ChecksumPool();
 *   const checksums = await pool.compute('/path/to/file', ['md5', 'sha256']);
 *   // returns { md5: '...', sha256: '...' }
 *   pool.destroy();  // optional — workers are short-lived anyway
 */

import * as os   from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

import type { ChecksumResult } from '../../types/index.js';

// Path to the compiled worker file (tsc emits ChecksumWorker.js next to this file)
const WORKER_PATH = path.join(__dirname, 'ChecksumWorker.js');

const MAX_WORKERS = Math.min(os.cpus().length, 4);

// ─── ChecksumPool ─────────────────────────────────────────────────────────────

export class ChecksumPool {
    private _active: number = 0;
    private readonly _queue: Array<() => void> = [];

    get concurrency(): number { return MAX_WORKERS; }

    /**
     * Compute checksums for a file.
     * Queues the job if all worker slots are occupied.
     */
    compute(filePath: string, algorithms: string[] = ['md5', 'sha256']): Promise<ChecksumResult> {
        return new Promise((resolve, reject) => {
            const run = () => {
                this._active++;
                const worker = new Worker(WORKER_PATH, {
                    workerData: { filePath, algorithms },
                });

                worker.once('message', (msg: { ok: boolean; checksums?: ChecksumResult; error?: string }) => {
                    this._active--;
                    this._drain();
                    if (msg.ok) {
                        resolve(msg.checksums ?? {});
                    } else {
                        reject(new Error(msg.error ?? 'checksum worker failed'));
                    }
                });

                worker.once('error', (err) => {
                    this._active--;
                    this._drain();
                    reject(err);
                });
            };

            if (this._active < MAX_WORKERS) {
                run();
            } else {
                this._queue.push(run);
            }
        });
    }

    /** Release any queued jobs after a worker slot frees up. */
    private _drain(): void {
        const next = this._queue.shift();
        if (next) { next(); }
    }

    /** Terminate all idle workers (active workers finish naturally). */
    destroy(): void {
        this._queue.length = 0;
    }
}

/** Module-level singleton — reuse across calls within one process. */
export const checksumPool = new ChecksumPool();
