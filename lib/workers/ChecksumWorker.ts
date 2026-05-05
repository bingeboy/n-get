/**
 * @fileoverview ChecksumWorker — runs inside a worker thread.
 *
 * Receives a file path and list of algorithms via workerData,
 * computes the hashes, and posts the result back to the parent.
 * CPU-bound work belongs here, not on the main event loop.
 */

import * as fs     from 'node:fs';
import * as crypto from 'node:crypto';
import { workerData, parentPort } from 'node:worker_threads';

import type { ChecksumResult } from '../../types/index.js';

export interface ChecksumWorkerInput {
    filePath:   string;
    algorithms: string[];
}

export type ChecksumWorkerOutput =
    | { ok: true;  checksums: ChecksumResult }
    | { ok: false; error: string };

// ─── Worker entry point ───────────────────────────────────────────────────────
// This file is loaded by worker_threads; the code below runs immediately.

if (parentPort === null) {
    // Guard: if someone accidentally require()s this file, do nothing.
    process.exit(0);
}

const { filePath, algorithms } = workerData as ChecksumWorkerInput;

try {
    const fileBuffer = fs.readFileSync(filePath);
    const checksums: ChecksumResult = {};

    for (const algo of algorithms) {
        checksums[algo] = crypto.createHash(algo).update(fileBuffer).digest('hex');
    }

    parentPort.postMessage({ ok: true, checksums });
} catch (err) {
    parentPort.postMessage({
        ok:    false,
        error: err instanceof Error ? err.message : String(err),
    });
}
