/**
 * @fileoverview Enterprise security service for input validation and threat prevention
 * Implements comprehensive security checks, path traversal prevention, and protocol validation
 * @module SecurityService
 */

const {URL} = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const {isIP} = require('node:net');
const DownloadError = require('../errors/DownloadError');
const IPv6Utils = require('../utils/ipv6Utils');

/**
 * Enterprise security service for validating download requests and preventing security threats
 * Provides comprehensive input validation, path traversal prevention, and protocol enforcement
 */
class SecurityService {
    /**
     * Creates a security service instance
     * @param {Object} dependencies - Service dependencies
     * @param {Object} dependencies.config - Security configuration
     * @param {Object} dependencies.logger - Structured logger instance
     */
    constructor({ config, logger }) {
        this.config = config;
        this.logger = logger;
        
        // Security configuration with secure defaults
        this.securityConfig = {
            allowedProtocols: config?.security?.allowedProtocols || ['https', 'http', 'sftp'],
            maxFileSize: config?.security?.maxFileSize || 10 * 1024 * 1024 * 1024, // 10GB
            maxUrlLength: config?.security?.maxUrlLength || 2048,
            maxPathLength: config?.security?.maxPathLength || 260, // Windows MAX_PATH
            blockedDomains: config?.security?.blockedDomains || [],
            allowedDomains: config?.security?.allowedDomains || [], // Empty = allow all
            blockPrivateNetworks: config?.security?.blockPrivateNetworks !== false,
            blockLocalhost: config?.security?.blockLocalhost !== false,
            enablePathTraversalProtection: config?.security?.enablePathTraversalProtection !== false,
            maxConcurrentDownloads: config?.security?.maxConcurrentDownloads || 20,
            rateLimitRequests: config?.security?.rateLimitRequests || 100, // per minute
            sanitizeFilenames: config?.security?.sanitizeFilenames !== false
        };

        // Rate limiting state
        this.rateLimiter = {
            requests: new Map(), // IP -> [timestamps]
            windowMs: 60000 // 1 minute window
        };
    }

    /**
     * Validates a complete download request for security compliance
     * @param {Object} request - Download request to validate
     * @param {string} request.url - URL to download from
     * @param {string} [request.destination] - Local destination path
     * @param {Object} [request.headers={}] - HTTP headers
     * @param {string} [request.clientIp] - Client IP for rate limiting
     * @returns {Object} Validation result with isValid flag and errors array
     */
    validateDownloadRequest(request) {
        const errors = [];
        const warnings = [];

        try {
            // URL validation
            const urlValidation = this.validateUrl(request.url);
            if (!urlValidation.isValid) {
                errors.push(...urlValidation.errors);
            }
            warnings.push(...(urlValidation.warnings || []));

            // Destination path validation
            if (request.destination) {
                const pathValidation = this.validateDestinationPath(request.destination);
                if (!pathValidation.isValid) {
                    errors.push(...pathValidation.errors);
                }
                warnings.push(...(pathValidation.warnings || []));
            }

            // Headers validation
            if (request.headers) {
                const headerValidation = this.validateHeaders(request.headers);
                if (!headerValidation.isValid) {
                    errors.push(...headerValidation.errors);
                }
            }

            // Rate limiting check
            if (request.clientIp) {
                const rateLimitValidation = this.checkRateLimit(request.clientIp);
                if (!rateLimitValidation.isValid) {
                    errors.push(...rateLimitValidation.errors);
                }
            }

            const isValid = errors.length === 0;

            if (!isValid) {
                this.logger.warn('Download request failed security validation', {
                    url: request.url,
                    destination: request.destination,
                    errors: errors.map(e => e.code),
                    clientIp: request.clientIp
                });
            }

            return {
                isValid,
                errors,
                warnings,
                sanitizedRequest: this.sanitizeRequest(request)
            };

        } catch (error) {
            this.logger.error('Security validation error', {
                error: error.message,
                request: { url: request.url, destination: request.destination }
            });

            return {
                isValid: false,
                errors: [{
                    field: 'general',
                    code: 'VALIDATION_SYSTEM_ERROR',
                    message: 'Security validation system error'
                }],
                warnings: []
            };
        }
    }

    /**
     * Validates URL for security compliance
     * @param {string} url - URL to validate
     * @returns {Object} Validation result
     */
    validateUrl(url) {
        const errors = [];
        const warnings = [];

        // Basic URL length check
        if (!url || typeof url !== 'string') {
            errors.push({
                field: 'url',
                code: 'INVALID_URL',
                message: 'URL is required and must be a string'
            });
            return { isValid: false, errors, warnings };
        }

        if (url.length > this.securityConfig.maxUrlLength) {
            errors.push({
                field: 'url',
                code: 'URL_TOO_LONG',
                message: `URL exceeds maximum length of ${this.securityConfig.maxUrlLength} characters`
            });
        }

        try {
            const urlObj = new URL(url);

            // Protocol validation
            const protocol = urlObj.protocol.slice(0, -1); // Remove trailing ':'
            if (!this.securityConfig.allowedProtocols.includes(protocol)) {
                errors.push({
                    field: 'url',
                    code: 'INVALID_PROTOCOL',
                    message: `Protocol '${protocol}' not allowed. Allowed protocols: ${this.securityConfig.allowedProtocols.join(', ')}`
                });
            }

            // Domain validation
            const hostname = urlObj.hostname.toLowerCase();
            
            // Check blocked domains
            if (this.securityConfig.blockedDomains.some(domain => 
                hostname === domain || hostname.endsWith('.' + domain))) {
                errors.push({
                    field: 'url',
                    code: 'BLOCKED_DOMAIN',
                    message: `Domain '${hostname}' is blocked by security policy`
                });
            }

            // Check allowed domains (if whitelist is configured)
            if (this.securityConfig.allowedDomains.length > 0 &&
                !this.securityConfig.allowedDomains.some(domain => 
                    hostname === domain || hostname.endsWith('.' + domain))) {
                errors.push({
                    field: 'url',
                    code: 'DOMAIN_NOT_ALLOWED',
                    message: `Domain '${hostname}' is not in the allowed domains list`
                });
            }

            // Private network and localhost checks
            if (this.securityConfig.blockLocalhost && this.isLocalhost(hostname)) {
                errors.push({
                    field: 'url',
                    code: 'LOCAL_ACCESS_DENIED',
                    message: 'Access to localhost addresses is not allowed'
                });
            }

            if (this.securityConfig.blockPrivateNetworks && this.isPrivateNetwork(hostname)) {
                errors.push({
                    field: 'url',
                    code: 'PRIVATE_NETWORK_ACCESS_DENIED',
                    message: 'Access to private network addresses is not allowed'
                });
            }

            // Warn about HTTP vs HTTPS
            if (protocol === 'http' && !hostname.startsWith('localhost') && !this.isPrivateNetwork(hostname)) {
                warnings.push({
                    field: 'url',
                    code: 'INSECURE_PROTOCOL',
                    message: 'Using HTTP instead of HTTPS may expose data to interception'
                });
            }

            // Check for suspicious URL patterns
            const suspiciousPatterns = [
                /[<>"\s]/, // HTML characters or whitespace
                /javascript:/i,
                /data:/i,
                /vbscript:/i,
                /\.\./, // Path traversal attempts in URL
                /%2e%2e/i, // URL-encoded path traversal
                /%00/, // Null byte injection
            ];

            for (const pattern of suspiciousPatterns) {
                if (pattern.test(url)) {
                    errors.push({
                        field: 'url',
                        code: 'SUSPICIOUS_URL_PATTERN',
                        message: 'URL contains potentially malicious patterns'
                    });
                    break;
                }
            }

        } catch (urlError) {
            errors.push({
                field: 'url',
                code: 'MALFORMED_URL',
                message: 'Invalid URL format'
            });
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validates destination path for security compliance
     * @param {string} destinationPath - Destination path to validate
     * @returns {Object} Validation result
     */
    validateDestinationPath(destinationPath) {
        const errors = [];
        const warnings = [];

        if (!destinationPath || typeof destinationPath !== 'string') {
            errors.push({
                field: 'destination',
                code: 'INVALID_PATH',
                message: 'Destination path must be a non-empty string'
            });
            return { isValid: false, errors, warnings };
        }

        // Path length check
        if (destinationPath.length > this.securityConfig.maxPathLength) {
            errors.push({
                field: 'destination',
                code: 'PATH_TOO_LONG',
                message: `Path exceeds maximum length of ${this.securityConfig.maxPathLength} characters`
            });
        }

        // Path traversal protection
        if (this.securityConfig.enablePathTraversalProtection) {
            const sanitizedPath = this.sanitizePath(destinationPath);
            if (destinationPath !== sanitizedPath) {
                errors.push({
                    field: 'destination',
                    code: 'PATH_TRAVERSAL_ATTEMPT',
                    message: 'Path traversal attempt detected in destination path'
                });
            }

            // Additional path traversal checks
            const dangerousPatterns = [
                /\.\./,           // Parent directory references
                /~\//,            // Home directory references
                /^\/etc\//,       // System directory access
                /^\/proc\//,      // Process filesystem access
                /^\/sys\//,       // System filesystem access
                /^\/dev\//,       // Device filesystem access
                /\0/,             // Null byte injection
                /%2e%2e/i,        // URL-encoded path traversal
                /%00/,            // URL-encoded null byte
                /\$\{.*\}/,       // Variable expansion attempts
                /`.*`/,           // Command substitution attempts
            ];

            for (const pattern of dangerousPatterns) {
                if (pattern.test(destinationPath)) {
                    errors.push({
                        field: 'destination',
                        code: 'DANGEROUS_PATH_PATTERN',
                        message: 'Destination path contains potentially dangerous patterns'
                    });
                    break;
                }
            }
        }

        // Check if path is absolute and warn about potential security implications
        if (path.isAbsolute(destinationPath)) {
            warnings.push({
                field: 'destination',
                code: 'ABSOLUTE_PATH_WARNING',
                message: 'Using absolute paths may have security implications'
            });
        }

        // Check for write permissions (if path exists)
        try {
            const parentDir = path.dirname(path.resolve(destinationPath));
            fs.accessSync(parentDir, fs.constants.W_OK);
        } catch (permissionError) {
            if (permissionError.code === 'ENOENT') {
                warnings.push({
                    field: 'destination',
                    code: 'PARENT_DIRECTORY_MISSING',
                    message: 'Parent directory does not exist and will need to be created'
                });
            } else if (permissionError.code === 'EACCES') {
                errors.push({
                    field: 'destination',
                    code: 'PERMISSION_DENIED',
                    message: 'Insufficient permissions to write to destination path'
                });
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validates HTTP headers for security compliance
     * @param {Object} headers - Headers object to validate
     * @returns {Object} Validation result
     */
    validateHeaders(headers) {
        const errors = [];
        const warnings = [];

        if (typeof headers !== 'object' || headers === null) {
            errors.push({
                field: 'headers',
                code: 'INVALID_HEADERS',
                message: 'Headers must be a valid object'
            });
            return { isValid: false, errors, warnings };
        }

        // Check for dangerous headers
        const dangerousHeaders = [
            'x-forwarded-for',
            'x-real-ip',
            'authorization', // Should be handled through proper auth mechanisms
            'cookie',
            'x-forwarded-host',
            'host'
        ];

        for (const [key, value] of Object.entries(headers)) {
            if (typeof key !== 'string' || typeof value !== 'string') {
                errors.push({
                    field: 'headers',
                    code: 'INVALID_HEADER_FORMAT',
                    message: 'Header keys and values must be strings'
                });
                continue;
            }

            const lowerKey = key.toLowerCase();
            
            if (dangerousHeaders.includes(lowerKey)) {
                warnings.push({
                    field: 'headers',
                    code: 'POTENTIALLY_DANGEROUS_HEADER',
                    message: `Header '${key}' may have security implications`
                });
            }

            // Check for header injection attempts
            if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) {
                errors.push({
                    field: 'headers',
                    code: 'HEADER_INJECTION_ATTEMPT',
                    message: 'Header injection attempt detected'
                });
            }

            // Check header value length
            if (value.length > 8192) { // 8KB limit
                errors.push({
                    field: 'headers',
                    code: 'HEADER_VALUE_TOO_LONG',
                    message: `Header '${key}' value exceeds maximum length`
                });
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Checks rate limiting for client IP
     * @param {string} clientIp - Client IP address
     * @returns {Object} Rate limit validation result
     */
    checkRateLimit(clientIp) {
        const errors = [];
        const now = Date.now();
        const windowStart = now - this.rateLimiter.windowMs;

        // Clean old requests
        if (this.rateLimiter.requests.has(clientIp)) {
            const requests = this.rateLimiter.requests.get(clientIp)
                .filter(timestamp => timestamp > windowStart);
            this.rateLimiter.requests.set(clientIp, requests);
        }

        // Check current request count
        const currentRequests = this.rateLimiter.requests.get(clientIp) || [];
        
        if (currentRequests.length >= this.securityConfig.rateLimitRequests) {
            errors.push({
                field: 'rateLimit',
                code: 'RATE_LIMIT_EXCEEDED',
                message: `Rate limit exceeded: ${this.securityConfig.rateLimitRequests} requests per minute`
            });
        } else {
            // Record this request
            currentRequests.push(now);
            this.rateLimiter.requests.set(clientIp, currentRequests);
        }

        return {
            isValid: errors.length === 0,
            errors,
            requestCount: currentRequests.length,
            resetTime: windowStart + this.rateLimiter.windowMs
        };
    }

    /**
     * Validates file size against security limits
     * @param {number} contentLength - Content length in bytes
     * @param {string} url - URL for context
     * @throws {DownloadError} When file exceeds size limits
     */
    validateFileSize(contentLength, url) {
        if (contentLength > this.securityConfig.maxFileSize) {
            this.logger.warn('File size exceeds security limit', {
                url,
                contentLength,
                maxFileSize: this.securityConfig.maxFileSize
            });

            throw new DownloadError(
                'FILE_TOO_LARGE',
                `File size ${contentLength} bytes exceeds maximum allowed ${this.securityConfig.maxFileSize} bytes`,
                { 
                    contentLength, 
                    maxFileSize: this.securityConfig.maxFileSize,
                    url 
                }
            );
        }
    }

    /**
     * Sanitizes a download request by removing/fixing dangerous elements
     * @param {Object} request - Request to sanitize
     * @returns {Object} Sanitized request
     */
    sanitizeRequest(request) {
        const sanitized = { ...request };

        // Sanitize destination path
        if (sanitized.destination) {
            sanitized.destination = this.sanitizePath(sanitized.destination);
            
            if (this.securityConfig.sanitizeFilenames) {
                sanitized.destination = this.sanitizeFilename(sanitized.destination);
            }
        }

        // Remove dangerous headers
        if (sanitized.headers) {
            const cleanHeaders = {};
            for (const [key, value] of Object.entries(sanitized.headers)) {
                if (typeof key === 'string' && typeof value === 'string' && 
                    !/[\r\n]/.test(key) && !/[\r\n]/.test(value)) {
                    cleanHeaders[key] = value;
                }
            }
            sanitized.headers = cleanHeaders;
        }

        return sanitized;
    }

    /**
     * Sanitizes a file path to prevent path traversal attacks
     * @param {string} inputPath - Path to sanitize
     * @returns {string} Sanitized path
     */
    sanitizePath(inputPath) {
        if (!inputPath) return inputPath;
        
        // Resolve and normalize the path
        const resolved = path.resolve(path.normalize(inputPath));
        
        // Ensure the path doesn't escape the current working directory
        const cwd = process.cwd();
        if (!resolved.startsWith(cwd)) {
            return path.join(cwd, path.basename(inputPath));
        }
        
        return resolved;
    }

    /**
     * Sanitizes a filename to remove dangerous characters
     * @param {string} filename - Filename to sanitize
     * @returns {string} Sanitized filename
     */
    sanitizeFilename(filename) {
        if (!filename) return filename;
        
        const dir = path.dirname(filename);
        const base = path.basename(filename);
        
        // Remove or replace dangerous characters
        const sanitized = base
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')  // Replace dangerous chars with underscore
            .replace(/^\.+/, '_')                     // Don't allow leading dots
            .replace(/\s+/g, '_')                     // Replace spaces with underscores
            .slice(0, 255);                          // Limit filename length
        
        return path.join(dir, sanitized || 'download');
    }


    /**
     * Checks if hostname is in private network range (IPv4 and IPv6)
     * @param {string} hostname - Hostname to check
     * @returns {boolean} True if private network
     * @private
     */
    isPrivateNetwork(hostname) {
        // First, detect and extract the actual IP address
        const addressInfo = IPv6Utils.detectAddressType(hostname);
        let targetAddress = hostname;

        // Extract IPv6 address from brackets if present
        if (addressInfo.type === 'ipv6-bracketed') {
            targetAddress = addressInfo.address;
        }

        const lowerAddress = targetAddress.toLowerCase();

        // IPv4 private ranges
        const ipv4Patterns = [
            /^10\./,                          // 10.0.0.0/8 (Class A private)
            /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12 (Class B private)
            /^192\.168\./,                   // 192.168.0.0/16 (Class C private)
            /^169\.254\./,                   // 169.254.0.0/16 (Link-local)
            /^127\./,                        // 127.0.0.0/8 (Loopback)
            /^0\./                           // 0.0.0.0/8 (This network)
        ];

        // IPv6 private and special ranges
        const ipv6Patterns = [
            // Private/Local ranges
            /^fc00:/i,                       // fc00::/7 (Unique local unicast)
            /^fd00:/i,                       // fd00::/8 (Unique local unicast - specific)
            /^fe80:/i,                       // fe80::/10 (Link-local unicast)
            /^fec0:/i,                       // fec0::/10 (Site-local - deprecated)
            
            // Loopback and special addresses
            /^::1$/,                         // ::1 (Loopback)
            /^::$/,                          // :: (Unspecified)
            
            // IPv4-mapped and compatible
            /^::ffff:/i,                     // ::ffff:0:0/96 (IPv4-mapped)
            /^2001:0*10:/i,                  // 2001:10::/28 (ORCHID v1)
            /^2001:0*20:/i,                  // 2001:20::/28 (ORCHID v2)
            
            // Documentation and testing
            /^2001:0*db8:/i,                 // 2001:db8::/32 (Documentation)
            
            // Multicast
            /^ff[0-9a-f][0-9a-f]:/i         // ff00::/8 (Multicast)
        ];

        // Check against patterns
        const isPrivateIPv4 = ipv4Patterns.some(pattern => pattern.test(lowerAddress));
        const isPrivateIPv6 = ipv6Patterns.some(pattern => pattern.test(lowerAddress));

        return isPrivateIPv4 || isPrivateIPv6;
    }

    /**
     * Enhanced localhost detection for both IPv4 and IPv6
     * @param {string} hostname - Hostname to check
     * @returns {boolean} True if localhost
     * @private
     */
    isLocalhost(hostname) {
        const addressInfo = IPv6Utils.detectAddressType(hostname);
        let targetAddress = hostname.toLowerCase();

        // Extract IPv6 address from brackets if present
        if (addressInfo.type === 'ipv6-bracketed') {
            targetAddress = addressInfo.address.toLowerCase();
        }

        // Localhost patterns
        const localhostPatterns = [
            // IPv4 localhost
            /^127\.0\.0\.1$/,
            /^localhost$/,
            
            // IPv6 localhost
            /^::1$/,
            /^0000:0000:0000:0000:0000:0000:0000:0001$/,
            
            // Variations of localhost
            /^localhost\.localdomain$/,
            /^ip6-localhost$/,
            /^ip6-loopback$/
        ];

        return localhostPatterns.some(pattern => pattern.test(targetAddress));
    }

    /**
     * Gets current security configuration
     * @returns {Object} Current security configuration
     */
    getSecurityConfig() {
        return { ...this.securityConfig };
    }

    /**
     * Gets rate limiting statistics
     * @returns {Object} Rate limiting statistics
     */
    getRateLimitStats() {
        const now = Date.now();
        const windowStart = now - this.rateLimiter.windowMs;
        
        const stats = {
            totalClients: this.rateLimiter.requests.size,
            activeRequests: 0,
            limitPerMinute: this.securityConfig.rateLimitRequests
        };

        for (const [ip, requests] of this.rateLimiter.requests.entries()) {
            const activeRequests = requests.filter(timestamp => timestamp > windowStart);
            stats.activeRequests += activeRequests.length;
        }

        return stats;
    }
}

module.exports = SecurityService;