#!/usr/bin/env node

/**
 * Performance Test for n-get Parallel Downloads
 * Demonstrates the performance improvements with concurrent downloads
 */

const {execSync} = require('child_process');
const fs = require('fs');
const path = require('path');

// Test URLs (using httpbin for consistent testing)
const testUrls = [
    'https://httpbin.org/json',
    'https://httpbin.org/uuid',
    'https://httpbin.org/base64/aGVsbG8gd29ybGQ=',
    'https://httpbin.org/headers',
    'https://httpbin.org/user-agent',
];

// Test directory
const testDir = path.join(__dirname, 'temp-performance-test');

function cleanup() {
    if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, {recursive: true, force: true});
    }
}

function setup() {
    cleanup();
    fs.mkdirSync(testDir, {recursive: true});
}

function runTest(concurrency, description) {
    console.log(`\n🧪 Testing: ${description}`);
    console.log(`📊 Concurrency: ${concurrency}`);
    console.log(`🔗 URLs: ${testUrls.length}`);

    const startTime = Date.now();

    try {
        const command = `node ${path.join(__dirname, '../index.js')} ${testUrls.join(' ')} -d ${testDir} --max-concurrent ${concurrency} -q`;
        execSync(command, {stdio: 'inherit'});

        const endTime = Date.now();
        const duration = endTime - startTime;

        console.log(`⏱️  Duration: ${duration}ms`);
        console.log(`🚀 Speed: ${(testUrls.length / (duration / 1000)).toFixed(2)} downloads/second`);

        return {duration, concurrency, description};
    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
        return {duration: Infinity, concurrency, description};
    }
}

function main() {
    console.log('🚀 n-get Performance Test Suite');
    console.log('================================');

    setup();

    const results = [];

    // Test different concurrency levels
    results.push(runTest(1, 'Sequential Downloads (baseline)'));
    results.push(runTest(3, 'Default Concurrent Downloads'));
    results.push(runTest(5, 'High Concurrent Downloads'));
    results.push(runTest(10, 'Maximum Concurrent Downloads'));

    // Display results summary
    console.log('\n📊 Performance Summary');
    console.log('======================');

    const baseline = results[0];

    results.forEach((result, index) => {
        const improvement = baseline.duration > 0
            ? ((baseline.duration - result.duration) / baseline.duration * 100).toFixed(1)
            : 0;

        console.log(`${index + 1}. ${result.description}`);
        console.log(`   Duration: ${result.duration}ms`);
        console.log(`   Improvement: ${improvement}% faster than baseline`);
        console.log('');
    });

    // Find best performance
    const best = results.reduce((best, current) =>
        current.duration < best.duration ? current : best);

    console.log(`🏆 Best Performance: ${best.description}`);
    console.log(`🎯 Optimal Concurrency: ${best.concurrency}`);
    console.log(`⚡ Speed Improvement: ${((baseline.duration - best.duration) / baseline.duration * 100).toFixed(1)}% faster`);

    cleanup();
}

if (require.main === module) {
    main();
}

module.exports = {runTest, cleanup, setup};
