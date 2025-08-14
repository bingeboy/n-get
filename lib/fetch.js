/**
 * @fileoverview Fetch API for n-get - axios-like programmatic HTTP client
 * Provides a simple fetch() function that returns full response objects
 * @module fetch
 */

// Use Node.js built-in fetch (available in Node 18+)
const ConfigManager = require('./config/ConfigManager');
const {getHttpAgent} = require('./downloadPipeline');

// Initialize configuration
let configManager;
try {
    configManager = new ConfigManager({
        logger: { info: () => {}, debug: () => {}, warn: () => {}, error: console.error }
    });
} catch (error) {
    // Fallback if config fails to load
    configManager = null;
}

/**
 * Parse response content based on Content-Type header
 * @param {Response} response - Fetch response object
 * @returns {Promise<any>} Parsed content (JSON object or text)
 */
async function parseResponseData(response) {
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    
    // Try to parse as JSON if content-type suggests it or if it looks like JSON
    if (contentType.includes('application/json') || 
        contentType.includes('text/json') ||
        (text.trim().startsWith('{') || text.trim().startsWith('['))) {
        try {
            return JSON.parse(text);
        } catch {
            // If JSON parsing fails, return as text
            return text;
        }
    }
    
    return text;
}

/**
 * Convert Headers object to plain object
 * @param {Headers} headers - Fetch Headers object
 * @returns {Object} Plain object with header key-value pairs
 */
function headersToObject(headers) {
    const obj = {};
    for (const [key, value] of headers.entries()) {
        obj[key] = value;
    }
    return obj;
}

/**
 * Fetch function - axios-like HTTP client
 * @param {string} url - URL to request
 * @param {Object} [options={}] - Request options
 * @param {string} [options.method='GET'] - HTTP method
 * @param {Object} [options.headers={}] - Request headers
 * @param {string|Object} [options.body] - Request body
 * @param {number} [options.timeout] - Request timeout in milliseconds
 * @param {string} [options.configProfile] - n-get configuration profile to use
 * @returns {Promise<Object>} Response object with data, status, headers, etc.
 */
async function ngetFetch(url, options = {}) {
    const {
        method = 'GET',
        headers = {},
        body,
        timeout,
        configProfile
    } = options;

    // Apply configuration profile if specified
    if (configProfile && configManager) {
        try {
            await configManager.applyProfile(configProfile);
        } catch (error) {
            // Continue if profile application fails
        }
    }

    // Get timeout from config or options
    const requestTimeout = timeout || 
        (configManager ? configManager.get('http.timeout', 30000) : 30000);

    // Build fetch options
    const fetchOptions = {
        method: method.toUpperCase(),
        headers: {
            'User-Agent': configManager ? 
                configManager.get('http.userAgent', 'N-Get-Enterprise/2.0') : 
                'N-Get-Enterprise/2.0',
            ...headers
        },
        agent: getHttpAgent ? getHttpAgent(url) : undefined,
        timeout: requestTimeout
    };

    // Add body for non-GET requests
    if (body && method.toUpperCase() !== 'GET') {
        if (typeof body === 'object' && !Buffer.isBuffer(body)) {
            fetchOptions.body = JSON.stringify(body);
            fetchOptions.headers['Content-Type'] = fetchOptions.headers['Content-Type'] || 'application/json';
        } else {
            fetchOptions.body = body;
        }
    }

    try {
        const response = await fetch(url, fetchOptions);
        
        // Parse response data
        const data = await parseResponseData(response);
        const text = typeof data === 'string' ? data : JSON.stringify(data);
        
        // Build axios-like response object
        return {
            data,
            text,
            status: response.status,
            statusText: response.statusText,
            headers: headersToObject(response.headers),
            url: response.url,
            ok: response.ok,
            // Additional n-get specific fields
            config: {
                method: fetchOptions.method,
                url,
                headers: fetchOptions.headers,
                timeout: requestTimeout
            }
        };
    } catch (error) {
        // Enhance error with request details
        const enhancedError = new Error(`Request failed: ${error.message}`);
        enhancedError.code = error.code || 'REQUEST_FAILED';
        enhancedError.config = {
            method: fetchOptions.method,
            url,
            headers: fetchOptions.headers,
            timeout: requestTimeout
        };
        enhancedError.request = { url, method: fetchOptions.method };
        
        throw enhancedError;
    }
}

module.exports = ngetFetch;