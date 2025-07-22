#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

console.log('=== Configuration Directory Resolution Test ===\n');

// Test 1: From main n-get directory (simulating npm link scenario)
console.log('TEST 1: From main n-get directory (npm link scenario)');
console.log('Simulating: cd /mnt/c/Users/desig/development/n-get && node test-config.js');

const mainNgetDir = '/mnt/c/Users/desig/development/n-get';
console.log('__dirname (simulated):', mainNgetDir);
console.log('process.cwd() (simulated):', mainNgetDir);

const packageConfigDir1 = path.join(mainNgetDir, 'config');
const currentConfigDir1 = path.join(mainNgetDir, 'config');

console.log('Package config dir:', packageConfigDir1);
console.log('Current config dir:', currentConfigDir1);

let configDir1;
try {
    fs.accessSync(packageConfigDir1);
    configDir1 = packageConfigDir1;
    console.log('✓ Package config directory exists');
} catch {
    configDir1 = currentConfigDir1;
    console.log('✓ Using current directory config fallback');
}

console.log('Selected config dir:', configDir1);

try {
    fs.accessSync(path.join(configDir1, 'default.yaml'));
    console.log('✓ default.yaml found');
} catch {
    console.log('✗ default.yaml NOT found');
}

console.log('\n' + '='.repeat(60) + '\n');

// Test 2: From subdirectory (simulating test scenario)
console.log('TEST 2: From subdirectory (test scenario)');
console.log('Simulating: cd temp-test && node ../test-config.js');

const currentDir = process.cwd(); // This should be temp-test
const parentDir = path.dirname(currentDir);

console.log('__dirname (simulated):', parentDir); // Parent dir where test-config.js is
console.log('process.cwd() (actual):', currentDir); // Current working directory (temp-test)

const packageConfigDir2 = path.join(parentDir, 'config');
const currentConfigDir2 = path.join(currentDir, 'config');

console.log('Package config dir:', packageConfigDir2);
console.log('Current config dir:', currentConfigDir2);

let configDir2;
try {
    fs.accessSync(packageConfigDir2);
    configDir2 = packageConfigDir2;
    console.log('✓ Package config directory exists');
} catch {
    try {
        fs.accessSync(currentConfigDir2);
        configDir2 = currentConfigDir2;
        console.log('✓ Using current directory config fallback');
    } catch {
        console.log('✗ No config directory found');
        configDir2 = currentConfigDir2;
    }
}

console.log('Selected config dir:', configDir2);

try {
    fs.accessSync(path.join(configDir2, 'default.yaml'));
    console.log('✓ default.yaml found');
} catch {
    console.log('✗ default.yaml NOT found');
}

console.log('\n' + '='.repeat(60) + '\n');

// Test 3: How ConfigManager actually works
console.log('TEST 3: How ConfigManager actually resolves config directory');

// This is what ConfigManager does - it uses process.cwd() for config directory
const configManagerDir = path.join(process.cwd(), 'config');
console.log('ConfigManager would use:', configManagerDir);

try {
    fs.accessSync(configManagerDir);
    console.log('✓ ConfigManager config directory exists');
} catch {
    console.log('✗ ConfigManager config directory does NOT exist');
}

try {
    fs.accessSync(path.join(configManagerDir, 'default.yaml'));
    console.log('✓ ConfigManager would find default.yaml');
} catch {
    console.log('✗ ConfigManager would NOT find default.yaml');
}

console.log('\nCURRENT WORKING DIRECTORY:', process.cwd());

// Show the issue
console.log('\n' + '='.repeat(60) + '\n');
console.log('ANALYSIS:');
console.log('- test-config.js uses __dirname for package config resolution');
console.log('- ConfigManager uses process.cwd() for config resolution');
console.log('- When run from subdirectory, process.cwd() != __dirname of main package');
console.log('- This creates inconsistent behavior between npm link and test scenarios');