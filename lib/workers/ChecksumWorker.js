"use strict";
/**
 * @fileoverview ChecksumWorker — runs inside a worker thread.
 *
 * Receives a file path and list of algorithms via workerData,
 * computes the hashes, and posts the result back to the parent.
 * CPU-bound work belongs here, not on the main event loop.
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
exports.computeChecksums = computeChecksums;
const fs = __importStar(require("node:fs"));
const crypto = __importStar(require("node:crypto"));
const node_worker_threads_1 = require("node:worker_threads");
// ─── Exported core logic (testable without a worker thread) ───────────────────
function computeChecksums(filePath, algorithms) {
    const fileBuffer = fs.readFileSync(filePath);
    const checksums = {};
    for (const algo of algorithms) {
        checksums[algo] = crypto.createHash(algo).update(fileBuffer).digest('hex');
    }
    return checksums;
}
// ─── Worker entry point ───────────────────────────────────────────────────────
// Only runs when loaded as a worker thread, not when require()'d for testing.
if (!node_worker_threads_1.isMainThread && node_worker_threads_1.parentPort !== null) {
    const { filePath, algorithms } = node_worker_threads_1.workerData;
    try {
        node_worker_threads_1.parentPort.postMessage({ ok: true, checksums: computeChecksums(filePath, algorithms) });
    }
    catch (err) {
        node_worker_threads_1.parentPort.postMessage({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
