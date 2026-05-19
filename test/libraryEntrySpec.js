'use strict';
/**
 * @fileoverview Tests for the n-get programmatic entry point (lib/index.js).
 *
 * Confirms that require('n-get') returns the agent-facing object with all
 * five exports backed by CapabilitiesService.
 */


describe('lib/index — programmatic entry point', () => {

    let nget;
    before(() => {
        nget = require('../lib/index');
    });

    it('exports the five agent-facing keys', () => {
        const expected = ['fetch', 'capabilities', 'openapi', 'instructions', 'version'];
        expected.forEach(key => {
            expect(nget, `missing key: ${key}`).to.have.property(key);
        });
    });

    it('fetch is a function', () => {
        expect(nget.fetch).to.be.a('function');
    });

    it('version is a non-empty string', () => {
        expect(nget.version).to.be.a('string').and.not.empty;
    });

    it('capabilities is an object with tool.name === "n-get"', () => {
        expect(nget.capabilities).to.be.an('object');
        expect(nget.capabilities).to.have.nested.property('tool.name', 'n-get');
    });

    it('capabilities.tool.version matches the top-level version', () => {
        expect(nget.capabilities.tool.version).to.equal(nget.version);
    });

    it('capabilities contains the discovery section', () => {
        expect(nget.capabilities).to.have.property('discovery');
        expect(nget.capabilities.discovery).to.have.property('ndjsonEvents').that.is.an('array');
    });

    it('openapi is a valid-looking OpenAPI 3.0.3 doc', () => {
        expect(nget.openapi).to.be.an('object');
        expect(nget.openapi).to.have.property('openapi', '3.0.3');
        expect(nget.openapi).to.have.property('info');
        expect(nget.openapi).to.have.property('paths');
    });

    it('instructions is a non-empty Markdown string', () => {
        expect(nget.instructions).to.be.a('string').and.not.empty;
        expect(nget.instructions).to.match(/^# n-get/);
        expect(nget.instructions).to.include('## Quick start');
    });
});
