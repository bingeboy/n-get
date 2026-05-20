/**
 * @fileoverview Fetch API for n-get - axios-like programmatic HTTP client
 * Provides a simple fetch() function that returns full response objects
 * @module fetch
 */

// Use Node.js built-in fetch (available in Node 18+)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ConfigManager = require('./config/ConfigManager');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getHttpAgent } = require('./downloader');

// Initialize configuration
let configManager: any;
try {
    configManager = new ConfigManager({
        logger: { info: () => {}, debug: () => {}, warn: () => {}, error: console.error }
    });
} catch (error) {
    // Fallback if config fails to load
    configManager = null;
}

interface FetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Record<string, unknown> | Buffer;
    timeout?: number;
    configProfile?: string;
}

interface FetchResponse {
    data: unknown;
    text: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    url: string;
    ok: boolean;
    latencyMs: number;
    config: {
        method: string;
        url: string;
        headers: Record<string, string>;
        timeout: number;
    };
}

/**
 * Parse response content based on Content-Type header
 * @param response - Fetch response object
 * @returns Parsed content (JSON object or text)
 */
async function parseResponseData(response: Response): Promise<unknown> {
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
 * @param headers - Fetch Headers object
 * @returns Plain object with header key-value pairs
 */
function headersToObject(headers: Headers): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [key, value] of headers.entries()) {
        obj[key] = value;
    }
    return obj;
}

/**
 * Fetch function - axios-like HTTP client
 * @param url - URL to request
 * @param options - Request options
 * @returns Response object with data, status, headers, etc.
 */
async function ngetFetch(url: string, options: FetchOptions = {}): Promise<FetchResponse> {
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
    const requestTimeout: number = timeout ||
        (configManager ? configManager.get('http.timeout', 30000) : 30000);

    // Build fetch options
    const fetchOptions: any = {
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

    const startTime = Date.now();

    try {
        const response = await fetch(url, fetchOptions);
        const latencyMs = Date.now() - startTime;

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
            latencyMs,
            // Additional n-get specific fields
            config: {
                method: fetchOptions.method,
                url,
                headers: fetchOptions.headers,
                timeout: requestTimeout
            }
        };
    } catch (error: unknown) {
        const latencyMs = Date.now() - startTime;
        const err = error as Error & { code?: string };
        // Enhance error with request details
        const enhancedError: any = new Error(`Request failed: ${err.message}`);
        enhancedError.code = err.code || 'REQUEST_FAILED';
        enhancedError.latencyMs = latencyMs;
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

export = ngetFetch;
