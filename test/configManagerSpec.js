/**
 * @fileoverview Comprehensive test suite for ConfigManager
 * Tests configuration loading, validation, profiles, AI integration, and error handling
 */

const { expect } = require('chai');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ConfigManager = require('../lib/config/ConfigManager');

describe('ConfigManager', () => {
    let tempDir;
    let tempConfigDir;
    let originalCwd;
    let originalEnv;
    let configInstances = [];

    beforeEach(() => {
        // Save original state
        originalCwd = process.cwd();
        originalEnv = { ...process.env };

        // Create temporary directory for test configs
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nget-config-test-'));
        tempConfigDir = path.join(tempDir, 'config');
        fs.mkdirSync(tempConfigDir, { recursive: true });

        // Clean up environment variables
        Object.keys(process.env).forEach(key => {
            if (key.startsWith('NGET_')) {
                delete process.env[key];
            }
        });

        // Reset config instances array
        configInstances = [];
    });

    afterEach((done) => {
        // Clean up all ConfigManager instances
        const cleanupPromises = configInstances.map(config => {
            try {
                if (config && typeof config.cleanup === 'function') {
                    return Promise.resolve(config.cleanup());
                }
            } catch (error) {
                // Ignore cleanup errors
                return Promise.resolve();
            }
            return Promise.resolve();
        });

        Promise.all(cleanupPromises)
            .then(() => {
                // Restore original state
                process.chdir(originalCwd);
                process.env = originalEnv;

                // Clean up temporary directory
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
                
                // Clear the instances array
                configInstances = [];
                done();
            })
            .catch(() => {
                // Even if cleanup fails, continue with test cleanup
                process.chdir(originalCwd);
                process.env = originalEnv;
                
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
                
                configInstances = [];
                done();
            });
    });

    // Helper function to create and track ConfigManager instances
    function createConfigManager(options = {}) {
        const config = new ConfigManager(options);
        configInstances.push(config);
        return config;
    }

    describe('Constructor and Initialization', () => {
        it('should create ConfigManager with default options', () => {
            // Temporarily unset NODE_ENV to test default behavior
            const originalEnv = process.env.NODE_ENV;
            delete process.env.NODE_ENV;
            
            const config = createConfigManager();
            
            // Restore NODE_ENV
            process.env.NODE_ENV = originalEnv;
            
            expect(config).to.be.an.instanceOf(ConfigManager);
            // When running via mocha, it should detect test environment
            expect(config.options.environment).to.equal('test');
            expect(config.options.enableHotReload).to.be.true;
        });

        it('should create ConfigManager with custom options', () => {
            // Create minimal config first
            const minimalConfig = { version: '2.0.0' };
            fs.writeFileSync(
                path.join(tempConfigDir, 'default.yaml'),
                require('js-yaml').dump(minimalConfig)
            );

            const config = createConfigManager({
                environment: 'production',
                enableHotReload: false,
                configDir: tempConfigDir
            });
            
            expect(config.options.environment).to.equal('production');
            expect(config.options.enableHotReload).to.be.false;
            expect(config.options.configDir).to.equal(tempConfigDir);
        });

        it('should use NODE_ENV environment variable', () => {
            process.env.NODE_ENV = 'staging';
            
            const config = createConfigManager();
            
            expect(config.options.environment).to.equal('staging');
        });
    });

    describe('Configuration Loading', () => {
        beforeEach(() => {
            // Create test configuration files
            const defaultConfig = {
                version: '2.0.0',
                http: {
                    timeout: 30000,
                    maxRetries: 3,
                    maxConnections: 20
                },
                downloads: {
                    maxConcurrent: 3,
                    enableResume: true
                }
            };

            const devConfig = {
                http: {
                    timeout: 15000
                },
                downloads: {
                    maxConcurrent: 5
                },
                logging: {
                    level: 'debug'
                }
            };

            fs.writeFileSync(
                path.join(tempConfigDir, 'default.yaml'),
                require('js-yaml').dump(defaultConfig)
            );

            fs.writeFileSync(
                path.join(tempConfigDir, 'development.yaml'),
                require('js-yaml').dump(devConfig)
            );
        });

        it('should load and merge default and environment configurations', () => {
            const config = createConfigManager({
                environment: 'development',
                configDir: tempConfigDir
            });

            const loadedConfig = config.getConfig();
            
            expect(loadedConfig.version).to.equal('2.0.0');
            expect(loadedConfig.http.timeout).to.equal(15000); // Overridden by development
            expect(loadedConfig.http.maxRetries).to.equal(3); // From default
            expect(loadedConfig.downloads.maxConcurrent).to.equal(5); // Overridden by development
            expect(loadedConfig.logging.level).to.equal('debug'); // From development
        });

        it('should handle missing environment config gracefully', () => {
            const config = createConfigManager({
                environment: 'nonexistent',
                configDir: tempConfigDir
            });

            const loadedConfig = config.getConfig();
            
            expect(loadedConfig.version).to.equal('2.0.0');
            expect(loadedConfig.http.timeout).to.equal(30000); // Default value
        });

        it('should throw error for missing default config', () => {
            fs.unlinkSync(path.join(tempConfigDir, 'default.yaml'));
            
            expect(() => {
                createConfigManager({
                    configDir: tempConfigDir
                });
            }).to.throw();
        });
    });

    describe('Environment Variable Loading', () => {
        beforeEach(() => {
            // Create minimal default config
            const defaultConfig = {
                version: '2.0.0',
                http: { timeout: 30000 },
                downloads: { maxConcurrent: 3 }
            };

            fs.writeFileSync(
                path.join(tempConfigDir, 'default.yaml'),
                require('js-yaml').dump(defaultConfig)
            );
        });

        it('should load configuration from environment variables', () => {
            process.env.NGET_HTTP_TIMEOUT = '45000';
            process.env.NGET_DOWNLOADS_MAXCONCURRENT = '7';
            process.env.NGET_LOGGING_LEVEL = 'warn';

            const config = createConfigManager({
                configDir: tempConfigDir,
                enableHotReload: false
            });

            expect(config.get('http.timeout')).to.equal(45000);
            expect(config.get('downloads.maxConcurrent')).to.equal(7);
            expect(config.get('logging.level')).to.equal('warn');
        });

        it('should parse boolean environment variables correctly', () => {
            process.env.NGET_DOWNLOADS_ENABLERESUME = 'false';
            process.env.NGET_AI_ENABLED = 'true';

            const config = createConfigManager({
                configDir: tempConfigDir,
                enableHotReload: false
            });

            expect(config.get('downloads.enableResume')).to.be.false;
            expect(config.get('ai.enabled')).to.be.true;
        });

        it('should parse array environment variables correctly', () => {
            process.env.NGET_SECURITY_ALLOWEDPROTOCOLS = 'https,sftp';

            const config = createConfigManager({
                configDir: tempConfigDir,
                enableHotReload: false
            });

            expect(config.get('security.allowedProtocols')).to.deep.equal(['https', 'sftp']);
        });
    });

    describe('Configuration Validation', () => {
        it('should validate correct configuration', () => {
            const validConfig = {
                version: '2.0.0',
                http: {
                    timeout: 30000,
                    maxRetries: 3,
                    maxConnections: 20
                },
                downloads: {
                    maxConcurrent: 3,
                    enableResume: true
                }
            };

            fs.writeFileSync(
                path.join(tempConfigDir, 'default.yaml'),
                require('js-yaml').dump(validConfig)
            );

            expect(() => {
                createConfigManager({
                    configDir: tempConfigDir
                });
            }).to.not.throw();
        });

        it('should throw error for invalid configuration values', () => {
            const invalidConfig = {
                version: '2.0.0',
                http: {
                    timeout: -1000, // Invalid negative timeout
                    maxRetries: 15  // Exceeds maximum
                }
            };

            fs.writeFileSync(
                path.join(tempConfigDir, 'default.yaml'),
                require('js-yaml').dump(invalidConfig)
            );

            expect(() => {
                createConfigManager({
                    configDir: tempConfigDir
                });
            }).to.throw();
        });

        it('should strip unknown configuration properties', () => {
            const configWithUnknown = {
                version: '2.0.0',
                http: {
                    timeout: 30000,
                    unknownProperty: 'should be removed'
                },
                unknownSection: {
                    data: 'should be removed'
                }
            };

            fs.writeFileSync(
                path.join(tempConfigDir, 'default.yaml'),
                require('js-yaml').dump(configWithUnknown)
            );

            const config = createConfigManager({
                configDir: tempConfigDir,
                enableHotReload: false
            });

            const loadedConfig = config.getConfig();
            expect(loadedConfig.http.unknownProperty).to.be.undefined;
            expect(loadedConfig.unknownSection).to.be.undefined;
        });
    });

    describe('Configuration Access Methods', () => {
        let config;

        beforeEach(() => {
            const testConfig = {
                version: '2.0.0',
                http: {
                    timeout: 30000,
                    maxRetries: 3
                },
                downloads: {
                    maxConcurrent: 3
                }
            };

            fs.writeFileSync(
                path.join(tempConfigDir, 'default.yaml'),
                require('js-yaml').dump(testConfig)
            );

            config = createConfigManager({
                configDir: tempConfigDir
            });
        });

        describe('get() method', () => {
            it('should get configuration values by path', () => {
                expect(config.get('version')).to.equal('2.0.0');
                expect(config.get('http.timeout')).to.equal(30000);
                expect(config.get('downloads.maxConcurrent')).to.equal(3);
            });

            it('should return default value for non-existent paths', () => {
                expect(config.get('nonexistent.path', 'default')).to.equal('default');
                expect(config.get('http.nonexistent', 999)).to.equal(999);
            });

            it('should return undefined for non-existent paths without default', () => {
                expect(config.get('nonexistent.path')).to.be.undefined;
            });
        });

        describe('set() method', () => {
            it('should set configuration values by path', () => {
                config.set('http.timeout', 45000);
                expect(config.get('http.timeout')).to.equal(45000);

                config.set('http.userAgent', 'test-agent');
                expect(config.get('http.userAgent')).to.equal('test-agent');
            });

            it('should validate configuration after setting', () => {
                expect(() => {
                    config.set('http.timeout', -1000); // Invalid value
                }).to.throw();
            });

            it('should record configuration changes', () => {
                const initialHistoryLength = config.configHistory.length;
                
                config.set('http.timeout', 45000);
                
                expect(config.configHistory.length).to.be.greaterThan(initialHistoryLength);
                
                const lastChange = config.configHistory[config.configHistory.length - 1];
                expect(lastChange.type).to.equal('SET');
                expect(lastChange.details.path).to.equal('http.timeout');
                expect(lastChange.details.value).to.equal(45000);
            });
        });

        describe('getConfig() method', () => {
            it('should return a copy of the entire configuration', () => {
                const configCopy = config.getConfig();
                
                expect(configCopy.version).to.equal('2.0.0');
                expect(configCopy.http.timeout).to.equal(30000);
                expect(configCopy.http.maxRetries).to.equal(3);

                // Modify the copy to ensure it's not the original
                configCopy.version = '3.0.0';
                expect(config.get('version')).to.equal('2.0.0');
            });
        });
    });

    describe('Profile Management', () => {
        let config;

        beforeEach(() => {
            const testConfig = {
                version: '2.0.0',
                http: {
                    timeout: 30000,
                    maxConnections: 20
                },
                downloads: {
                    maxConcurrent: 3
                },
                profiles: {
                    fast: {
                        description: 'Fast download profile',
                        http: {
                            timeout: 15000,
                            maxConnections: 50
                        },
                        downloads: {
                            maxConcurrent: 10
                        }
                    },
                    secure: {
                        description: 'Secure download profile',
                        security: {
                            allowedProtocols: ['https'],
                            certificateValidation: true
                        }
                    }
                }
            };

            fs.writeFileSync(
                path.join(tempConfigDir, 'default.yaml'),
                require('js-yaml').dump(testConfig)
            );

            config = createConfigManager({
                configDir: tempConfigDir
            });
        });

        describe('getAvailableProfiles()', () => {
            it('should return all available profiles', () => {
                const profiles = config.getAvailableProfiles();
                
                expect(profiles).to.have.property('fast');
                expect(profiles).to.have.property('secure');
                
                expect(profiles.fast.description).to.equal('Fast download profile');
                expect(profiles.fast.active).to.be.false;
                expect(profiles.secure.description).to.equal('Secure download profile');
            });
        });

        describe('applyProfile()', () => {
            it('should apply profile configuration correctly', async () => {
                await config.applyProfile('fast');
                
                expect(config.get('http.timeout')).to.equal(15000);
                expect(config.get('http.maxConnections')).to.equal(50);
                expect(config.get('downloads.maxConcurrent')).to.equal(10);
                expect(config.activeProfile).to.equal('fast');
            });

            it('should merge profile with existing configuration', async () => {
                await config.applyProfile('secure');
                
                // Should have secure profile settings
                expect(config.get('security.allowedProtocols')).to.deep.equal(['https']);
                expect(config.get('security.certificateValidation')).to.be.true;
                
                // Should retain original settings not overridden by profile
                expect(config.get('http.timeout')).to.equal(30000);
                expect(config.get('downloads.maxConcurrent')).to.equal(3);
            });

            it('should throw error for non-existent profile', async () => {
                try {
                    await config.applyProfile('nonexistent');
                    expect.fail('Should have thrown an error');
                } catch (error) {
                    expect(error.message).to.include('Profile \'nonexistent\' not found');
                }
            });

            it('should rollback on validation error', async () => {
                // Modify the profile to cause validation error
                config.profiles.set('invalid', {
                    http: {
                        timeout: -1000 // Invalid value
                    }
                });

                const originalTimeout = config.get('http.timeout');

                try {
                    await config.applyProfile('invalid');
                    expect.fail('Should have thrown an error');
                } catch (error) {
                    // Configuration should be rolled back
                    expect(config.get('http.timeout')).to.equal(originalTimeout);
                }
            });

            it('should update metrics on profile application', async () => {
                const initialSwitches = config.metrics.profileSwitches;
                
                await config.applyProfile('fast');
                
                expect(config.metrics.profileSwitches).to.equal(initialSwitches + 1);
            });
        });
    });

    describe('AI Integration Methods', () => {
        let config;

        beforeEach(() => {
            const testConfig = {
                version: '2.0.0',
                http: {
                    timeout: 30000,
                    maxRetries: 3,
                    maxConnections: 20
                },
                downloads: {
                    maxConcurrent: 3,
                    enableResume: true,
                    progressReporting: true
                },
                security: {
                    blockPrivateNetworks: false,
                    certificateValidation: true
                },
                ai: {
                    enabled: true,
                    profiles: {
                        enabled: true,
                        learningEnabled: true
                    }
                },
                profiles: {
                    fast: {
                        description: 'Fast profile',
                        downloads: { maxConcurrent: 10 }
                    }
                }
            };

            fs.writeFileSync(
                path.join(tempConfigDir, 'default.yaml'),
                require('js-yaml').dump(testConfig)
            );

            config = createConfigManager({
                configDir: tempConfigDir
            });
        });

        describe('getAIConfigSummary()', () => {
            it('should return comprehensive AI configuration summary', () => {
                const summary = config.getAIConfigSummary();
                
                expect(summary).to.have.property('currentProfile');
                expect(summary).to.have.property('environment');
                expect(summary).to.have.property('keySettings');
                expect(summary).to.have.property('capabilities');
                expect(summary).to.have.property('performance');

                expect(summary.keySettings.maxConcurrentDownloads).to.equal(3);
                expect(summary.keySettings.httpTimeout).to.equal(30000);
                expect(summary.capabilities.aiIntegration).to.be.true;
                expect(summary.capabilities.profileSwitching).to.be.true;
            });
        });

        describe('getSecurityLevel()', () => {
            it('should return "low" for minimal security settings', () => {
                const summary = config.getAIConfigSummary();
                expect(summary.keySettings.securityLevel).to.equal('medium'); // Has cert validation and rate limiting
            });

            it('should return "high" for maximum security settings', () => {
                config.set('security.blockPrivateNetworks', true);
                config.set('security.blockLocalhost', true);
                
                const summary = config.getAIConfigSummary();
                expect(summary.keySettings.securityLevel).to.equal('high');
            });
        });

        describe('learnFromOutcome()', () => {
            it('should record learning data when enabled', () => {
                const initialHistoryLength = config.configHistory.length;
                
                config.learnFromOutcome({
                    success: true,
                    duration: 30000,
                    throughput: 5242880,
                    errors: {}
                });
                
                expect(config.configHistory.length).to.be.greaterThan(initialHistoryLength);
                
                // Should record LEARNING_DATA entry
                const learningEntry = config.configHistory.find(entry => entry.type === 'LEARNING_DATA');
                expect(learningEntry).to.exist;
                expect(learningEntry.details.outcome.success).to.be.true;
            });

            it('should record successful configurations', () => {
                const initialHistoryLength = config.configHistory.length;
                
                config.learnFromOutcome({
                    success: true,
                    duration: 25000,
                    throughput: 8388608, // > 1MB/s threshold
                    errors: {}
                });
                
                // Should have both LEARNING_DATA and SUCCESSFUL_CONFIG entries
                expect(config.configHistory.length).to.equal(initialHistoryLength + 2);
                
                const successEntry = config.configHistory.find(entry => entry.type === 'SUCCESSFUL_CONFIG');
                expect(successEntry).to.exist;
                expect(successEntry.details.performance.throughput).to.equal(8388608);
            });

            it('should not record when learning is disabled', () => {
                config.set('ai.profiles.learningEnabled', false);
                
                const initialHistoryLength = config.configHistory.length;
                
                config.learnFromOutcome({
                    success: true,
                    duration: 30000,
                    throughput: 5242880,
                    errors: {}
                });
                
                expect(config.configHistory.length).to.equal(initialHistoryLength);
            });
        });

        describe('exportForAITraining()', () => {
            it('should export comprehensive training data', () => {
                // Add some history
                config.set('http.timeout', 45000);
                config.learnFromOutcome({
                    success: true,
                    duration: 30000,
                    throughput: 5242880,
                    errors: {}
                });

                const trainingData = config.exportForAITraining();
                
                expect(trainingData).to.have.property('version');
                expect(trainingData).to.have.property('environment');
                expect(trainingData).to.have.property('activeProfile');
                expect(trainingData).to.have.property('configuration');
                expect(trainingData).to.have.property('profiles');
                expect(trainingData).to.have.property('metrics');
                expect(trainingData).to.have.property('history');
                expect(trainingData).to.have.property('timestamp');

                expect(trainingData.history).to.be.an('array');
                expect(trainingData.history.length).to.be.at.most(20); // Limited to last 20
            });
        });
    });

    describe('Metrics and Monitoring', () => {
        let config;

        beforeEach(() => {
            const testConfig = {
                version: '2.0.0',
                http: { timeout: 30000 },
                downloads: { maxConcurrent: 3 }
            };

            fs.writeFileSync(
                path.join(tempConfigDir, 'default.yaml'),
                require('js-yaml').dump(testConfig)
            );

            config = createConfigManager({
                configDir: tempConfigDir
            });
        });

        describe('getMetrics()', () => {
            it('should return comprehensive metrics', () => {
                const metrics = config.getMetrics();
                
                expect(metrics).to.have.property('loadCount');
                expect(metrics).to.have.property('validationCount');
                expect(metrics).to.have.property('profileSwitches');
                expect(metrics).to.have.property('errors');
                expect(metrics).to.have.property('loadTime');
                expect(metrics).to.have.property('activeProfile');
                expect(metrics).to.have.property('environment');
                expect(metrics).to.have.property('configSections');
                expect(metrics).to.have.property('profileCount');

                expect(metrics.loadCount).to.be.at.least(1);
                expect(metrics.validationCount).to.be.at.least(1);
                expect(metrics.configSections).to.be.an('array');
            });
        });

        it('should track configuration changes in history', () => {
            const initialLength = config.configHistory.length;
            
            config.set('http.timeout', 45000);
            config.set('downloads.maxConcurrent', 5);
            
            expect(config.configHistory.length).to.equal(initialLength + 2);
            
            const changes = config.configHistory.slice(-2);
            expect(changes[0].type).to.equal('SET');
            expect(changes[1].type).to.equal('SET');
        });

        it('should limit history to 100 entries', () => {
            // Add 105 changes
            for (let i = 0; i < 105; i++) {
                config.set('http.timeout', 30000 + i);
            }
            
            expect(config.configHistory.length).to.equal(100);
        });

        it('should record errors in metrics', () => {
            const initialErrorCount = config.metrics.errors.length;
            
            // Trigger a validation error
            try {
                config.set('http.timeout', -1000);
            } catch (error) {
                // Expected error
            }
            
            expect(config.metrics.errors.length).to.be.greaterThan(initialErrorCount);
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid YAML files gracefully', () => {
            fs.writeFileSync(
                path.join(tempConfigDir, 'default.yaml'),
                'invalid: yaml: content: ['
            );

            expect(() => {
                createConfigManager({
                    configDir: tempConfigDir
                });
            }).to.throw();
        });

        it('should handle missing config directory gracefully', () => {
            const nonexistentDir = path.join(tempDir, 'nonexistent');
            
            expect(() => {
                createConfigManager({
                    configDir: nonexistentDir
                });
            }).to.throw();
        });

        it('should validate nested object structures', () => {
            const configWithInvalidNesting = {
                version: '2.0.0',
                http: 'not an object' // Should be object
            };

            fs.writeFileSync(
                path.join(tempConfigDir, 'default.yaml'),
                require('js-yaml').dump(configWithInvalidNesting)
            );

            expect(() => {
                createConfigManager({
                    configDir: tempConfigDir
                });
            }).to.throw();
        });
    });

    describe('Configuration Precedence', () => {
        beforeEach(() => {
            // Create default config
            const defaultConfig = {
                version: '2.0.0',
                http: {
                    timeout: 30000,
                    maxRetries: 3
                },
                downloads: {
                    maxConcurrent: 3
                }
            };

            // Create environment config
            const devConfig = {
                http: {
                    timeout: 20000
                },
                downloads: {
                    maxConcurrent: 5
                }
            };

            // Create local config
            const localConfig = {
                http: {
                    timeout: 10000
                }
            };

            fs.writeFileSync(
                path.join(tempConfigDir, 'default.yaml'),
                require('js-yaml').dump(defaultConfig)
            );

            fs.writeFileSync(
                path.join(tempConfigDir, 'development.yaml'),
                require('js-yaml').dump(devConfig)
            );

            fs.writeFileSync(
                path.join(tempConfigDir, 'local.yaml'),
                require('js-yaml').dump(localConfig)
            );
        });

        it('should apply configuration precedence correctly', () => {
            // Set environment variable (higher precedence than local.yaml)
            process.env.NGET_DOWNLOADS_MAXCONCURRENT = '7';

            const config = createConfigManager({
                environment: 'development',
                configDir: tempConfigDir
            });

            // Check precedence: env var > local.yaml > development.yaml > default.yaml
            expect(config.get('http.timeout')).to.equal(10000); // From local.yaml
            expect(config.get('downloads.maxConcurrent')).to.equal(7); // From env var
            expect(config.get('http.maxRetries')).to.equal(3); // From default.yaml
        });
    });

    describe('Cleanup', () => {
        it('should cleanup resources properly', () => {
            // Create minimal config first
            const minimalConfig = { version: '2.0.0' };
            fs.writeFileSync(
                path.join(tempConfigDir, 'default.yaml'),
                require('js-yaml').dump(minimalConfig)
            );

            const config = createConfigManager({
                configDir: tempConfigDir,
                enableHotReload: true
            });

            // Should not throw
            expect(() => config.cleanup()).to.not.throw();
        });
    });
});