const {expect} = require('chai');
const uriManager = require('../lib/uriManager.js');

describe('URI Manager', () => {
    describe('#requestUri()', () => {
        it('should add http:// protocol if none is declared', () => {
            const urls = [
                'google.com',
                'http://google.com',
                '192.168.1.1',
                'http://192.168.1.1',
                'https://github.com/bingeboy',
                'ftp://192.168.1.1',
            ];
            const results = urls.map(uriManager);

            expect(results[0]).to.equal('http://google.com/');
            expect(results[1]).to.equal('http://google.com/');
            expect(results[2]).to.equal('http://192.168.1.1/');
            expect(results[3]).to.equal('http://192.168.1.1/');
            expect(results[4]).to.equal('https://github.com/bingeboy');
            expect(results[5]).to.equal('ftp://192.168.1.1/');
        });

        it('should handle URLs with paths correctly', () => {
            const urls = [
                'example.com/path/to/file.zip',
                'https://example.com/path/to/file.zip',
            ];
            const results = urls.map(uriManager);

            expect(results[0]).to.equal('http://example.com/path/to/file.zip');
            expect(results[1]).to.equal('https://example.com/path/to/file.zip');
        });

        it('should throw error for invalid URLs', () => {
            expect(() => uriManager('not a url at all!')).to.throw('Invalid URL');
            expect(() => uriManager('')).to.throw('Invalid URL');
        });

        it('should handle localhost URLs', () => {
            const result = uriManager('localhost:8080/file.json');
            expect(result).to.equal('http://localhost:8080/file.json');
        });
    });
});
