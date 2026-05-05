"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.checksumPool = exports.ChecksumPool = void 0;
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_worker_threads_1 = require("node:worker_threads");
// Path to the compiled worker file (tsc emits ChecksumWorker.js next to this file)
const WORKER_PATH = path.join(__dirname, 'ChecksumWorker.js');
const MAX_WORKERS = Math.min(os.cpus().length, 4);
// ─── ChecksumPool ─────────────────────────────────────────────────────────────
class ChecksumPool {
    _active = 0;
    _queue = [];
    get concurrency() { return MAX_WORKERS; }
    /**
     * Compute checksums for a file.
     * Queues the job if all worker slots are occupied.
     */
    compute(filePath, algorithms = ['md5', 'sha256']) {
        return new Promise((resolve, reject) => {
            const run = () => {
                this._active++;
                const worker = new node_worker_threads_1.Worker(WORKER_PATH, {
                    workerData: { filePath, algorithms },
                });
                worker.once('message', (msg) => {
                    this._active--;
                    this._drain();
                    if (msg.ok) {
                        resolve(msg.checksums ?? {});
                    }
                    else {
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
            }
            else {
                this._queue.push(run);
            }
        });
    }
    /** Release any queued jobs after a worker slot frees up. */
    _drain() {
        const next = this._queue.shift();
        if (next) {
            next();
        }
    }
    /** Terminate all idle workers (active workers finish naturally). */
    destroy() {
        this._queue.length = 0;
    }
}
exports.ChecksumPool = ChecksumPool;
/** Module-level singleton — reuse across calls within one process. */
exports.checksumPool = new ChecksumPool();
