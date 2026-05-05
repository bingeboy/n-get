# n-get Roadmap

Tracks planned features and next steps. Items are grouped by effort and dependency order. See `docs/ARCHITECTURE.md` for the reasoning behind each decision.

---

## Immediate (small, unblocked)

### Bump version to 1.6.0
- [ ] Update `package.json` `version` field from `1.5.1` → `1.6.0`

### Wire ChecksumPool into MetadataService — DONE (v1.6.1)
- [x] `lib/services/MetadataService.js` — `generateChecksums()` now delegates to `checksumPool.compute()`

---

## Tests for new core modules — DONE (v1.6.1)

All four modules now have test coverage:

| Module | Test file |
|--------|-----------|
| `lib/core/NgetEmitter.ts` | `test/ngetEmitterSpec.js` |
| `lib/core/DownloadSession.ts` | `test/downloadSessionSpec.js` |
| `lib/workers/ChecksumPool.ts` | `test/checksumPoolSpec.js` |
| `lib/cli/jobsCommands.ts` | `test/jobsCommandsSpec.js` |

---

## MCP Server (`lib/mcp/`)

`@modelcontextprotocol/sdk` is installed. `lib/mcp/` is empty.

**Goal:** expose n-get as an MCP tool so Claude Desktop, Cursor, and any MCP-compatible agent can call it without spawning a subprocess.

**Tools to expose:**
- `download_file(url, destination, options)` → streams events, returns `DownloadResult`
- `batch_download(urls, destination, options)` → runs concurrently, returns `DownloadResult[]`
- `get_jobs()` → returns active session list (wraps `readActiveSessions()`)
- `get_capabilities()` → returns capabilities JSON (wraps `CapabilitiesService`)

**Notes:**
- The `DownloadSession` event architecture maps directly to MCP streaming tool responses
- MCP server can reuse all existing typed services — no new logic needed

---

## Remaining TypeScript migration

In dependency order (each file depends on the ones above it being typed first):

| File | Blocker |
|------|---------|
| `lib/services/MetadataService.js` | None |
| `lib/services/ResilientDownloadService.js` | None |
| `lib/services/OutputFormatterService.js` | None |
| `lib/services/CapabilitiesService.js` | None |
| `lib/services/OpenAPIService.js` | CapabilitiesService |
| `lib/concurrencyLimiter.js` | None |
| `lib/resumeManager.js` | None |
| `lib/sftpManager.js` | None |
| `lib/ui.js` | None |
| `lib/recursiveCrawler.js` | None |
| `lib/recursiveDownloader.js` | recursiveCrawler |
| `lib/argv.js` | None |
| `lib/uriManager.js` | None |
| `lib/chdir.js` | None |
| `lib/cli/configCommands.js` | ConfigManager (done) |
| `lib/cli/historyCommands.js` | HistoryManager (done) |
| `lib/cli/logsCommands.js` | None |

Once all files are migrated, flip `strict: true` in `tsconfig.json` and tighten per-file.

---

## Longer term

- **Tighten TypeScript strictness** — `strict: false` today; enable per-file with `// @ts-strict` once migrated files are clean
- **Split `downloadPipeline.ts`** — 900+ lines; natural split points: HTTP downloader, SFTP delegator, progress tracker, batch orchestrator
- **`ConfigManager.get()` typed access** — currently returns `unknown`; a generic `get<T>(path, default): T` with the `NgetConfig` shape would eliminate casts throughout
- **Debounce `_flushStatus()` writes** — at high concurrency (100+ downloads) the per-progress-tick file writes add up; debounce to 500ms intervals
