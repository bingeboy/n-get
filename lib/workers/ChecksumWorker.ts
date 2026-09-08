/**
 * @fileoverview ChecksumWorker — runs inside a worker thread.
 *
 * Receives a file path and list of algorithms via workerData,
 * computes the hashes, and posts the result back to the parent.
 * CPU-bound work belongs here, not on the main event loop.
 */

import * as fs     from 'node:fs';
import * as crypto from 'node:crypto';
import { workerData, parentPort, isMainThread } from 'node:worker_threads';

import type { ChecksumResult } from '../../types/index.js';

export interface ChecksumWorkerInput {
    filePath:   string;
    algorithms: string[];
}

export type ChecksumWorkerOutput =
    | { ok: true;  checksums: ChecksumResult }
    | { ok: false; error: string };

// ─── Exported core logic (testable without a worker thread) ───────────────────

export function computeChecksums(filePath: string, algorithms: string[]): ChecksumResult {
    const fileBuffer = fs.readFileSync(filePath);
    const checksums: ChecksumResult = {};
    for (const algo of algorithms) {
        checksums[algo] = crypto.createHash(algo).update(fileBuffer).digest('hex');
    }
    return checksums;
}

// ─── Worker entry point ───────────────────────────────────────────────────────
// Only runs when loaded as a worker thread, not when require()'d for testing.

if (!isMainThread && parentPort !== null) {
    const { filePath, algorithms } = workerData as ChecksumWorkerInput;
    try {
        parentPort.postMessage({ ok: true, checksums: computeChecksums(filePath, algorithms) });
    } catch (err) {
        parentPort.postMessage({
            ok:    false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
