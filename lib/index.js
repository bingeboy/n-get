"use strict";
/**
 * @fileoverview n-get library entry — programmatic surface for AI agents.
 *
 * Single source of truth: every export is derived from CapabilitiesService.
 * Edit data shapes there; this module is pure composition.
 *
 *   const nget = require('n-get');
 *   nget.fetch(url)        // axios-compatible HTTP fetch
 *   nget.capabilities      // same JSON as `nget --capabilities`
 *   nget.openapi           // same OpenAPI as `nget --openapi-spec`
 *   nget.instructions      // AGENTS.md content as a string
 *   nget.version           // package.json version
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ConfigManager = require('./config/ConfigManager');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const CapabilitiesService = require('./services/CapabilitiesService');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpenAPIService = require('./services/OpenAPIService');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fetchFn = require('./fetch');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const packageJson = require('../package.json');
const noopLogger = { info() { }, debug() { }, warn() { }, error() { } };
const cm = new ConfigManager({ logger: noopLogger });
const capSvc = new CapabilitiesService({ configManager: cm, logger: noopLogger });
const openSvc = new OpenAPIService({ configManager: cm, capabilitiesService: capSvc, logger: noopLogger });
const nget = {
    fetch: fetchFn,
    capabilities: capSvc.getCapabilities({ format: 'json', detailed: true }),
    openapi: openSvc.generateSpec(),
    instructions: capSvc.toMarkdown(),
    version: packageJson.version
};
module.exports = nget;
