/**
 * @fileoverview IPv6Utils test suite
 * Tests IPv6 address detection, validation, URL parsing, and HTTP agent support
 */

const {expect} = require('chai');
const IPv6Utils = require('../lib/utils/ipv6Utils');

describe('IPv6Utils', function() {
    describe('isValidIPv6', function() {
        it('should validate correct IPv6 addresses', function() {
            expect(IPv6Utils.isValidIPv6('::1')).to.equal(true);
            expect(IPv6Utils.isValidIPv6('2001:db8::1')).to.equal(true);
            expect(IPv6Utils.isValidIPv6('fe80::1')).to.equal(true);
            expect(IPv6Utils.isValidIPv6('::ffff:192.168.1.1')).to.equal(true);
            expect(IPv6Utils.isValidIPv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).to.equal(true);
        });

        it('should reject invalid IPv6 addresses', function() {
            expect(IPv6Utils.isValidIPv6('192.168.1.1')).to.equal(false);
            expect(IPv6Utils.isValidIPv6('invalid')).to.equal(false);
            expect(IPv6Utils.isValidIPv6('')).to.equal(false);
            expect(IPv6Utils.isValidIPv6('gggg::1')).to.equal(false);
        });
    });

    describe('isValidIPv4', function() {
        it('should validate correct IPv4 addresses', function() {
            expect(IPv6Utils.isValidIPv4('192.168.1.1')).to.equal(true);
            expect(IPv6Utils.isValidIPv4('127.0.0.1')).to.equal(true);
            expect(IPv6Utils.isValidIPv4('8.8.8.8')).to.equal(true);
        });

        it('should reject invalid IPv4 addresses', function() {
            expect(IPv6Utils.isValidIPv4('::1')).to.equal(false);
            expect(IPv6Utils.isValidIPv4('invalid')).to.equal(false);
            expect(IPv6Utils.isValidIPv4('256.1.1.1')).to.equal(false);
        });
    });

    describe('extractIPv6FromBrackets', function() {
        it('should extract valid IPv6 addresses from brackets', function() {
            expect(IPv6Utils.extractIPv6FromBrackets('[::1]')).to.equal('::1');
            expect(IPv6Utils.extractIPv6FromBrackets('[2001:db8::1]')).to.equal('2001:db8::1');
        });

        it('should return null for invalid bracketed strings', function() {
            expect(IPv6Utils.extractIPv6FromBrackets('[invalid]')).to.equal(null);
            expect(IPv6Utils.extractIPv6FromBrackets('::1')).to.equal(null);
            expect(IPv6Utils.extractIPv6FromBrackets('[192.168.1.1]')).to.equal(null);
        });
    });

    describe('wrapIPv6InBrackets', function() {
        it('should wrap IPv6 addresses in brackets', function() {
            expect(IPv6Utils.wrapIPv6InBrackets('::1')).to.equal('[::1]');
            expect(IPv6Utils.wrapIPv6InBrackets('2001:db8::1')).to.equal('[2001:db8::1]');
        });
    });

    describe('detectAddressType', function() {
        it('should detect bracketed IPv6 addresses', function() {
            const result = IPv6Utils.detectAddressType('[::1]');
            expect(result.type).to.equal('ipv6-bracketed');
            expect(result.address).to.equal('::1');
            expect(result.needsBrackets).to.equal(false);
        });

        it('should detect plain IPv6 addresses', function() {
            const result = IPv6Utils.detectAddressType('::1');
            expect(result.type).to.equal('ipv6-plain');
            expect(result.address).to.equal('::1');
            expect(result.needsBrackets).to.equal(true);
        });

        it('should detect IPv4 addresses', function() {
            const result = IPv6Utils.detectAddressType('192.168.1.1');
            expect(result.type).to.equal('ipv4');
            expect(result.address).to.equal('192.168.1.1');
            expect(result.needsBrackets).to.equal(false);
        });

        it('should detect regular hostnames', function() {
            const result = IPv6Utils.detectAddressType('example.com');
            expect(result.type).to.equal('hostname');
            expect(result.address).to.equal('example.com');
            expect(result.needsBrackets).to.equal(false);
        });

        it('should handle invalid bracketed addresses', function() {
            const result = IPv6Utils.detectAddressType('[invalid]');
            expect(result.type).to.equal('invalid');
        });
    });

    describe('normalizeHostname', function() {
        it('should wrap plain IPv6 addresses in brackets', function() {
            expect(IPv6Utils.normalizeHostname('::1')).to.equal('[::1]');
            expect(IPv6Utils.normalizeHostname('2001:db8::1')).to.equal('[2001:db8::1]');
        });

        it('should leave bracketed IPv6 addresses unchanged', function() {
            expect(IPv6Utils.normalizeHostname('[::1]')).to.equal('[::1]');
            expect(IPv6Utils.normalizeHostname('[2001:db8::1]')).to.equal('[2001:db8::1]');
        });

        it('should leave IPv4 addresses unchanged', function() {
            expect(IPv6Utils.normalizeHostname('192.168.1.1')).to.equal('192.168.1.1');
        });

        it('should leave hostnames unchanged', function() {
            expect(IPv6Utils.normalizeHostname('example.com')).to.equal('example.com');
        });
    });

    describe('parseURL', function() {
        it('should parse IPv6 URLs correctly', function() {
            const result = IPv6Utils.parseURL('http://[::1]/');
            expect(result.isIPv6).to.equal(true);
            expect(result.hostname).to.equal('[::1]');
            expect(result.addressInfo.address).to.equal('::1');
            expect(result.family).to.equal(6);
        });

        it('should parse IPv4 URLs correctly', function() {
            const result = IPv6Utils.parseURL('http://192.168.1.1/');
            expect(result.isIPv4).to.equal(true);
            expect(result.hostname).to.equal('192.168.1.1');
            expect(result.family).to.equal(4);
        });

        it('should parse hostname URLs correctly', function() {
            const result = IPv6Utils.parseURL('https://example.com/');
            expect(result.isHostname).to.equal(true);
            expect(result.hostname).to.equal('example.com');
            expect(result.family).to.equal(0);
        });

        it('should handle malformed URLs', function() {
            const result = IPv6Utils.parseURL('invalid-url');
            expect(result.error).to.not.be.undefined;
            expect(result.isValid).to.equal(false);
        });
    });

    describe('createURL', function() {
        it('should create proper IPv6 URLs', function() {
            const url = IPv6Utils.createURL('http:', '::1', 8080, '/path');
            expect(url).to.equal('http://[::1]:8080/path');
        });

        it('should create proper IPv4 URLs', function() {
            const url = IPv6Utils.createURL('https:', '192.168.1.1', null, '/api');
            expect(url).to.equal('https://192.168.1.1/api');
        });

        it('should create proper hostname URLs', function() {
            const url = IPv6Utils.createURL('https:', 'example.com', 443, '');
            expect(url).to.equal('https://example.com');
        });

        it('should handle default ports correctly', function() {
            const httpUrl = IPv6Utils.createURL('http:', 'example.com', 80);
            const httpsUrl = IPv6Utils.createURL('https:', 'example.com', 443);
            expect(httpUrl).to.equal('http://example.com');
            expect(httpsUrl).to.equal('https://example.com');
        });
    });

    describe('validateIPv6URL', function() {
        it('should validate correct IPv6 URLs', function() {
            const result = IPv6Utils.validateIPv6URL('http://[::1]/');
            expect(result.valid).to.equal(true);
            expect(result.ipv6Address).to.equal('::1');
            expect(result.family).to.equal(6);
        });

        it('should validate non-IPv6 URLs', function() {
            const result = IPv6Utils.validateIPv6URL('http://example.com/');
            expect(result.valid).to.equal(true);
            expect(result.isIPv6).to.equal(false);
        });

        it('should reject invalid URLs', function() {
            const result = IPv6Utils.validateIPv6URL('invalid-url');
            expect(result.valid).to.equal(false);
            expect(result.error).to.not.be.undefined;
        });
    });

    describe('Agent Options', function() {
        describe('getIPv6AgentOptions', function() {
            it('should return IPv6 agent options', function() {
                const options = IPv6Utils.getIPv6AgentOptions();
                expect(options.family).to.equal(6);
            });

            it('should merge additional options', function() {
                const options = IPv6Utils.getIPv6AgentOptions({ keepAlive: true });
                expect(options.family).to.equal(6);
                expect(options.keepAlive).to.equal(true);
            });
        });

        describe('getDualStackAgentOptions', function() {
            it('should return dual-stack agent options', function() {
                const options = IPv6Utils.getDualStackAgentOptions();
                expect(options.family).to.equal(0);
            });

            it('should merge additional options', function() {
                const options = IPv6Utils.getDualStackAgentOptions({ timeout: 5000 });
                expect(options.family).to.equal(0);
                expect(options.timeout).to.equal(5000);
            });
        });
    });

    describe('Constants', function() {
        it('should provide common IPv6 addresses', function() {
            expect(IPv6Utils.COMMON_IPV6_ADDRESSES.LOOPBACK).to.equal('::1');
            expect(IPv6Utils.COMMON_IPV6_ADDRESSES.UNSPECIFIED).to.equal('::');
            expect(IPv6Utils.COMMON_IPV6_ADDRESSES.DOCUMENTATION).to.equal('2001:db8::1');
        });

        it('should provide example IPv6 URLs', function() {
            expect(IPv6Utils.EXAMPLE_IPV6_URLS.HTTP_LOOPBACK).to.equal('http://[::1]/');
            expect(IPv6Utils.EXAMPLE_IPV6_URLS.HTTPS_LOOPBACK).to.equal('https://[::1]:8443/');
        });
    });

    describe('Edge Cases', function() {
        it('should handle empty strings', function() {
            expect(IPv6Utils.isValidIPv6('')).to.equal(false);
            expect(IPv6Utils.isValidIPv4('')).to.equal(false);
            
            const result = IPv6Utils.detectAddressType('');
            expect(result.type).to.equal('hostname');
        });

        it('should handle null and undefined', function() {
            expect(IPv6Utils.isValidIPv6(null)).to.equal(false);
            expect(IPv6Utils.isValidIPv6(undefined)).to.equal(false);
        });

        it('should handle compressed IPv6 addresses', function() {
            expect(IPv6Utils.isValidIPv6('2001:db8::')).to.equal(true);
            expect(IPv6Utils.isValidIPv6('::ffff:0:0')).to.equal(true);
            
            const result = IPv6Utils.detectAddressType('2001:db8::');
            expect(result.type).to.equal('ipv6-plain');
        });

        it('should handle IPv6 with ports in URLs', function() {
            const result = IPv6Utils.parseURL('http://[::1]:8080/path');
            expect(result.isIPv6).to.equal(true);
            expect(result.url.port).to.equal('8080');
            expect(result.url.pathname).to.equal('/path');
        });
    });
});