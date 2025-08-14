const {expect} = require('chai');
const nget = require('../index.js');

describe('N-Get Fetch API', () => {
    describe('Basic functionality', () => {
        it('should fetch JSON data and parse it automatically', async function() {
            this.timeout(10000);
            
            const response = await nget.fetch('https://httpbin.org/json');
            
            expect(response).to.have.property('status', 200);
            expect(response).to.have.property('ok', true);
            expect(response).to.have.property('data');
            expect(response).to.have.property('text');
            expect(response).to.have.property('headers');
            expect(response).to.have.property('url');
            
            // Should auto-parse JSON
            expect(response.data).to.be.an('object');
            expect(response.data).to.have.property('slideshow');
            
            // Headers should be an object
            expect(response.headers).to.be.an('object');
            expect(response.headers).to.have.property('content-type');
        });

        it('should fetch plain text content', async function() {
            this.timeout(10000);
            
            const response = await nget.fetch('https://httpbin.org/robots.txt');
            
            expect(response.status).to.equal(200);
            expect(response.ok).to.be.true;
            expect(response.data).to.be.a('string');
            expect(response.text).to.be.a('string');
            expect(response.data).to.include('User-agent');
        });

        it('should handle different HTTP status codes', async function() {
            this.timeout(10000);
            
            const response = await nget.fetch('https://httpbin.org/status/404');
            
            expect(response.status).to.equal(404);
            expect(response.ok).to.be.false;
            expect(response.statusText).to.include('NOT FOUND');
        });
    });

    describe('HTTP methods', () => {
        it('should support POST requests with JSON data', async function() {
            this.timeout(10000);
            
            const postData = { name: 'test', value: 123 };
            const response = await nget.fetch('https://httpbin.org/post', {
                method: 'POST',
                body: postData
            });
            
            expect(response.status).to.equal(200);
            expect(response.data).to.have.property('json');
            expect(response.data.json).to.deep.equal(postData);
            expect(response.data.headers).to.have.property('Content-Type', 'application/json');
        });

        it('should support PUT requests', async function() {
            this.timeout(10000);
            
            const putData = { name: 'updated', value: 456 };
            const response = await nget.fetch('https://httpbin.org/put', {
                method: 'PUT',
                body: putData
            });
            
            expect(response.status).to.equal(200);
            expect(response.data).to.have.property('json');
            expect(response.data.json).to.deep.equal(putData);
        });

        it('should support DELETE requests', async function() {
            this.timeout(10000);
            
            const response = await nget.fetch('https://httpbin.org/delete', {
                method: 'DELETE'
            });
            
            expect(response.status).to.equal(200);
            expect(response.data).to.have.property('url');
            expect(response.data.url).to.include('/delete');
        });
    });

    describe('Request options', () => {
        it('should support custom headers', async function() {
            this.timeout(10000);
            
            const customHeaders = {
                'X-Custom-Header': 'test-value',
                'User-Agent': 'N-Get-Test/1.0'
            };
            
            const response = await nget.fetch('https://httpbin.org/headers', {
                headers: customHeaders
            });
            
            expect(response.status).to.equal(200);
            expect(response.data.headers).to.have.property('X-Custom-Header', 'test-value');
            expect(response.data.headers).to.have.property('User-Agent', 'N-Get-Test/1.0');
        });

        it('should support string body content', async function() {
            this.timeout(10000);
            
            const textData = 'This is plain text data';
            const response = await nget.fetch('https://httpbin.org/post', {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain'
                },
                body: textData
            });
            
            expect(response.status).to.equal(200);
            expect(response.data.data).to.equal(textData);
        });
    });

    describe('Error handling', () => {
        it('should throw meaningful errors for invalid URLs', async function() {
            this.timeout(10000);
            
            try {
                await nget.fetch('https://this-domain-definitely-does-not-exist-12345.com');
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).to.include('Request failed');
                expect(error).to.have.property('config');
                expect(error.config).to.have.property('url');
                expect(error.config).to.have.property('method', 'GET');
            }
        });

        it('should handle network timeouts', async function() {
            this.timeout(10000);
            
            try {
                await nget.fetch('https://httpbin.org/delay/5', {
                    timeout: 1000  // 1 second timeout
                });
                expect.fail('Should have thrown a timeout error');
            } catch (error) {
                expect(error.message).to.include('Request failed');
            }
        });
    });

    describe('Configuration integration', () => {
        it('should work with configuration profiles', async function() {
            this.timeout(10000);
            
            const response = await nget.fetch('https://httpbin.org/user-agent', {
                configProfile: 'fetch'
            });
            
            expect(response.status).to.equal(200);
            expect(response.data).to.have.property('user-agent');
            // Should use the configured user agent
            expect(response.data['user-agent']).to.include('N-Get');
        });
    });

    describe('Response format', () => {
        it('should provide both data and text properties', async function() {
            this.timeout(10000);
            
            const response = await nget.fetch('https://httpbin.org/json');
            
            // Data should be parsed JSON object
            expect(response.data).to.be.an('object');
            expect(response.data).to.have.property('slideshow');
            
            // Text should be the raw JSON string
            expect(response.text).to.be.a('string');
            expect(() => JSON.parse(response.text)).to.not.throw();
        });

        it('should handle non-JSON responses gracefully', async function() {
            this.timeout(10000);
            
            const response = await nget.fetch('https://httpbin.org/html');
            
            expect(response.status).to.equal(200);
            expect(response.data).to.be.a('string');
            expect(response.text).to.be.a('string');
            expect(response.data).to.include('<html>');
            expect(response.data).to.equal(response.text);
        });
    });

    describe('Axios compatibility', () => {
        it('should provide axios-like response structure', async function() {
            this.timeout(10000);
            
            const response = await nget.fetch('https://httpbin.org/get');
            
            // Check axios-like properties
            expect(response).to.have.property('data');
            expect(response).to.have.property('status');
            expect(response).to.have.property('statusText');
            expect(response).to.have.property('headers');
            expect(response).to.have.property('config');
            
            // Config should contain request details
            expect(response.config).to.have.property('method', 'GET');
            expect(response.config).to.have.property('url');
            expect(response.config).to.have.property('headers');
        });
    });
});