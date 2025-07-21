/**
 * @fileoverview URI validation and normalization module
 * Handles URL parsing, protocol validation, and automatic protocol detection with IPv6 support
 * @module uriManager
 */

const {URL} = require('node:url');
const IPv6Utils = require('./utils/ipv6Utils');
// Colors is imported to extend String.prototype with color methods
require('colors');

/**
 * Validates and normalizes a URL string with IPv6 support
 * Automatically adds http:// protocol if missing and validates supported protocols
 * Properly handles IPv6 addresses in URLs
 * @function requestUri
 * @param {string} reqUrl - The URL string to validate and normalize
 * @returns {string} The normalized, valid URL string
 * @throws {Error} When the URL is invalid or uses an unsupported protocol
 */
module.exports = function requestUri(reqUrl) {
    const validProtocols = ['http:', 'https:', 'ftp:', 'ftps:', 'sftp:'];

    try {
        // Try to parse as complete URL first
        const url = new URL(reqUrl);

        // Validate protocol
        if (validProtocols.includes(url.protocol)) {
            // Parse and validate IPv6 if present
            const ipv6Info = IPv6Utils.parseURL(reqUrl);
            if (ipv6Info.isIPv6) {
                // Ensure IPv6 address is properly formatted
                return url.toString();
            }
            return url.toString();
        }

        // Invalid protocol, treat as missing protocol
        throw new Error('Invalid protocol');
    } catch (error) {
        // If parsing fails, might be missing protocol or malformed IPv6
        try {
            // Check if this looks like an IPv6 address
            const addressInfo = IPv6Utils.detectAddressType(reqUrl);
            let normalizedHost = reqUrl;

            if (addressInfo.type === 'ipv6-plain') {
                // Plain IPv6 address, wrap in brackets
                normalizedHost = IPv6Utils.wrapIPv6InBrackets(reqUrl);
            } else if (addressInfo.type === 'ipv6-bracketed') {
                // Already bracketed IPv6
                normalizedHost = reqUrl;
            }

            // Try to construct URL with http:// prefix
            const url = new URL(`http://${normalizedHost}`);
            console.log('No Protocol Provided, Defaulting to:'.red, url.protocol);
            
            // Final validation of the constructed URL
            const finalValidation = IPv6Utils.parseURL(url.toString());
            if (finalValidation.error) {
                throw new Error(finalValidation.error);
            }
            
            return url.toString();
        } catch (constructError) {
            throw new Error(`Invalid URL: ${reqUrl} - ${constructError.message}`);
        }
    }
};
