"use strict";
/**
 * @fileoverview Verifies a downloaded file against a caller-supplied checksum.
 *
 * n-get has always computed checksums and reported them. It has never compared
 * one to an expected value, so it could answer "what is this file's SHA-256?"
 * but not "is this the file I asked for?" — the question that matters when an
 * agent downloads something unattended and a later step consumes it.
 *
 * @module checksumVerifier
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_ALGORITHMS = void 0;
exports.parseExpectation = parseExpectation;
exports.verifyFile = verifyFile;
const ChecksumPool_1 = require("./workers/ChecksumPool");
/** Algorithms ChecksumWorker can compute. */
const SUPPORTED = ['md5', 'sha1', 'sha256', 'sha512'];
/** Hex digest length for each algorithm, used to reject truncated values. */
const DIGEST_LENGTH = {
    md5: 32,
    sha1: 40,
    sha256: 64,
    sha512: 128,
};
/**
 * Parse an `<algorithm>:<hex>` expectation.
 *
 * Rejects rather than guesses: a mistyped expectation that silently passed
 * would be worse than no verification at all, since the caller would believe
 * the file had been checked.
 *
 * @param spec - e.g. `sha256:9f86d081...`
 * @returns the parsed expectation
 * @throws {Error} when the algorithm is unsupported or the digest malformed
 */
function parseExpectation(spec) {
    const trimmed = String(spec ?? '').trim();
    const separator = trimmed.indexOf(':');
    if (separator === -1) {
        throw new Error(`Invalid checksum "${trimmed}". Expected <algorithm>:<hex>, e.g. sha256:9f86d081...`);
    }
    const algorithm = trimmed.slice(0, separator).toLowerCase();
    const digest = trimmed.slice(separator + 1).toLowerCase();
    if (!SUPPORTED.includes(algorithm)) {
        throw new Error(`Unsupported checksum algorithm "${algorithm}". Supported: ${SUPPORTED.join(', ')}.`);
    }
    if (!/^[0-9a-f]+$/.test(digest)) {
        throw new Error(`Invalid ${algorithm} digest: expected hex characters only.`);
    }
    if (digest.length !== DIGEST_LENGTH[algorithm]) {
        throw new Error(`Invalid ${algorithm} digest: expected ${DIGEST_LENGTH[algorithm]} hex characters, got ${digest.length}.`);
    }
    return { algorithm, digest };
}
/**
 * Compute the file's digest and compare it to the expectation.
 *
 * @param filePath - the file just written
 * @param expectation - parsed expectation
 * @returns the comparison, including the actual digest for reporting
 */
async function verifyFile(filePath, expectation) {
    const checksums = await ChecksumPool_1.checksumPool.compute(filePath, [expectation.algorithm]);
    const actual = String(checksums[expectation.algorithm] ?? '').toLowerCase();
    return {
        ok: actual.length > 0 && actual === expectation.digest,
        algorithm: expectation.algorithm,
        expected: expectation.digest,
        actual,
    };
}
exports.SUPPORTED_ALGORITHMS = SUPPORTED;
