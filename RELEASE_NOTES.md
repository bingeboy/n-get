# Release Notes - v1.13.0

## Overview
Full TypeScript migration complete. Dropped legacy recursive web crawling — n-get is now purely agentic. A2A discovery leads the docs.

## Changes

### TypeScript migration complete
All 14 remaining JS-only files migrated to TypeScript. The entire `lib/` directory is now TS-sourced. No more `.js`-only modules.

### Dropped: recursive web crawling
`lib/recursiveCrawler` + `lib/recursiveDownloader` deleted (~1,000 lines). Removed CLI flags: `--recursive` / `-R`, `--level`, `--no-parent` / `-np`, `--accept`, `--reject`. Agents receive explicit URLs from the LLM — HTML crawling is a legacy wget workflow with no place in an agentic tool.

### Docs
- A2A 0.3.0 discovery now leads both the README and site (above MCP)
- `.gitignore` updated to exclude stray download artifacts

## Breaking Changes
`--recursive` / `-R` removed. No migration path — use explicit URL lists instead.

## Tests
479 passing, 0 failing — unchanged.

---

**Full Changelog**: [Compare v1.12.0...v1.13.0](https://github.com/bingeboy/n-get/compare/v1.12.0...v1.13.0)

---

# Release Notes - v1.12.0

## Overview
Reliable webhook delivery and better docs for the agent-discovery story. Webhook receivers that are temporarily unavailable now get retried automatically. A2A 0.3.0 discovery gets its own section in the README and site.

## New Features

### Webhook retry with exponential backoff
- 3 attempts total per webhook POST: immediate → 500 ms → 1000 ms
- Retries on: network errors, HTTP 5xx
- No retry on: HTTP 4xx (client error, won't recover)
- Intermediate failures are silent; only final failure logs to stderr
- Each attempt gets a fresh 2s timeout — `flush()` behavior unchanged
- Constants (`MAX_ATTEMPTS`, `BACKOFF_MS`) are module-level in `EventSink` — configurable retry via `config/default.yaml` is tracked for a future release

## Improvements
- README: new `## A2A discovery` section explaining the agent card, how to serve it, and the `get_agent_card` MCP tool
- Site: dedicated A2A section between MCP tools and events

## Breaking Changes
None.

## Tests
479 passing, 0 failing (4 new in `test/webhookRetrySpec.js`).

---

**Full Changelog**: [Compare v1.11.0...v1.12.0](https://github.com/bingeboy/n-get/compare/v1.11.0...v1.12.0)

---

# Release Notes - v1.11.0

## Overview
Agent security and discovery. Webhook receivers can now verify every n-get event is authentic (HMAC-SHA256 signing), and any A2A 0.3.0-compatible orchestrator can discover and invoke n-get from a standard agent card.

## New Features

### HMAC webhook signing (`--webhook-secret`)
- `--webhook-secret <secret>` — signs every webhook POST with `X-NGet-Signature: sha256=<hmac-hex>` using `node:crypto`. No new dependency.
- `webhooks.secret: ''` in `config/default.yaml` for persistent config.
- Empty/absent secret = no header added (fully backwards compatible).
- `--capabilities` reports `webhooks.signing: 'hmac-sha256'`.

Receiver verification (one `timingSafeEqual` call):
```js
const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
const valid = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
```

### A2A 0.3.0 agent card (`--agent-card`, `get_agent_card`)
- `nget --agent-card` — outputs A2A 0.3.0 JSON to stdout. Serve at `/.well-known/agent.json` via Cloudflare Workers, nginx, etc.
- `get_agent_card` MCP tool — 10th MCP tool; returns the same JSON for orchestrators running over MCP.
- Card is generated from `CapabilitiesService` — never drifts from actual capabilities.
- `--capabilities` gains a `discovery.a2a` subsection.
- Skills: `download`, `batch_download`, `fetch` — map 1:1 to MCP tools.

## Breaking Changes
None. All CLI flags, NDJSON event names, library exports, and MCP tool names from 1.10.x are unchanged.

## Tests
475 passing, 0 failing (up from 449 — 26 new tests across `test/webhookSigningSpec.js` and `test/a2aCardSpec.js`).

---

**Full Changelog**: [Compare v1.10.2...v1.11.0](https://github.com/bingeboy/n-get/compare/v1.10.2...v1.11.0)

---

# Release Notes - v1.10.2

## Overview
Patch. Homepage URL updated from the defunct GitHub Pages address to the live Cloudflare Pages site.

## Changes
- `package.json` `homepage`: `bingeboy.github.io/n-get` → `n-get.design-87b.workers.dev`
- `site/index.html` added to master for Cloudflare Pages auto-deploy

## Breaking Changes
None.

---

**Full Changelog**: [Compare v1.10.1...v1.10.2](https://github.com/bingeboy/n-get/compare/v1.10.1...v1.10.2)

---

# Release Notes - v1.10.1

## Overview
Patch release. No feature or API changes. Fixes 6 Dependabot security alerts (all devDependencies, never exposed to npm consumers) and replaces a stale README with accurate 1.10.0 documentation.

## Changes

- **README overhaul** — quick start fixed (`nget --stdout` never existed; replaced with `nget fetch`), webhook flags documented, all 12 NDJSON events listed (including `fetch_start/complete/error`), all 9 MCP tools listed, programmatic API path corrected (`require('n-get/lib/fetch')` → `const { fetch } = require('n-get')`), logo replaced with Zalgo ASCII heading
- **Security: prune orphaned mocha tree** — mocha was removed from `package.json` during the 1.10.0 vitest migration but left in `node_modules`; `npm prune` removed it and its transitive dep `serialize-javascript` (high-severity RCE + DoS CVEs)
- **Security: update transitive devDeps** — `npm audit fix` updated `hono`, `express-rate-limit`, `ip-address`; 0 vulnerabilities remaining

## Breaking Changes
None.

## Tests
449 passing, 0 failing — unchanged from 1.10.0.

---

**Full Changelog**: [Compare v1.10.0...v1.10.1](https://github.com/bingeboy/n-get/compare/v1.10.0...v1.10.1)

---

# Release Notes - v1.10.0

## Overview
Largest feature release since 1.7.0. Four additions land together: auto-generated `--help` (no more drift), webhook event forwarding for AI observability, five new MCP tools for agent-side session control, and a Vitest migration that cuts cold test time in half. All additive — no breaking changes.

## New Features

### Webhook event forwarding (`--webhook`)
Every NDJSON event n-get emits (session_start, download_start, progress, download_complete, etc.) is now POSTed to configurable URLs in real time — fire-and-forget, 2 s timeout, best-effort. Pairs with any event store or agent orchestrator.

- `--webhook <url>` (repeatable) — POST events to one or more receivers
- `--webhook-header 'Name: value'` (repeatable) — custom headers on all POSTs
- `--webhook-events <comma-list>` — filter to specific event types only
- `webhooks.default` in config for persistent per-machine webhook registration
- `nget fetch` now emits `fetch_start`, `fetch_complete`, `fetch_error` through the same sink — API calls are as observable as file downloads
- `NgetEmitter.flush()` — drains in-flight POSTs before process exit (prevents lost events on fast `nget fetch` calls)
- `--capabilities` reports `agentIntegration.eventDriven.webhooks: "supported"` and `discovery.webhooks` subsection

### 5 new MCP tools
The MCP server grows from 4 tools to 9. New tools give agents direct session control without subprocess spawning:

| Tool | What it does |
|---|---|
| `cancel_session(sessionId)` | Kills a specific download session; others continue |
| `get_session(sessionId)` | Returns full current state of one session |
| `set_profile(profileName)` | Applies fast/secure/bulk/careful config profile process-wide |
| `get_history(destination?, limit?, status?, since?)` | Flat MCP-schema download history |
| `get_instructions()` | Returns AGENTS.md — the agent usage guide |

Session cancellation is in-process and immediate: `cancel_session` sets a flag checked between downloads in any active batch; other sessions are unaffected.

### Auto-generated `--help` (no more drift)
`CapabilitiesService.getCLIFlags()` is now the single source of truth for all 32 CLI flags. `toHelpSummary()` derives `--help` output from it directly — the same way `toMarkdown()` drives AGENTS.md. A drift-guard test asserts every flag in `getCLIFlags()` appears in `--help` stdout.

### Vitest migration
Test runner replaced mocha + chai with Vitest. Cold run time: ~2 s (was ~8 s). Vitest globals (`describe`, `it`, `expect`, `beforeAll`, `afterAll`) available without imports; mocha-compat aliases (`before`/`after`) provided via setup file.

## Bug fixes
- `test/chdirSpec.js`, `test/getDestinationSpec.js`: replaced hardcoded `temp/` directory assumption with `fs.mkdtempSync` — tests were failing in any checkout where the `temp/` dir didn't exist

## Breaking Changes
None. All CLI flags, NDJSON event names, library exports, and MCP tool names from 1.9.1 are unchanged.

## Tests
449 passing, 0 failing (up from 420 in 1.8.0).

---

**Full Changelog**: [Compare v1.9.1...v1.10.0](https://github.com/bingeboy/n-get/compare/v1.9.1...v1.10.0)

---

# Release Notes - v1.8.0

## Overview
Closes out the TypeScript migration for `lib/services/` started in 1.6.0, and locks down the public CLI contract (`--help`, `--capabilities`, `--openapi-spec`) with structural tests. Internal-only refactor — no public-surface changes.

## 🚀 New Features
- **`lib/services/` TypeScript migration complete** — `MetadataService`, `ResilientDownloadService`, `OutputFormatterService`, `CapabilitiesService`, `OpenAPIService` all ported to `.ts` in dependency order. Pure migration, no logic changes. Every service in the directory is now TS-sourced.
- **CLI contract tests** (`test/cliOutputContractSpec.js`) — 20 structural assertions on `--help`, `--capabilities`, and `--openapi-spec` output. Strong-patterns approach: catches real regressions (missing flag, malformed JSON, version mismatch); tolerates cosmetic edits (spacing, emoji, copy tweaks).
- **AGENTS.md freshness test** is now line-ending tolerant (Windows checkouts with `core.autocrlf=true` no longer fail the drift guard for cosmetic reasons).

## 🔧 Developer Experience
- 5 service files now type-checked (loosely — project-wide `strict: false` remains; per-file tightening is a separate future concern).
- Test count: 420 passing (was 400 in 1.7.0; +20 new CLI contract assertions).

## 💔 Breaking Changes
None. CLI surface, library exports, NDJSON event names, and all flag contracts unchanged. `require('n-get')` still returns `{ fetch, capabilities, openapi, instructions, version }`.

## Versioned surface (per SemVer)
No public-surface changes. SemVer minor bump for the new test infrastructure (additive) and the internal refactor.

---

**Full Changelog**: [Compare v1.7.0...v1.8.0](https://github.com/bingeboy/n-get/compare/v1.7.0...v1.8.0)

---

# Release Notes - v1.7.0

## Overview
Closes the agent self-discovery gap. n-get now ships a single-source-of-truth agent doc pipeline: every agent-facing surface (`AGENTS.md`, `nget instructions`, `nget --capabilities`, `nget --openapi-spec`, the programmatic `require('n-get')` object) derives from `CapabilitiesService`. Edit one place; everything regenerates.

## 🚀 New Features
- **`require('n-get')` library entry**: programmatic surface now returns `{ fetch, capabilities, openapi, instructions, version }`. Node-side agents can introspect the full tool contract without invoking the CLI or reading source. (`lib/index.ts` → `lib/index.js`)
- **`nget instructions` subcommand**: prints `AGENTS.md` to stdout. Short-circuits before config init so output is clean Markdown with no log noise.
- **`AGENTS.md`** at the package root: auto-generated by `npm run build:docs` from `CapabilitiesService.toMarkdown()`. Single source of truth — drift is caught by `test/agentsMdFreshnessSpec.js`.
- **`CapabilitiesService.getDiscoveryInfo()`**: new `discovery` section in `--capabilities` output documenting the four discovery commands (`--help`, `--capabilities`, `--openapi-spec`, `nget-mcp`), the full NDJSON event list, and tty/non-tty/`--human` output mode contracts.
- **`examples.canonical`**: 5 copy-pasteable single-line examples covering the most common agent use cases.
- **`--help` text** now leads with an "AI agents — start here:" block pointing at the four discovery surfaces.
- **`isInfoOnlyFlag`**: `--capabilities` and `--openapi-spec` now suppress config-load logs so their stdout is clean machine-readable output even outside a quiet flag.

## 🔧 Developer Experience
- **`npm run build`**: now runs `tsc && node scripts/gen-agents-md.js`. AGENTS.md regenerates as part of the build.
- **`npm run build:docs`**: regenerate AGENTS.md alone.
- **`files` field in `package.json`**: tarball now ships only the intentional surface (source, compiled output, types, config, AGENTS.md, README, LICENSE). No more accidental inclusion of arbitrary working-tree files.

## 🧪 Tests
- 32 new unit tests across `test/capabilitiesServiceSpec.js`, `test/libraryEntrySpec.js`, `test/instructionsCommandSpec.js`, and `test/agentsMdFreshnessSpec.js`. Total: 400 passing.

## 💔 Breaking Changes
- **`package.json` `main`** switched from `index.js` (CLI shebang) to `lib/index.js` (library entry). `require('n-get')` now returns an object instead of executing the CLI as a side-effect of `require()`. The CLI `bin` (`nget`, `nget-mcp`) is unchanged. Programmatic callers who previously used `require('n-get/lib/fetch')` should migrate to `require('n-get').fetch`.

## Agent contract — versioned surface
The agent-facing contract (now formalized in CLAUDE.md per SemVer):
- `nget --capabilities` JSON schema — versioned
- `nget --openapi-spec` OpenAPI 3.0.3 — versioned
- NDJSON event names — versioned
- `--agent-id` / `--session-id` / `--request-id` / `--conversation-id` flags — versioned
- `require('n-get')` library exports (the 5 keys above) — versioned

---

**Full Changelog**: [Compare v1.6.0...v1.7.0](https://github.com/bingeboy/n-get/compare/v1.6.0...v1.7.0)

---

# Release Notes - v1.6.0

## Overview
This release migrates the codebase to TypeScript, introduces a machine-readable NDJSON event stream as the default output mode, and adds several agent-focused features including isolated download sessions, a worker-thread checksum pool, and multi-process job visibility.

## 🚀 New Features
- **TypeScript Migration**: Full codebase migrated from JavaScript to TypeScript. `tsc` outputs `.js` alongside `.ts` in-place — no separate `dist/` directory. Migrated files include `DownloadError`, `ipv6Utils`, `Logger`, `HistoryManager`, `SecurityService`, `ConfigManager`, `downloadPipeline`, `index`, plus new TypeScript files for workers and CLI.
- **DownloadSession**: New `lib/core/DownloadSession.ts` replaces module-level globals in the download pipeline. Each CLI invocation gets an isolated session owning its own `Logger`, `SecurityService`, and `MetadataService` instances, eliminating cross-call state contamination.
- **NDJSON Event Stream**: `lib/core/NgetEmitter.ts` emits structured newline-delimited JSON to stdout by default, covering the full download lifecycle. Agents can parse output directly without screen-scraping.
- **Human Mode**: `--human` flag (or automatic TTY detection) enables progress bars and banners. Without it, output is machine-readable NDJSON. Pipe mode (`-o -`) always sends events to stderr.
- **`nget jobs` Command**: New subcommand lists all active download sessions across processes. Reads `~/.nget/active/*.json` and prunes dead PIDs automatically — useful for multi-agent visibility.
- **ChecksumPool**: `lib/workers/ChecksumPool.ts` + `ChecksumWorker.ts` implement a worker-thread pool for CPU-bound hash computation (MD5/SHA256), keeping the event loop free during checksum calculation on large files.
- **`--agent-id` Flag**: Lets the calling agent identify itself in session metadata and active session files.
- **Shared Types**: `types/index.ts` is the single source of truth for all TypeScript interfaces across the codebase.

## 🔧 Developer Experience
- **TypeScript**: Full type safety across the codebase with strict compilation
- **Worker Threads**: Offload CPU-bound checksum work to a managed thread pool
- **Isolated Sessions**: No shared mutable state between concurrent CLI invocations

## 💔 Breaking Changes
- Default output is now NDJSON (machine-readable). Pass `--human` or run in a TTY to restore progress bars and banners.

---

**Full Changelog**: [Compare v1.5.x...v1.6.0](https://github.com/bingeboy/n-get/compare/v1.5.1...v1.6.0)

---

# Release Notes - v1.3.0

## Overview
This release focuses on improving code quality, performance, and maintainability while removing legacy code and hardcoded values.

## 🚀 New Features
- **AI Integration**: Added experimental AI integration capabilities for enhanced functionality
- **Configuration Management**: Implemented proper configuration management system replacing hardcoded values

## 🐛 Bug Fixes
- Updated and fixed test suite for better reliability
- Improved error handling across the application
- Enhanced security measures and logging capabilities

## ⚡ Performance Improvements
- Significant performance optimizations implemented
- Code cleanup and removal of legacy "vibe coding" patterns

## 🔧 Developer Experience
- **Linting**: Added comprehensive linting rules and JSDoc documentation
- **Testing**: Updated test suite with improved coverage and reliability
- **Configuration**: Added proper configuration management with YAML support
- **Documentation**: Enhanced documentation with AI integration guides

## 📦 Dependencies
- Updated to require Node.js >= 18.0.0
- Added new dependencies:
  - `joi` for configuration validation
  - `js-yaml` for YAML configuration support
  - `cli-progress` for better progress indication
- Updated existing dependencies for security and performance

## 🗂️ Files Changed
- Configuration system overhaul (`config/` directory)
- Core application logic improvements (`index.js`, `lib/` directory)
- Enhanced testing framework
- Updated documentation

## 💔 Breaking Changes
- Minimum Node.js version bumped to 18.0.0
- Removed hardcoded configuration values (migration to YAML config required)

## 🙏 Contributors
Thanks to all contributors who helped make this release possible!

---

**Full Changelog**: [Compare v1.2.x...v1.3.0](https://github.com/bingeboy/n-get/compare/v1.2.0...v1.3.0)