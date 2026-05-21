'use strict';

const OpenAPIService = require('../lib/services/OpenAPIService');

function makeService(opts = {}) {
    return new OpenAPIService(opts);
}

describe('OpenAPIService', () => {

    describe('constructor', () => {
        it('uses console as default logger', () => {
            const svc = makeService();
            expect(svc.logger).toBe(console);
        });

        it('accepts a custom logger', () => {
            const logger = { info: () => {} };
            const svc = makeService({ logger });
            expect(svc.logger).toBe(logger);
        });

        it('sets version from package.json', () => {
            const svc = makeService();
            expect(typeof svc.version).toBe('string');
            expect(svc.version.length).toBeGreaterThan(0);
        });

        it('stores configManager reference', () => {
            const cm = { get: () => {} };
            const svc = makeService({ configManager: cm });
            expect(svc.configManager).toBe(cm);
        });
    });

    describe('generateSpec', () => {
        it('returns object with required OpenAPI top-level fields', () => {
            const svc = makeService();
            const spec = svc.generateSpec();
            expect(spec.openapi).toBe('3.0.3');
            expect(spec.info).toBeDefined();
            expect(spec.paths).toBeDefined();
            expect(spec.tags).toBeDefined();
            expect(spec.externalDocs).toBeDefined();
        });

        it('includes components section by default (includeSchemas=true)', () => {
            const svc = makeService();
            const spec = svc.generateSpec();
            expect(spec.components).toBeDefined();
            expect(spec.components.schemas).toBeDefined();
        });

        it('excludes components section when includeSchemas=false', () => {
            const svc = makeService();
            const spec = svc.generateSpec({ includeSchemas: false });
            expect(spec.components).toBeUndefined();
        });

        it('includes operation examples by default', () => {
            const svc = makeService();
            const spec = svc.generateSpec();
            expect(spec.paths['/download'].post.requestBody.content['application/json'].examples).toBeDefined();
        });

        it('excludes operation examples when includeExamples=false', () => {
            const svc = makeService();
            const spec = svc.generateSpec({ includeExamples: false });
            expect(spec.paths['/download'].post.requestBody.content['application/json'].examples).toBeUndefined();
        });
    });

    describe('generateInfoSection', () => {
        it('returns correct title', () => {
            const info = makeService().generateInfoSection();
            expect(info.title).toBe('N-Get Enterprise Download API');
        });

        it('returns a version string', () => {
            const info = makeService().generateInfoSection();
            expect(typeof info.version).toBe('string');
            expect(info.version.length).toBeGreaterThan(0);
        });

        it('includes AI-native in description', () => {
            const info = makeService().generateInfoSection();
            expect(info.description).toContain('AI-native');
        });

        it('includes contact object', () => {
            const info = makeService().generateInfoSection();
            expect(info.contact).toBeDefined();
            expect(info.contact.name).toBeDefined();
        });

        it('includes license object', () => {
            const info = makeService().generateInfoSection();
            expect(info.license).toBeDefined();
            expect(info.license.name).toBeDefined();
        });

        it('includes x-api-id extension field', () => {
            const info = makeService().generateInfoSection();
            expect(info['x-api-id']).toBe('n-get-enterprise');
        });

        it('includes x-audience extension field', () => {
            const info = makeService().generateInfoSection();
            expect(info['x-audience']).toBe('ai-agents');
        });
    });

    describe('generateServersSection', () => {
        it('returns an array', () => {
            const servers = makeService().generateServersSection();
            expect(Array.isArray(servers)).toBe(true);
            expect(servers.length).toBeGreaterThan(0);
        });

        it('includes CLI server entry', () => {
            const servers = makeService().generateServersSection();
            const cli = servers.find(s => s.url === 'cli://n-get');
            expect(cli).toBeDefined();
            expect(cli.variables).toBeDefined();
        });

        it('includes MCP server entry', () => {
            const servers = makeService().generateServersSection();
            const mcp = servers.find(s => s.url === 'mcp://n-get-server');
            expect(mcp).toBeDefined();
        });
    });

    describe('generatePathsSection', () => {
        it('includes /download POST', () => {
            const paths = makeService().generatePathsSection(false);
            expect(paths['/download']).toBeDefined();
            expect(paths['/download'].post).toBeDefined();
            expect(paths['/download'].post.operationId).toBe('downloadFiles');
        });

        it('includes /download/batch POST', () => {
            const paths = makeService().generatePathsSection(false);
            expect(paths['/download/batch'].post).toBeDefined();
        });

        it('includes /download/resume POST', () => {
            const paths = makeService().generatePathsSection(false);
            expect(paths['/download/resume'].post).toBeDefined();
        });

        it('includes /download/recursive POST', () => {
            const paths = makeService().generatePathsSection(false);
            expect(paths['/download/recursive'].post).toBeDefined();
        });

        it('includes /config GET and PUT', () => {
            const paths = makeService().generatePathsSection(false);
            expect(paths['/config'].get).toBeDefined();
            expect(paths['/config'].put).toBeDefined();
        });

        it('includes /config/profiles GET', () => {
            const paths = makeService().generatePathsSection(false);
            expect(paths['/config/profiles'].get).toBeDefined();
        });

        it('includes /config/profiles/{profileName} POST', () => {
            const paths = makeService().generatePathsSection(false);
            expect(paths['/config/profiles/{profileName}'].post).toBeDefined();
        });

        it('includes /capabilities GET', () => {
            const paths = makeService().generatePathsSection(false);
            expect(paths['/capabilities'].get).toBeDefined();
        });

        it('includes /history GET', () => {
            const paths = makeService().generatePathsSection(false);
            expect(paths['/history'].get).toBeDefined();
        });

        it('adds examples to /download and /download/batch when includeExamples=true', () => {
            const paths = makeService().generatePathsSection(true);
            expect(paths['/download'].post.requestBody.content['application/json'].examples).toBeDefined();
            expect(paths['/download/batch'].post.requestBody.content['application/json'].examples).toBeDefined();
        });

        it('does not add examples when includeExamples=false', () => {
            const paths = makeService().generatePathsSection(false);
            expect(paths['/download'].post.requestBody.content['application/json'].examples).toBeUndefined();
        });

        it('each path operation has responses defined', () => {
            const paths = makeService().generatePathsSection(false);
            for (const pathItem of Object.values(paths)) {
                for (const [method, op] of Object.entries(pathItem)) {
                    if (['get', 'post', 'put'].includes(method)) {
                        expect(op.responses).toBeDefined();
                    }
                }
            }
        });
    });

    describe('generateComponentsSection', () => {
        it('returns schemas map', () => {
            const components = makeService().generateComponentsSection();
            expect(components.schemas).toBeDefined();
        });

        it('includes DownloadRequest schema with required urls', () => {
            const components = makeService().generateComponentsSection();
            expect(components.schemas.DownloadRequest).toBeDefined();
            expect(components.schemas.DownloadRequest.required).toContain('urls');
        });

        it('includes BatchDownloadRequest schema', () => {
            const components = makeService().generateComponentsSection();
            expect(components.schemas.BatchDownloadRequest).toBeDefined();
        });

        it('includes RecursiveDownloadRequest schema', () => {
            const components = makeService().generateComponentsSection();
            expect(components.schemas.RecursiveDownloadRequest).toBeDefined();
        });

        it('includes DownloadResponse schema', () => {
            const components = makeService().generateComponentsSection();
            expect(components.schemas.DownloadResponse).toBeDefined();
        });

        it('includes DownloadResult schema', () => {
            const components = makeService().generateComponentsSection();
            expect(components.schemas.DownloadResult).toBeDefined();
        });

        it('includes ErrorResponse schema', () => {
            const components = makeService().generateComponentsSection();
            expect(components.schemas.ErrorResponse).toBeDefined();
        });

        it('includes parameters section with OutputFormat, SessionId, RequestId', () => {
            const components = makeService().generateComponentsSection();
            expect(components.parameters.OutputFormat).toBeDefined();
            expect(components.parameters.SessionId).toBeDefined();
            expect(components.parameters.RequestId).toBeDefined();
        });
    });

    describe('generateTagsSection', () => {
        it('returns a non-empty array', () => {
            const tags = makeService().generateTagsSection();
            expect(Array.isArray(tags)).toBe(true);
            expect(tags.length).toBeGreaterThan(0);
        });

        it('includes Downloads tag', () => {
            const tags = makeService().generateTagsSection();
            expect(tags.some(t => t.name === 'Downloads')).toBe(true);
        });

        it('includes AI Integration tag', () => {
            const tags = makeService().generateTagsSection();
            expect(tags.some(t => t.name === 'AI Integration')).toBe(true);
        });

        it('includes Configuration tag', () => {
            const tags = makeService().generateTagsSection();
            expect(tags.some(t => t.name === 'Configuration')).toBe(true);
        });

        it('each tag has name and description', () => {
            const tags = makeService().generateTagsSection();
            for (const tag of tags) {
                expect(tag.name).toBeDefined();
                expect(tag.description).toBeDefined();
            }
        });
    });

    describe('generateExternalDocsSection', () => {
        it('returns object with description and url', () => {
            const docs = makeService().generateExternalDocsSection();
            expect(docs.description).toBeDefined();
            expect(docs.url).toBeDefined();
        });
    });

    describe('formatOutput', () => {
        it('serializes to JSON when format=json', () => {
            const svc = makeService();
            const output = svc.formatOutput({ openapi: '3.0.3' }, 'json');
            expect(() => JSON.parse(output)).not.toThrow();
            expect(JSON.parse(output).openapi).toBe('3.0.3');
        });

        it('serializes to YAML when format=yaml', () => {
            const svc = makeService();
            const output = svc.formatOutput({ openapi: '3.0.3', info: { title: 'T', version: '1' } }, 'yaml');
            expect(output).toContain('openapi:');
            expect(output).toContain('3.0.3');
        });

        it('falls back to JSON for unknown format', () => {
            const svc = makeService();
            const output = svc.formatOutput({ openapi: '3.0.3' }, 'xml');
            expect(() => JSON.parse(output)).not.toThrow();
        });

        it('handles uppercase format string (case-insensitive)', () => {
            const svc = makeService();
            const output = svc.formatOutput({ openapi: '3.0.3' }, 'JSON');
            expect(() => JSON.parse(output)).not.toThrow();
        });
    });

    describe('generateAndFormat', () => {
        it('returns valid JSON string by default', () => {
            const svc = makeService();
            const output = svc.generateAndFormat();
            expect(() => JSON.parse(output)).not.toThrow();
            const parsed = JSON.parse(output);
            expect(parsed.openapi).toBe('3.0.3');
        });

        it('returns YAML when format=yaml', () => {
            const svc = makeService();
            const output = svc.generateAndFormat({ format: 'yaml' });
            expect(output).toContain('openapi:');
            expect(typeof output).toBe('string');
        });

        it('respects includeSchemas=false option', () => {
            const svc = makeService();
            const output = svc.generateAndFormat({ includeSchemas: false });
            const parsed = JSON.parse(output);
            expect(parsed.components).toBeUndefined();
        });
    });

    describe('validateSpec', () => {
        it('returns valid=true for a properly generated spec', () => {
            const svc = makeService();
            const spec = svc.generateSpec();
            const result = svc.validateSpec(spec);
            expect(result.valid).toBe(true);
            expect(result.errors.length).toBe(0);
        });

        it('errors when openapi field is missing', () => {
            const svc = makeService();
            const spec = {
                info: { title: 'T', version: '1' },
                paths: { '/x': { get: { operationId: 'getX', responses: { '200': {} } } } },
            };
            const result = svc.validateSpec(spec);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('openapi'))).toBe(true);
        });

        it('errors when info fields are missing', () => {
            const svc = makeService();
            const spec = {
                openapi: '3.0.3',
                paths: { '/x': { get: { operationId: 'getX', responses: { '200': {} } } } },
            };
            const result = svc.validateSpec(spec);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('info'))).toBe(true);
        });

        it('errors when no paths are defined', () => {
            const svc = makeService();
            const spec = { openapi: '3.0.3', info: { title: 'T', version: '1' }, paths: {} };
            const result = svc.validateSpec(spec);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('paths'))).toBe(true);
        });

        it('warns when operationId is missing from an operation', () => {
            const svc = makeService();
            const spec = {
                openapi: '3.0.3',
                info: { title: 'T', version: '1' },
                paths: { '/x': { get: { responses: { '200': { description: 'ok' } } } } },
            };
            const result = svc.validateSpec(spec);
            expect(result.warnings.some(w => w.includes('operationId'))).toBe(true);
        });

        it('errors when responses is missing from an operation', () => {
            const svc = makeService();
            const spec = {
                openapi: '3.0.3',
                info: { title: 'T', version: '1' },
                paths: { '/x': { get: { operationId: 'getX' } } },
            };
            const result = svc.validateSpec(spec);
            expect(result.errors.some(e => e.includes('responses'))).toBe(true);
        });

        it('returns summary with counts', () => {
            const svc = makeService();
            const spec = svc.generateSpec();
            const result = svc.validateSpec(spec);
            expect(result.summary.paths).toBeGreaterThan(0);
            expect(result.summary.operations).toBeGreaterThan(0);
            expect(result.summary.schemas).toBeGreaterThan(0);
        });

        it('handles missing paths gracefully', () => {
            const svc = makeService();
            const spec = { openapi: '3.0.3', info: { title: 'T', version: '1' } };
            const result = svc.validateSpec(spec);
            expect(result.summary.paths).toBe(0);
        });
    });

    describe('countOperations', () => {
        it('counts HTTP method operations correctly', () => {
            const svc = makeService();
            const paths = {
                '/a': { get: {}, post: {} },
                '/b': { put: {} },
            };
            expect(svc.countOperations(paths)).toBe(3);
        });

        it('ignores non-HTTP-method keys like parameters and summary', () => {
            const svc = makeService();
            const paths = { '/a': { get: {}, parameters: [], summary: 'whatever' } };
            expect(svc.countOperations(paths)).toBe(1);
        });

        it('returns 0 for empty paths', () => {
            expect(makeService().countOperations({})).toBe(0);
        });

        it('counts all 8 HTTP methods', () => {
            const svc = makeService();
            const paths = {
                '/x': { get: {}, post: {}, put: {}, delete: {}, patch: {}, head: {}, options: {}, trace: {} },
            };
            expect(svc.countOperations(paths)).toBe(8);
        });
    });
});
