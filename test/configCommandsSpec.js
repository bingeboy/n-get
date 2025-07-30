/**
 * @fileoverview Comprehensive test suite for Configuration CLI Commands
 * Tests all config commands: show, set, profiles, profile, validate, debug
 */

const {expect} = require('chai');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ConfigCommands = require('../lib/cli/configCommands');

describe('ConfigCommands CLI', () => {
    let tempDir;
    let tempConfigDir;
    let originalCwd;
    let originalEnv;
    let configCommands;
    let capturedOutput;
    let capturedErrors;

    beforeEach(() => {
        // Save original state
        originalCwd = process.cwd();
        originalEnv = {...process.env};
        
        // Create temporary directory for test configs
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-config-cli-test-'));
        tempConfigDir = path.join(tempDir, 'config');
        fs.mkdirSync(tempConfigDir, {recursive: true});

        // Clean up environment variables
        Object.keys(process.env).forEach(key => {
            if (key.startsWith('NGET_')) {
                delete process.env[key];
            }
        });

        // Initialize config commands
        configCommands = new ConfigCommands();
        
        // Reset captured output
        capturedOutput = [];
        capturedErrors = [];

        // Create test configuration files
        createTestConfigs();
    });

    afterEach(() => {
        // Restore original state
        process.chdir(originalCwd);
        process.env = originalEnv;

        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, {recursive: true, force: true});
        }
    });

    function createTestConfigs() {
        // Create default configuration
        const defaultConfig = {
            version: '2.0.0',
            http: {
                timeout: 30000,
                maxRetries: 3,
                maxConnections: 20,
            },
            downloads: {
                maxConcurrent: 3,
                enableResume: true,
            },
            profiles: {
                fast: {
                    description: 'Fast downloads',
                    downloads: {maxConcurrent: 10},
                },
                secure: {
                    description: 'Secure downloads',
                    security: {allowedProtocols: ['https']},
                },
            },
        };

        fs.writeFileSync(
            path.join(tempConfigDir, 'default.yaml'),
            require('js-yaml').dump(defaultConfig),
        );
    }

    function createMockConfigManager(overrides = {}) {
        return {
            getConfig: () => ({
                version: '2.0.0',
                http: {timeout: 30000},
                downloads: {maxConcurrent: 3},
                ...overrides.config,
            }),
            get: (path, defaultValue) => {
                const paths = {
                    'http': {timeout: 30000, maxRetries: 3},
                    'http.timeout': 30000,
                    'downloads.maxConcurrent': 3,
                    'logging.level': 'info',
                };
                return paths[path] ?? defaultValue;
            },
            set: (path, value) => {
                // Mock set operation
                if (overrides.throwOnSet) {
                    throw new Error('Validation failed');
                }
                overrides.lastSet = {path, value};
            },
            getAvailableProfiles: () => overrides.profiles || {
                fast: {
                    name: 'fast',
                    description: 'Fast downloads',
                    active: false,
                    config: {downloads: {maxConcurrent: 10}},
                },
            },
            applyProfile: async(name) => {
                if (!overrides.profiles || !overrides.profiles[name]) {
                    throw new Error(`Profile '${name}' not found`);
                }
                overrides.appliedProfile = name;
            },
            getMetrics: () => ({
                loadTime: new Date(),
                loadCount: 1,
                validationCount: 1,
                profileSwitches: 0,
                errors: overrides.errors || [],
                configSections: ['http', 'downloads'],
                profileCount: Object.keys(overrides.profiles || {}).length,
                historyLength: 0,
            }),
            options: {
                environment: 'test',
                configDir: tempConfigDir,
                enableHotReload: false,
            },
            activeProfile: overrides.activeProfile || null,
        };
    }

    function mockConsoleOutput() {
        const originalLog = console.log;
        const originalError = console.error;
        
        console.log = (...args) => {
            capturedOutput.push(args.join(' '));
        };
        
        console.error = (...args) => {
            capturedErrors.push(args.join(' '));
        };
        
        return () => {
            console.log = originalLog;
            console.error = originalError;
        };
    }

    function mockProcessExit() {
        let exitCode = null;
        const originalExit = process.exit;
        
        process.exit = (code) => {
            exitCode = code;
            throw new Error(`Process exit ${code}`);
        };
        
        return {
            getExitCode: () => exitCode,
            restore: () => { process.exit = originalExit; },
        };
    }

    describe('Config Show Command', () => {
        it('should show full configuration', async() => {
            const restoreConsole = mockConsoleOutput();
            const mockManager = createMockConfigManager();
            configCommands.initializeConfigManager = () => mockManager;
            
            try {
                await configCommands.show([], {quiet: true});
                
                const output = capturedOutput.join('\n');
                expect(output).to.include('Environment: test');
                expect(output).to.include('version');
                expect(output).to.include('http');
            } finally {
                restoreConsole();
            }
        });

        it('should show specific configuration section', async() => {
            const restoreConsole = mockConsoleOutput();
            const mockManager = createMockConfigManager();
            configCommands.initializeConfigManager = () => mockManager;
            
            try {
                await configCommands.show(['http'], {quiet: true});
                
                const output = capturedOutput.join('\n');
                expect(output).to.include('Section: http');
                expect(output).to.include('timeout');
            } finally {
                restoreConsole();
            }
        });

        it('should handle non-existent section', async() => {
            const restoreConsole = mockConsoleOutput();
            const exitMock = mockProcessExit();
            const mockManager = createMockConfigManager();
            mockManager.get = () => undefined; // Return undefined for non-existent section
            configCommands.initializeConfigManager = () => mockManager;
            
            try {
                await configCommands.show(['nonexistent'], {quiet: true});
                expect.fail('Should have exited');
            } catch (error) {
                expect(error.message).to.include('Process exit 1');
                expect(exitMock.getExitCode()).to.equal(1);
                const errors = capturedErrors.join('\n');
                expect(errors).to.include('not found');
            } finally {
                restoreConsole();
                exitMock.restore();
            }
        });
    });

    describe('Config Set Command', () => {
        it('should set configuration values', async() => {
            const restoreConsole = mockConsoleOutput();
            const overrides = {};
            const mockManager = createMockConfigManager(overrides);
            configCommands.initializeConfigManager = () => mockManager;
            
            try {
                await configCommands.set(['http.timeout', '45000'], {quiet: false});
                
                expect(overrides.lastSet.path).to.equal('http.timeout');
                expect(overrides.lastSet.value).to.equal(45000);
                
                const output = capturedOutput.join('\n');
                expect(output).to.include('Configuration updated');
            } finally {
                restoreConsole();
            }
        });

        it('should parse boolean values', async() => {
            const restoreConsole = mockConsoleOutput();
            const overrides = {};
            const mockManager = createMockConfigManager(overrides);
            configCommands.initializeConfigManager = () => mockManager;
            
            try {
                await configCommands.set(['downloads.enableResume', 'false'], {quiet: true});
                
                expect(overrides.lastSet.value).to.equal(false);
            } finally {
                restoreConsole();
            }
        });

        it('should require both arguments', async() => {
            const restoreConsole = mockConsoleOutput();
            const exitMock = mockProcessExit();
            const mockManager = createMockConfigManager();
            configCommands.initializeConfigManager = () => mockManager;
            
            try {
                await configCommands.set(['http.timeout'], {quiet: true});
                expect.fail('Should have exited');
            } catch (error) {
                expect(error.message).to.include('Process exit 1');
                const errors = capturedErrors.join('\n');
                expect(errors).to.include('Usage: nget config set');
            } finally {
                restoreConsole();
                exitMock.restore();
            }
        });
    });

    describe('Config Profiles Command', () => {
        it('should list available profiles', async() => {
            const restoreConsole = mockConsoleOutput();
            const profiles = {
                fast: {
                    name: 'fast',
                    description: 'Fast downloads',
                    active: false,
                    config: {},
                },
            };
            const mockManager = createMockConfigManager({profiles});
            configCommands.initializeConfigManager = () => mockManager;
            
            try {
                await configCommands.profiles([], {quiet: true});
                
                const output = capturedOutput.join('\n');
                expect(output).to.include('fast');
                expect(output).to.include('Fast downloads');
            } finally {
                restoreConsole();
            }
        });

        it('should handle no profiles', async() => {
            const restoreConsole = mockConsoleOutput();
            const mockManager = createMockConfigManager({profiles: {}});
            configCommands.initializeConfigManager = () => mockManager;
            
            try {
                await configCommands.profiles([], {quiet: true});
                
                const output = capturedOutput.join('\n');
                expect(output).to.include('No profiles configured');
            } finally {
                restoreConsole();
            }
        });
    });

    describe('Config Profile Switch Command', () => {
        it('should switch to existing profile', async() => {
            const restoreConsole = mockConsoleOutput();
            const overrides = {
                profiles: {
                    fast: {
                        name: 'fast',
                        description: 'Fast downloads',
                        config: {},
                    },
                },
            };
            const mockManager = createMockConfigManager(overrides);
            configCommands.initializeConfigManager = () => mockManager;
            
            try {
                await configCommands.profile(['fast'], {quiet: false});
                
                expect(overrides.appliedProfile).to.equal('fast');
                const output = capturedOutput.join('\n');
                expect(output).to.include('Applied profile \'fast\'');
            } finally {
                restoreConsole();
            }
        });

        it('should require profile name', async() => {
            const restoreConsole = mockConsoleOutput();
            const exitMock = mockProcessExit();
            const mockManager = createMockConfigManager();
            configCommands.initializeConfigManager = () => mockManager;
            
            try {
                await configCommands.profile([], {quiet: true});
                expect.fail('Should have exited');
            } catch (error) {
                expect(error.message).to.include('Process exit 1');
                const errors = capturedErrors.join('\n');
                expect(errors).to.include('Usage: nget config profile');
            } finally {
                restoreConsole();
                exitMock.restore();
            }
        });
    });

    describe('Config Validate Command', () => {
        it('should validate configuration successfully', async() => {
            const restoreConsole = mockConsoleOutput();
            const mockManager = createMockConfigManager({activeProfile: 'fast'});
            configCommands.initializeConfigManager = () => mockManager;
            
            try {
                await configCommands.validate([], {quiet: true});
                
                const output = capturedOutput.join('\n');
                expect(output).to.include('Configuration is valid');
                expect(output).to.include('Active Profile: fast');
                expect(output).to.include('http: OK');
            } finally {
                restoreConsole();
            }
        });

        it('should show validation errors', async() => {
            const restoreConsole = mockConsoleOutput();
            const errors = [
                {type: 'VALIDATION_ERROR', message: 'Invalid timeout'},
            ];
            const mockManager = createMockConfigManager({errors});
            configCommands.initializeConfigManager = () => mockManager;
            
            try {
                await configCommands.validate([], {quiet: true});
                
                const output = capturedOutput.join('\n');
                expect(output).to.include('Recent Errors: 1');
                expect(output).to.include('VALIDATION_ERROR');
            } finally {
                restoreConsole();
            }
        });
    });

    describe('Config Debug Command', () => {
        it('should show debug information', async() => {
            const restoreConsole = mockConsoleOutput();
            const mockManager = createMockConfigManager();
            configCommands.initializeConfigManager = () => mockManager;
            
            try {
                await configCommands.debug([], {quiet: true});
                
                const output = capturedOutput.join('\n');
                expect(output).to.include('Environment: test');
                expect(output).to.include('Config Directory:');
                expect(output).to.include('Configuration Files:');
                expect(output).to.include('Load Count: 1');
            } finally {
                restoreConsole();
            }
        });

        it('should show verbose configuration', async() => {
            const restoreConsole = mockConsoleOutput();
            const mockManager = createMockConfigManager({
                config: {version: '2.0.0', http: {timeout: 30000}},
            });
            configCommands.initializeConfigManager = () => mockManager;
            
            try {
                await configCommands.debug(['--verbose'], {quiet: true});
                
                const output = capturedOutput.join('\n');
                expect(output).to.include('Configuration Structure:');
                expect(output).to.include('"version": "2.0.0"');
            } finally {
                restoreConsole();
            }
        });
    });

    describe('Command Router', () => {
        it('should route to correct commands', async() => {
            const restoreConsole = mockConsoleOutput();
            const mockManager = createMockConfigManager();
            configCommands.initializeConfigManager = () => mockManager;
            
            try {
                // Test show command
                await configCommands.execute(['show'], {quiet: true});
                let output = capturedOutput.join('\n');
                expect(output).to.include('Environment: test');
                
                // Clear and test profiles command
                capturedOutput = [];
                await configCommands.execute(['profiles'], {quiet: true});
                output = capturedOutput.join('\n');
                expect(output).to.include('fast');
            } finally {
                restoreConsole();
            }
        });

        it('should show help for unknown commands', async() => {
            const restoreConsole = mockConsoleOutput();
            const exitMock = mockProcessExit();
            
            let helpShown = false;
            configCommands.showConfigHelp = () => { helpShown = true; };
            
            try {
                await configCommands.execute(['unknown'], {quiet: true});
                expect.fail('Should have exited');
            } catch (error) {
                expect(error.message).to.include('Process exit 1');
                expect(helpShown).to.be.true;
            } finally {
                restoreConsole();
                exitMock.restore();
            }
        });
    });

    describe('Integration Tests', () => {
        it('should work with real ConfigManager', async() => {
            const restoreConsole = mockConsoleOutput();
            
            // Use real ConfigManager with test config directory
            configCommands.configManager = null; // Reset cached instance
            const originalInit = configCommands.initializeConfigManager;
            
            configCommands.initializeConfigManager = (options) => {
                const ConfigManager = require('../lib/config/ConfigManager');
                return new ConfigManager({
                    environment: 'development',
                    configDir: tempConfigDir,
                    enableHotReload: false,
                    logger: {info: () => {}, debug: () => {}, warn: () => {}, error: () => {}},
                });
            };
            
            try {
                await configCommands.show(['http'], {quiet: true});
                
                const output = capturedOutput.join('\n');
                expect(output).to.include('Section: http');
                expect(output).to.include('timeout');
                
                // Test profiles
                capturedOutput = [];
                await configCommands.profiles([], {quiet: true});
                const profilesOutput = capturedOutput.join('\n');
                expect(profilesOutput).to.include('fast');
                expect(profilesOutput).to.include('secure');
            } finally {
                configCommands.initializeConfigManager = originalInit;
                restoreConsole();
            }
        });
    });
});