// The library entry (package.json "main"), not ../index.js — that is the CLI
// entry, which runs the program on require rather than exporting an API.
const nget = require('../lib/index.js');

// Local fixture server (test/fixtures/), started by globalSetup. Replaces
// httpbin.org so the suite does not fail when a third-party host is down.
const ORIGIN = require('./fixtures/origin').readOrigin();


describe('N-Get Fetch API', () => {
    describe('Basic functionality', () => {
        it('should fetch JSON data and parse it automatically', async function() {
            
            const response = await nget.fetch(`${ORIGIN}/json`);
            
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
            
            const response = await nget.fetch(`${ORIGIN}/robots.txt`);
            
            expect(response.status).to.equal(200);
            expect(response.ok).to.be.true;
            expect(response.data).to.be.a('string');
            expect(response.text).to.be.a('string');
            expect(response.data).to.include('User-agent');
        });

        it('should handle different HTTP status codes', async function() {
            
            const response = await nget.fetch(`${ORIGIN}/status/404`);
            
            expect(response.status).to.equal(404);
            expect(response.ok).to.be.false;
            expect(response.statusText).to.include('NOT FOUND');
        });
    });

    describe('HTTP methods', () => {
        it('should support POST requests with JSON data', async function() {
            
            const postData = { name: 'test', value: 123 };
            const response = await nget.fetch(`${ORIGIN}/post`, {
                method: 'POST',
                body: postData
            });
            
            expect(response.status).to.equal(200);
            expect(response.data).to.have.property('json');
            expect(response.data.json).to.deep.equal(postData);
            expect(response.data.headers).to.have.property('Content-Type', 'application/json');
        });

        it('should support PUT requests', async function() {
            
            const putData = { name: 'updated', value: 456 };
            const response = await nget.fetch(`${ORIGIN}/put`, {
                method: 'PUT',
                body: putData
            });
            
            expect(response.status).to.equal(200);
            expect(response.data).to.have.property('json');
            expect(response.data.json).to.deep.equal(putData);
        });

        it('should support DELETE requests', async function() {
            
            const response = await nget.fetch(`${ORIGIN}/delete`, {
                method: 'DELETE'
            });
            
            expect(response.status).to.equal(200);
            expect(response.data).to.have.property('url');
            expect(response.data.url).to.include('/delete');
        });
    });

    describe('Request options', () => {
        it('should support custom headers', async function() {
            
            const customHeaders = {
                'X-Custom-Header': 'test-value',
                'User-Agent': 'N-Get-Test/1.0'
            };
            
            const response = await nget.fetch(`${ORIGIN}/headers`, {
                headers: customHeaders
            });
            
            expect(response.status).to.equal(200);
            expect(response.data.headers).to.have.property('X-Custom-Header', 'test-value');
            expect(response.data.headers).to.have.property('User-Agent', 'N-Get-Test/1.0');
        });

        it('should support string body content', async function() {
            
            const textData = 'This is plain text data';
            const response = await nget.fetch(`${ORIGIN}/post`, {
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
            
            try {
                await nget.fetch(`${ORIGIN}/delay/5`, {
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
            
            const response = await nget.fetch(`${ORIGIN}/user-agent`, {
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
            
            const response = await nget.fetch(`${ORIGIN}/json`);
            
            // Data should be parsed JSON object
            expect(response.data).to.be.an('object');
            expect(response.data).to.have.property('slideshow');
            
            // Text should be the raw JSON string
            expect(response.text).to.be.a('string');
            expect(() => JSON.parse(response.text)).to.not.throw();
        });

        it('should handle non-JSON responses gracefully', async function() {
            
            const response = await nget.fetch(`${ORIGIN}/html`);
            
            expect(response.status).to.equal(200);
            expect(response.data).to.be.a('string');
            expect(response.text).to.be.a('string');
            expect(response.data).to.include('<html>');
            expect(response.data).to.equal(response.text);
        });
    });

    describe('Axios compatibility', () => {
        it('should provide axios-like response structure', async function() {
            
            const response = await nget.fetch(`${ORIGIN}/get`);
            
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