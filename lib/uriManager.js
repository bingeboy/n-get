const { URL } = require('url');
const colors = require('colors');

module.exports = function requestUri(reqUrl) {
    try {
        // Try to parse as complete URL first
        const url = new URL(reqUrl);
        
        // Check if it's a valid protocol (not localhost:, file:, etc.)
        const validProtocols = ['http:', 'https:', 'ftp:', 'ftps:', 'sftp:'];
        if (validProtocols.includes(url.protocol)) {
            return url.toString();
        } else {
            // Invalid protocol, treat as missing protocol
            throw new Error('Invalid protocol');
        }
    } catch (err) {
        // If parsing fails, assume it's missing protocol
        try {
            const url = new URL(`http://${reqUrl}`);
            console.log("No Protocol Provided, Defaulting to:".red, url.protocol);
            return url.toString();
        } catch (err2) {
            throw new Error(`Invalid URL: ${reqUrl}`);
        }
    }
};
