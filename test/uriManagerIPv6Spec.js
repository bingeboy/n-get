/**
 * @fileoverview URI Manager IPv6 support test suite
 * Tests IPv6 URL parsing and normalization in uriManager
 */

const {expect} = require('chai');
const requestUri = require('../lib/uriManager');

describe('URI Manager IPv6 Support', function() {
    describe('IPv6 URL Validation and Normalization', function() {
        it('should handle complete IPv6 URLs', function() {
            const testCases = [
                {
                    input: 'http://[::1]/',
                    expected: 'http://[::1]/',
                },
                {
                    input: 'https://[2001:db8::1]/path',
                    expected: 'https://[2001:db8::1]/path',
                },
                {
                    input: 'ftp://[fe80::1]/file.txt',
                    expected: 'ftp://[fe80::1]/file.txt',
                },
            ];

            testCases.forEach(({input, expected}) => {
                const result = requestUri(input);
                expect(result).to.equal(expected);
            });
        });

        it('should auto-add protocol to bracketed IPv6 addresses', function() {
            const testCases = [
                {
                    input: '[::1]',
                    expected: 'http://[::1]/',
                },
                {
                    input: '[2001:db8::1]',
                    expected: 'http://[2001:db8::1]/',
                },
                {
                    input: '[fe80::1]',
                    expected: 'http://[fe80::1]/',
                },
            ];

            testCases.forEach(({input, expected}) => {
                const result = requestUri(input);
                expect(result).to.equal(expected);
            });
        });

        it('should wrap plain IPv6 addresses in brackets and add protocol', function() {
            const testCases = [
                {
                    input: '::1',
                    expected: 'http://[::1]/',
                },
                {
                    input: '2001:db8::1',
                    expected: 'http://[2001:db8::1]/',
                },
                {
                    input: 'fe80::1',
                    expected: 'http://[fe80::1]/',
                },
            ];

            testCases.forEach(({input, expected}) => {
                const result = requestUri(input);
                expect(result).to.equal(expected);
            });
        });

        it('should handle IPv6 addresses with ports', function() {
            const testCases = [
                {
                    input: 'http://[::1]:8080/',
                    expected: 'http://[::1]:8080/',
                },
                {
                    input: 'https://[2001:db8::1]:3000/api',
                    expected: 'https://[2001:db8::1]:3000/api',
                },
            ];

            testCases.forEach(({input, expected}) => {
                const result = requestUri(input);
                expect(result).to.equal(expected);
            });
        });
    });

    describe('Protocol Validation with IPv6', function() {
        it('should accept valid protocols with IPv6', function() {
            const validProtocols = ['http', 'https', 'ftp', 'ftps', 'sftp'];
            const ipv6Address = '[::1]';

            validProtocols.forEach(protocol => {
                const url = `${protocol}://${ipv6Address}/`;
                const result = requestUri(url);
                expect(result).to.equal(url);
            });
        });

        it('should handle invalid protocols with IPv6 by defaulting to http', function() {
            const invalidProtocols = ['file', 'javascript', 'data'];
            const ipv6Address = '[::1]';

            invalidProtocols.forEach(protocol => {
                const url = `${protocol}://${ipv6Address}/`;
                const result = requestUri(url);
                // Invalid protocols get treated as missing and default to http
                expect(result).to.contain('http://');
            });
        });
    });

    describe('Error Handling with IPv6', function() {
        it('should handle malformed IPv6 addresses', function() {
            const malformedAddresses = [
                'invalid::ipv6',
                '::g1',
                '2001:db8:::1',
            ];

            malformedAddresses.forEach(address => {
                expect(() => requestUri(address)).to.throw();
            });
        });
    });

    describe('IPv6 Address Types', function() {
        it('should handle compressed IPv6 addresses', function() {
            const compressedAddresses = [
                '2001:db8::',
                '::ffff:0:0',
                '::1',
                'fc00::',
            ];

            compressedAddresses.forEach(address => {
                const result = requestUri(address);
                expect(result).to.equal(`http://[${address}]/`);
            });
        });

        it('should handle IPv4-mapped IPv6 addresses', function() {
            const testCases = [
                // Node.js normalizes IPv4-mapped addresses to hexadecimal format
                {input: '::ffff:192.168.1.1', expectedContains: '::ffff:'},
                {input: '::ffff:127.0.0.1', expectedContains: '::ffff:'},
            ];

            testCases.forEach(({input, expectedContains}) => {
                const result = requestUri(input);
                expect(result).to.contain('http://[');
                expect(result).to.contain(expectedContains);
                expect(result).to.contain(']/');
            });
        });
    });
});