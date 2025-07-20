/**
 * @fileoverview URI validation and normalization module
 * Handles URL parsing, protocol validation, and automatic protocol detection
 * @module uriManager
 */

const {URL} = require('node:url');
// Colors is imported to extend String.prototype with color methods
require('colors');

/**
 * Validates and normalizes a URL string
 * Automatically adds http:// protocol if missing and validates supported protocols
 * @function requestUri
 * @param {string} reqUrl - The URL string to validate and normalize
 * @returns {string} The normalized, valid URL string
 * @throws {Error} When the URL is invalid or uses an unsupported protocol
 */
module.exports = function requestUri(reqUrl) {
    try {
        // Try to parse as complete URL first
        const url = new URL(reqUrl);

        // Check if it's a valid protocol (not localhost:, file:, etc.)
        const validProtocols = ['http:', 'https:', 'ftp:', 'ftps:', 'sftp:'];
        if (validProtocols.includes(url.protocol)) {
            return url.toString();
        }

        // Invalid protocol, treat as missing protocol
        throw new Error('Invalid protocol');
    } catch {
        // If parsing fails, assume it's missing protocol
        try {
            const url = new URL(`http://${reqUrl}`);
            console.log('No Protocol Provided, Defaulting to:'.red, url.protocol);
            return url.toString();
        } catch {
            throw new Error(`Invalid URL: ${reqUrl}`);
        }
    }
};
