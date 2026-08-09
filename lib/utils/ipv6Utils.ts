/**
 * @fileoverview IPv6 utility functions for URL parsing and validation
 * Handles IPv6 address detection, validation, and URL normalization
 * @module ipv6Utils
 */

import { isIP } from 'node:net';

interface AddressDetection {
    type: 'ipv6-bracketed' | 'ipv6-plain' | 'ipv4' | 'hostname' | 'invalid';
    address: string;
    original: string;
    needsBrackets: boolean;
}

/**
 * IPv6 utility class for parsing and validating IPv6 addresses in URLs
 */
class IPv6Utils {
    /**
     * Checks if a string is a valid IPv6 address
     * @param address - The address to check
     * @returns True if valid IPv6 address
     */
    static isValidIPv6(address: string): boolean {
        return isIP(address) === 6;
    }

    /**
     * Checks if a string is a valid IPv4 address
     * @param address - The address to check
     * @returns True if valid IPv4 address
     */
    static isValidIPv4(address: string): boolean {
        return isIP(address) === 4;
    }

    /**
     * Extracts IPv6 address from bracketed format [::1]
     * @param bracketedAddress - IPv6 address in brackets
     * @returns IPv6 address without brackets, or null if invalid
     */
    static extractIPv6FromBrackets(bracketedAddress: string): string | null {
        const match = bracketedAddress.match(/^\[([^\]]+)\]$/);
        if (match && this.isValidIPv6(match[1])) {
            return match[1];
        }
        return null;
    }

    /**
     * Wraps IPv6 address in brackets for URL usage
     * @param ipv6Address - Plain IPv6 address
     * @returns IPv6 address wrapped in brackets
     */
    static wrapIPv6InBrackets(ipv6Address: string): string {
        return `[${ipv6Address}]`;
    }

    /**
     * Detects if a hostname is an IPv6 address (with or without brackets)
     * @param hostname - The hostname to check
     * @returns Detection result with type and address info
     */
    static detectAddressType(hostname: string): AddressDetection {
        // Check for bracketed IPv6 [::1]
        const bracketedMatch = hostname.match(/^\[([^\]]+)\]$/);
        if (bracketedMatch) {
            const address = bracketedMatch[1];
            return {
                type: this.isValidIPv6(address) ? 'ipv6-bracketed' : 'invalid',
                address: address,
                original: hostname,
                needsBrackets: false, // Already has brackets
            };
        }

        // Check for plain IPv6 address
        if (this.isValidIPv6(hostname)) {
            return {
                type: 'ipv6-plain',
                address: hostname,
                original: hostname,
                needsBrackets: true, // Needs brackets for URL
            };
        }

        // Check for IPv4 address
        if (this.isValidIPv4(hostname)) {
            return {
                type: 'ipv4',
                address: hostname,
                original: hostname,
                needsBrackets: false,
            };
        }

        // Regular hostname
        return {
            type: 'hostname',
            address: hostname,
            original: hostname,
            needsBrackets: false,
        };
    }

    /**
     * Normalizes a hostname for URL usage
     * Ensures IPv6 addresses are properly bracketed
     * @param hostname - The hostname to normalize
     * @returns Normalized hostname ready for URL construction
     */
    static normalizeHostname(hostname: string): string {
        const detection = this.detectAddressType(hostname);

        switch (detection.type) {
        case 'ipv6-plain':
            // Wrap plain IPv6 in brackets
            return this.wrapIPv6InBrackets(detection.address);
        case 'ipv6-bracketed':
        case 'ipv4':
        case 'hostname':
            // Already properly formatted
            return hostname;
        default:
            return hostname; // Return as-is for invalid addresses
        }
    }

    /**
     * Parses a URL and extracts IPv6 information if present
     * @param urlString - The URL to parse
     * @returns Parsed URL information with IPv6 details
     */
    static parseURL(urlString: string): Record<string, unknown> {
        try {
            const url = new URL(urlString);
            const addressInfo = this.detectAddressType(url.hostname);

            return {
                url: url,
                hostname: url.hostname,
                addressInfo: addressInfo,
                isIPv6: addressInfo.type.startsWith('ipv6'),
                isIPv4: addressInfo.type === 'ipv4',
                isHostname: addressInfo.type === 'hostname',
                normalizedHostname: this.normalizeHostname(url.hostname),
                family: addressInfo.type.startsWith('ipv6') ? 6 : (addressInfo.type === 'ipv4' ? 4 : 0),
            };
        } catch (error) {
            return {
                error: (error as Error).message,
                isValid: false,
            };
        }
    }

    /**
     * Creates a properly formatted URL with IPv6 support
     * @param protocol - The protocol (http:, https:, etc.)
     * @param hostname - The hostname or IP address
     * @param port - Optional port number
     * @param pathname - Optional path
     * @returns Properly formatted URL
     */
    static createURL(protocol: string, hostname: string, port?: number, pathname: string = ''): string {
        const normalizedHost = this.normalizeHostname(hostname);
        let urlString = `${protocol}//${normalizedHost}`;

        if (port && port !== 80 && port !== 443) {
            urlString += `:${port}`;
        }

        if (pathname && !pathname.startsWith('/')) {
            urlString += '/';
        }

        urlString += pathname || '';

        return urlString;
    }

    /**
     * Validates if a URL string contains a properly formatted IPv6 address
     * @param urlString - The URL to validate
     * @returns Validation result
     */
    static validateIPv6URL(urlString: string): Record<string, unknown> {
        try {
            const parsed = this.parseURL(urlString);

            if (parsed.error) {
                return {
                    valid: false,
                    error: parsed.error,
                };
            }

            if (parsed.isIPv6) {
                return {
                    valid: true,
                    ipv6Address: (parsed.addressInfo as AddressDetection).address,
                    normalizedURL: urlString,
                    family: 6,
                };
            }

            return {
                valid: true,
                isIPv6: false,
                family: parsed.family || 0,
            };
        } catch (error) {
            return {
                valid: false,
                error: (error as Error).message,
            };
        }
    }

    /**
     * Common IPv6 address examples for testing
     */
    static get COMMON_IPV6_ADDRESSES(): Record<string, string> {
        return {
            LOOPBACK: '::1',
            UNSPECIFIED: '::',
            IPV4_MAPPED: '::ffff:192.168.1.1',
            DOCUMENTATION: '2001:db8::1',
            LINK_LOCAL: 'fe80::1',
            UNIQUE_LOCAL: 'fd00::1',
        };
    }

    /**
     * Gets example URLs for different IPv6 address types
     */
    static get EXAMPLE_IPV6_URLS(): Record<string, string> {
        return {
            HTTP_LOOPBACK: 'http://[::1]/',
            HTTPS_LOOPBACK: 'https://[::1]:8443/',
            HTTP_DOCUMENTATION: 'http://[2001:db8::1]/path',
            HTTPS_WITH_PORT: 'https://[2001:db8::1]:3000/api',
            FTP_IPV6: 'ftp://[2001:db8::1]/file.txt',
        };
    }
}

export = IPv6Utils;
