/**
 * @fileoverview Enterprise-grade error handling for n-get downloads
 * Provides structured error codes, user-friendly messages, and help URLs
 * @module DownloadError
 */

/**
 * Comprehensive error class for download operations with enterprise features
 * Includes structured error codes, user-friendly messages, and support URLs
 */
class DownloadError extends Error {
    /**
     * Creates a new DownloadError with structured information
     * @param {string} code - Machine-readable error code
     * @param {string} message - Technical error message for logging
     * @param {Object} [details={}] - Additional error context and metadata
     * @param {string} [userMessage=null] - User-friendly error message
     */
    constructor(code, message, details = {}, userMessage = null) {
        super(message);
        this.name = 'DownloadError';
        this.code = code;
        this.details = details;
        this.userMessage = userMessage || this.generateUserMessage();
        this.timestamp = new Date().toISOString();
        this.helpUrl = `https://github.com/bingeboy/n-get/wiki/error-codes#${code.toLowerCase()}`;
        
        // Maintain proper stack trace for debugging
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, DownloadError);
        }
    }

    /**
     * Generates user-friendly error messages based on error codes
     * @returns {string} Human-readable error message with actionable guidance
     */
    generateUserMessage() {
        const messages = {
            // Network and connectivity errors
            'NETWORK_TIMEOUT': 'The download timed out. Check your internet connection and try again.',
            'NETWORK_UNREACHABLE': 'The server could not be reached. Verify the URL and your network connection.',
            'DNS_RESOLUTION_FAILED': 'Could not resolve the domain name. Check the URL and DNS settings.',
            'CONNECTION_REFUSED': 'The server refused the connection. The service may be down or blocking requests.',
            'SSL_CERTIFICATE_ERROR': 'SSL certificate validation failed. The connection may not be secure.',
            
            // URL and request validation errors
            'INVALID_URL': 'The provided URL is invalid. Please verify the URL format and try again.',
            'MALFORMED_URL': 'The URL format is incorrect. Ensure it includes the protocol (http:// or https://).',
            'UNSUPPORTED_PROTOCOL': 'The URL protocol is not supported. Use HTTP, HTTPS, or SFTP URLs.',
            'INVALID_PROTOCOL': 'The protocol in the URL is not allowed by security policy.',
            
            // File system and storage errors
            'INSUFFICIENT_SPACE': 'Not enough disk space available. Free up space and try again.',
            'PERMISSION_DENIED': 'Permission denied accessing the file or directory. Check file permissions.',
            'PATH_NOT_FOUND': 'The destination path does not exist. Create the directory or check the path.',
            'PATH_TRAVERSAL_ATTEMPT': 'Invalid file path detected. Use safe, relative paths only.',
            'FILE_ALREADY_EXISTS': 'A file with this name already exists. Use --force to overwrite.',
            
            // Server response errors
            'HTTP_404': 'The requested file was not found on the server (404 error).',
            'HTTP_403': 'Access to the file is forbidden (403 error). Check authentication credentials.',
            'HTTP_401': 'Authentication required to access this file (401 error).',
            'HTTP_500': 'The server encountered an internal error (500 error). Try again later.',
            'HTTP_503': 'The server is temporarily unavailable (503 error). Try again later.',
            'INVALID_RANGE': 'The server does not support resume for this file. Download will restart.',
            
            // File validation and integrity errors
            'FILE_TOO_LARGE': 'File exceeds the maximum allowed size limit.',
            'FILE_CORRUPTED': 'The downloaded file appears to be corrupted. Try downloading again.',
            'CHECKSUM_MISMATCH': 'File integrity check failed. The download may be incomplete or corrupted.',
            'CONTENT_TYPE_MISMATCH': 'The file type does not match what was expected.',
            
            // Authentication and security errors
            'AUTHENTICATION_FAILED': 'Authentication failed. Check your credentials and try again.',
            'SSH_KEY_ERROR': 'SSH key authentication failed. Verify the key path and permissions.',
            'SSH_CONNECTION_FAILED': 'Could not establish SSH connection. Check credentials and network.',
            'CREDENTIALS_REQUIRED': 'This download requires authentication credentials.',
            'LOCAL_ACCESS_DENIED': 'Access to local/private network addresses is not allowed for security.',
            
            // Resume and partial download errors
            'RESUME_NOT_SUPPORTED': 'The server does not support resuming downloads for this file.',
            'RESUME_FAILED': 'Could not resume the download. The file may have changed on the server.',
            'PARTIAL_CONTENT_ERROR': 'Error processing partial content. The download will restart.',
            'METADATA_CORRUPTED': 'Resume metadata is corrupted. The download will restart.',
            
            // Concurrency and rate limiting
            'TOO_MANY_REQUESTS': 'Too many requests to the server. Retrying with delays.',
            'RATE_LIMITED': 'Download rate limited by the server. Reducing request frequency.',
            'MAX_CONCURRENT_EXCEEDED': 'Too many concurrent downloads. Some downloads will be queued.',
            'DOWNLOAD_QUEUE_FULL': 'Download queue is full. Please wait for current downloads to complete.',
            
            // Configuration and system errors
            'CONFIGURATION_ERROR': 'Invalid configuration detected. Check your settings.',
            'SYSTEM_ERROR': 'A system error occurred. Check logs for details.',
            'OUT_OF_MEMORY': 'Insufficient memory to complete the download. Try smaller files or increase memory.',
            'TEMP_DIR_ERROR': 'Could not access temporary directory. Check permissions and disk space.',
            
            // Retry and recovery errors
            'MAX_RETRIES_EXCEEDED': 'Download failed after maximum retry attempts. Check network and server status.',
            'DOWNLOAD_FAILED_AFTER_RETRIES': 'All retry attempts failed. The file may be temporarily unavailable.',
            'RECOVERY_FAILED': 'Could not recover from the download error. Manual intervention required.',
            
            // SFTP specific errors
            'SFTP_CONNECTION_FAILED': 'SFTP connection failed. Check server address, credentials, and network.',
            'SFTP_AUTH_FAILED': 'SFTP authentication failed. Verify username, password, or SSH key.',
            'SFTP_FILE_NOT_FOUND': 'File not found on SFTP server. Check the remote path.',
            'SFTP_PERMISSION_DENIED': 'Permission denied on SFTP server. Check file and directory permissions.',
            'SFTP_HOST_KEY_ERROR': 'SFTP host key verification failed. The server identity cannot be verified.'
        };

        return messages[this.code] || 'An unexpected error occurred during download. Check logs for details.';
    }

    /**
     * Converts error to JSON format for logging and API responses
     * @returns {Object} Structured error object
     */
    toJSON() {
        return {
            error: {
                code: this.code,
                message: this.message,
                userMessage: this.userMessage,
                details: this.details,
                timestamp: this.timestamp,
                helpUrl: this.helpUrl,
                stack: this.stack
            }
        };
    }

    /**
     * Creates a network-related error
     * @param {string} originalError - Original error message
     * @param {string} url - URL that failed
     * @param {Object} [details={}] - Additional context
     * @returns {DownloadError} Network error instance
     */
    static networkError(originalError, url, details = {}) {
        let code = 'NETWORK_ERROR';
        
        if (originalError.includes('timeout') || originalError.includes('ETIMEDOUT')) {
            code = 'NETWORK_TIMEOUT';
        } else if (originalError.includes('ENOTFOUND') || originalError.includes('getaddrinfo')) {
            code = 'DNS_RESOLUTION_FAILED';
        } else if (originalError.includes('ECONNREFUSED')) {
            code = 'CONNECTION_REFUSED';
        } else if (originalError.includes('ECONNRESET') || originalError.includes('EPIPE')) {
            code = 'NETWORK_UNREACHABLE';
        }

        return new DownloadError(
            code,
            `Network error for ${url}: ${originalError}`,
            { originalError, url, ...details }
        );
    }

    /**
     * Creates an HTTP response error
     * @param {number} statusCode - HTTP status code
     * @param {string} statusText - HTTP status text
     * @param {string} url - URL that returned the error
     * @param {Object} [details={}] - Additional context
     * @returns {DownloadError} HTTP error instance
     */
    static httpError(statusCode, statusText, url, details = {}) {
        const code = `HTTP_${statusCode}`;
        
        return new DownloadError(
            code,
            `HTTP ${statusCode}: ${statusText}`,
            { statusCode, statusText, url, ...details }
        );
    }

    /**
     * Creates a file system error
     * @param {string} operation - File operation that failed
     * @param {string} path - File path involved
     * @param {string} originalError - Original error message
     * @param {Object} [details={}] - Additional context
     * @returns {DownloadError} File system error instance
     */
    static fileSystemError(operation, path, originalError, details = {}) {
        let code = 'FILE_SYSTEM_ERROR';
        
        if (originalError.includes('ENOSPC')) {
            code = 'INSUFFICIENT_SPACE';
        } else if (originalError.includes('EACCES') || originalError.includes('EPERM')) {
            code = 'PERMISSION_DENIED';
        } else if (originalError.includes('ENOENT')) {
            code = 'PATH_NOT_FOUND';
        } else if (originalError.includes('EEXIST')) {
            code = 'FILE_ALREADY_EXISTS';
        }

        return new DownloadError(
            code,
            `File system error during ${operation} on ${path}: ${originalError}`,
            { operation, path, originalError, ...details }
        );
    }

    /**
     * Creates a validation error
     * @param {string} field - Field that failed validation
     * @param {string} value - Value that was invalid
     * @param {string} reason - Reason for validation failure
     * @param {Object} [details={}] - Additional context
     * @returns {DownloadError} Validation error instance
     */
    static validationError(field, value, reason, details = {}) {
        let code = 'VALIDATION_ERROR';
        
        if (field === 'url') {
            if (reason.includes('protocol')) {
                code = 'INVALID_PROTOCOL';
            } else if (reason.includes('format')) {
                code = 'MALFORMED_URL';
            } else {
                code = 'INVALID_URL';
            }
        } else if (field === 'path' && reason.includes('traversal')) {
            code = 'PATH_TRAVERSAL_ATTEMPT';
        }

        return new DownloadError(
            code,
            `Validation failed for ${field}: ${reason}`,
            { field, value, reason, ...details }
        );
    }

    /**
     * Creates an SFTP-specific error
     * @param {string} operation - SFTP operation that failed
     * @param {string} originalError - Original SFTP error
     * @param {Object} [details={}] - Additional context
     * @returns {DownloadError} SFTP error instance
     */
    static sftpError(operation, originalError, details = {}) {
        let code = 'SFTP_ERROR';
        
        if (originalError.includes('Authentication failed') || originalError.includes('auth')) {
            code = 'SFTP_AUTH_FAILED';
        } else if (originalError.includes('connect') || originalError.includes('ECONNREFUSED')) {
            code = 'SFTP_CONNECTION_FAILED';
        } else if (originalError.includes('No such file') || originalError.includes('ENOENT')) {
            code = 'SFTP_FILE_NOT_FOUND';
        } else if (originalError.includes('Permission denied') || originalError.includes('EACCES')) {
            code = 'SFTP_PERMISSION_DENIED';
        } else if (originalError.includes('Host key')) {
            code = 'SFTP_HOST_KEY_ERROR';
        }

        return new DownloadError(
            code,
            `SFTP ${operation} failed: ${originalError}`,
            { operation, originalError, ...details }
        );
    }
}

module.exports = DownloadError;