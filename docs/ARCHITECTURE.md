# n-get Architecture & Design Decisions

This document records why the architecture looks the way it does, what problems each decision solves, and where the project is heading. It is written for contributors and agents working on this codebase, not as marketing material.

---

## Table of Contents

1. [Project Purpose](#1-project-purpose)
2. [What We Found](#2-what-we-found)
3. [Core Design Principles](#3-core-design-principles)
4. [Decision Log](#4-decision-log)
   - [Agent-only design, CLI stays](#41-agent-only-design-cli-stays)
   - [No embedded database](#42-no-embedded-database)
   - [No persistent daemon](#43-no-persistent-daemon)
   - [NDJSON event stream as primary output](#44-ndjson-event-stream-as-primary-output)
   - [File-based active session state](#45-file-based-active-session-state)
   - [Worker threads for checksums only](#46-worker-threads-for-checksums-only)
   - [DownloadSession replaces module globals](#47-downloadsession-replaces-module-globals)
   - [Human mode behind a flag](#48-human-mode-behind-a-flag)
5. [Current Architecture](#5-current-architecture)
   - [Directory structure](#51-directory-structure)
   - [Request lifecycle](#52-request-lifecycle)
   - [Event schema](#53-event-schema)
   - [Active session state](#54-active-session-state)
6. [What Is Not Done Yet](#6-what-is-not-done-yet)
7. [TypeScript Migration](#7-typescript-migration)
8. [Scale Path](#8-scale-path)

---

## 1. Project Purpose

n-get is a file download tool whose primary consumers are AI agents. Agents call it via subprocess CLI. The tool downloads files, reports exactly what happened in a machine-readable format, and gets out of the way.

It is not a download manager for humans. It is not a server. It is not an orchestration layer. Humans can use it, but the design optimizes for agent consumption.

---

## 2. What We Found

Before the current work, n-get was at v1.5.1 with 189 passing tests and solid core functionality: HTTP/HTTPS, SFTP, resume, recursive crawl, concurrency. The download engine worked. The problems were structural.

**Global mutable state in `downloadPipeline.js`**

```js
let logger = null;
let securityService = null;
let historyManager = null;
let metadataService = null;
let outputFormatter = null;

function initializeServices(options) {
    logger = new Logger(...)
    // ...
}
```

Every call to `downloadFile()` mutated module-level variables. If two agent processes happen to share a Node module cache (e.g. via `npm link` or certain test runners), they stomp each other. More importantly, this pattern makes the code impossible to reason about: service state bleeds between calls, and there is no clear owner for cleanup.

**Output mixed human UI with structured data**

`downloadPipeline.js` called `ui.displayBanner()`, `ui.displayDownloadStart()`, `ui.displaySummary()` directly. An agent calling `nget` and trying to parse stdout would get emoji-decorated terminal output mixed in with any structured data. The `--output-format json` flag existed but was only applied at the end of a batch, not to the in-progress stream.

**No cross-agent visibility**

Each invocation was completely isolated. Agent A had no way to know Agent B was downloading the same file, saturating a connection, or had already completed a job.

**Checksums computed on the main thread**

MD5 and SHA256 of large files are CPU-bound operations. Running them on the event loop blocks all concurrent I/O for the duration. On a 1 GB file this is measurable.

**`lib/mcp/` was empty**

The MCP SDK was a declared dependency but nothing was implemented. The AI integration docs referenced features that did not exist.

---

## 3. Core Design Principles

**Do one thing.** n-get downloads files. State management, orchestration, visibility across runs — those are someone else's problem. Other tools compose around n-get; n-get does not try to absorb them.

**Emit events, not presentation.** Every significant action emits a structured JSON event to stdout. Callers decide what to do with it. Log it, aggregate it, display it, ignore it — not n-get's concern.

**No infrastructure dependencies.** The tool works with zero setup beyond Node.js. No database, no daemon, no network service required to run it.

**CLI is the correct agent interface.** Agents call CLI tools via subprocess. This is not a limitation to work around; it is a feature. Process isolation means a crashed download does not take down the calling agent. Stdin/stdout/exit codes are a universal contract. Keep the CLI.

**State isolation per invocation.** Every agent call gets its own context. Nothing is shared between calls except the files on disk.

---

## 4. Decision Log

### 4.1 Agent-only design, CLI stays

**Decision:** Design entirely for agent consumption. Keep the CLI interface unchanged.

**Why:** An AI agent calling `nget https://example.com/file.zip --output-format json` is already using it correctly. The CLI *is* the agent interface. Subprocess calls give agents process isolation and a universal contract (stdin, stdout, exit code) that works across every language and framework.

What we removed is not the CLI but the assumption that a human is watching. The default output should be parseable, not pretty.

**What changed:** Added `--human` flag. Eventually (next step) the default flips: NDJSON on non-TTY stdout, human rendering on TTY stdout.

---

### 4.2 No embedded database

**Decision:** Do not add SQLite or any database to n-get.

**Why:** A database ties the tool to infrastructure it should not own. It creates a setup step. It creates a migration concern. It creates a lock file that complicates concurrent access from multiple agent processes. It turns a composable CLI tool into a stateful service.

The tool already has two forms of durable state, both written under the
download destination rather than the home directory, so a run's record travels
with its files:
- `<destination>/.nget/nget.history` — JSONL append log of completed downloads
- `<destination>/.nget/<md5>.nget-meta` — resume metadata files per URL

Recursive downloads recreate a directory tree beneath the destination, but
their history still collects in the destination's own `.nget/` — `nget history`
reads exactly one directory.

Both are simple files. They compose naturally with `tail`, `grep`, `jq`, or any log aggregator the caller wants to use. A database would break this composability.

**Cross-agent visibility without a database:** Active session status files (see 4.5).

---

### 4.3 No persistent daemon

**Decision:** n-get does not run a background process.

**Why:** A daemon is a single point of failure. It requires lifecycle management (start, stop, restart, PID files). It complicates packaging, testing, and deployment. It introduces IPC complexity.

The cross-agent visibility requirement (Agent B can see what Agent A is downloading) does not require a daemon. It requires a shared readable location that active processes write to. Files in `~/.nget/active/` satisfy this with zero infrastructure. Any process can read them with `fs.readdirSync`.

If the scale requirement eventually exceeds what file-based state can handle, the right move is to put a real coordinator *in front of* n-get — a job queue, a supervisor, a platform service — not to make n-get itself into a server.

---

### 4.4 NDJSON event stream as primary output

**Decision:** All structured output is newline-delimited JSON written to stdout (or stderr when piping file content).

**Why NDJSON over other formats:**

- **Streamable.** Agents can process events as they arrive without waiting for the download to finish. A batch of 100 files can be monitored in real time.
- **Composable.** `nget <url> | jq 'select(.event == "download_complete")'` works with no special tooling.
- **Unambiguous.** One event per line. No need to buffer partial JSON, handle arrays, or parse document boundaries.
- **Language-agnostic.** Every language has a JSON parser. No custom format to implement.

**Why not the existing `--output-format json` flag:**

That flag formatted the final batch summary as a JSON object. It did not stream in-progress events. An agent calling nget in batch mode had no visibility until all files finished. With NDJSON events, every `download_start`, `progress`, `download_complete`, and `download_error` arrives as it happens.

**The event contract:**

Every event shares a base structure: `{ event, ts, session, ...payload }`. The `session` field ties all events from one invocation together. An agent monitoring multiple concurrent nget processes can filter by session ID.

---

### 4.5 File-based active session state

**Decision:** Each running session writes `~/.nget/active/{sessionId}.json`. `nget jobs` reads this directory.

**Why files over a database or shared memory:**

- Zero dependencies. Any process can read a directory.
- Crash-safe. If a process dies without cleanup, the file persists as evidence. `pruneDeadSessions()` removes stale files by checking whether the recorded PID still exists.
- Natural TTL. The file is created on session start and deleted on session end. `~/.nget/active/` being empty means nothing is running.
- Observable by anything. `ls ~/.nget/active/`, `watch cat ~/.nget/active/*.json`, pipe to any monitoring tool.

**The status file schema:**

```json
{
  "sessionId": "sess_1746389247_a3b4c5d6",
  "startTime": "2025-05-04T18:00:00.000Z",
  "agent": "agent-pipeline-3",
  "pid": 12345,
  "downloads": {
    "https://example.com/file.zip": {
      "status": "active",
      "bytes_received": 524288,
      "bytes_total": 1048576,
      "speed_bps": 2097152,
      "updatedAt": "2025-05-04T18:00:03.412Z"
    }
  }
}
```

Status files are written with `fs.writeFile` (fire-and-forget). They never block a download.

---

### 4.6 Worker threads for checksums only

**Decision:** Use `worker_threads` for MD5/SHA256 computation. Do not use worker threads for downloads.

**Why not worker threads for downloads:**

Downloads are I/O-bound. Node's event loop handles concurrent I/O natively and efficiently. A 20-connection HTTP download saturates a gigabit link without ever needing a worker thread. Adding worker threads to I/O work adds IPC overhead, complexity, and serialization cost with no throughput benefit. The existing `ConcurrencyLimiter` semaphore pattern is the correct tool for controlling concurrent downloads.

**Why worker threads for checksums:**

Checksums are CPU-bound. `crypto.createHash('sha256')` running on a 1 GB file processes every byte through a hash function on the main thread, blocking all event loop callbacks for the duration. On the main thread this stalls progress updates, history writes, and any other concurrent download's I/O callbacks.

A worker thread runs the hash computation in a separate V8 isolate, off the event loop. The main thread remains responsive.

**The pool design:**

`ChecksumPool` limits concurrent workers to `min(cpus, 4)`. Each job creates a fresh worker, runs to completion, and terminates. There is no worker reuse — checksum jobs are infrequent relative to their duration, so startup cost is negligible and avoiding stale state across jobs is worth it. Pending jobs queue until a slot opens.

```
main thread          worker thread
    │                     │
    ├─ compute(file) ──→  │ hash.update(chunk) × N
    │                     │
    │  ←── checksums ─────┤
    │                  terminate
```

---

### 4.7 DownloadSession replaces module globals

**Decision:** `DownloadSession` owns `Logger`, `SecurityService`, and `MetadataService` for one invocation. Module-level globals are removed from `downloadPipeline.js`.

**Why:** Module globals are a concurrency bug waiting to happen and a testing liability. When `initializeServices()` runs, it mutates `let logger = null` at module scope. In any environment where the module is required once and reused across calls (test runners, `npm link`, certain import caching scenarios), calls interfere with each other.

`DownloadSession` makes the ownership explicit: one session per CLI invocation, one set of services per session, garbage collected when the session ends.

**Session sharing within a batch:**

A `download()` batch call creates one session and passes it down to every `downloadFile()` call via `options._session`. All files in a batch share the same logger context, the same correlation tracking, and the same status file. This is correct: a batch is one logical operation.

**Single-file calls (public API):**

`downloadFile()` called without a session creates its own. Backward compatibility is maintained.

---

### 4.8 Human mode behind a flag

**Decision:** `--human` enables terminal UI rendering. Default output is NDJSON.

**Why not the other way around:**

The tool is designed for agents. Agents do not benefit from progress bars, ANSI colors, or emoji banners on stdout. They benefit from parseable events. Making NDJSON the default and human rendering opt-in reflects the primary use case.

**TTY detection:**

When stdout is a TTY (a human is watching in a terminal without piping), `humanMode` defaults to `true` even without `--human`. This means running `nget https://example.com/file.zip` in a terminal still renders a progress bar. Running it from an agent subprocess (no TTY) automatically uses NDJSON. No flag required for the common cases.

**Pipe mode:**

When `-o -` is used (file content to stdout), events go to stderr regardless of human/agent mode. stdout belongs to the file content.

---

## 5. Current Architecture

### 5.1 Directory structure

```
n-get/
├── index.ts                        ← CLI entry point, arg parsing, command routing
├── types/
│   └── index.ts                    ← Single source of truth for all shared TypeScript types
├── lib/
│   ├── core/
│   │   ├── NgetEmitter.ts          ← NDJSON event stream; human rendering in --human mode
│   │   └── DownloadSession.ts      ← Per-invocation context; owns services; writes status file
│   ├── workers/
│   │   ├── ChecksumWorker.ts       ← Worker thread script (runs in separate V8 isolate)
│   │   └── ChecksumPool.ts         ← Thread pool manager; singleton per process
│   ├── cli/
│   │   ├── configCommands.js       ← nget config ...
│   │   ├── historyCommands.js      ← nget history ...
│   │   ├── logsCommands.js         ← nget logs ...
│   │   └── jobsCommands.ts         ← nget jobs (cross-agent visibility)
│   ├── config/
│   │   └── ConfigManager.ts        ← YAML config, profiles, env var merging
│   ├── services/
│   │   ├── Logger.ts               ← Structured logging (JSON/CSV/text)
│   │   ├── SecurityService.ts      ← URL/path validation, rate limiting
│   │   ├── MetadataService.js      ← File metadata, checksums, HTTP headers (pending migration)
│   │   ├── OutputFormatterService.js ← Batch result formatting (pending migration)
│   │   ├── CapabilitiesService.js  ← --capabilities flag output (pending migration)
│   │   ├── OpenAPIService.js       ← --openapi-spec flag output (pending migration)
│   │   └── HistoryManager.ts       ← ~/.nget/nget.history JSONL
│   ├── errors/
│   │   └── DownloadError.ts        ← Structured error with codes, severity, recovery actions
│   ├── downloadPipeline.ts         ← Core download orchestration (HTTP + SFTP)
│   ├── resumeManager.js            ← Partial download state, range request logic (pending)
│   ├── sftpManager.js              ← SSH/SFTP downloads (pending migration)
│   ├── recursiveDownloader.js      ← Recursive site download (pending migration)
│   ├── recursiveCrawler.js         ← HTML/CSS link extraction (pending migration)
│   ├── concurrencyLimiter.js       ← Semaphore for max concurrent downloads (pending)
│   ├── ui.js                       ← Terminal rendering (progress bars, banners) (pending)
│   └── utils/
│       └── ipv6Utils.ts            ← IPv6 address parsing and validation
├── config/
│   ├── default.yaml
│   ├── development.yaml
│   ├── production.yaml
│   └── test.yaml
├── tsconfig.json                   ← In-place compilation: .ts → .js alongside source
├── docs/
│   ├── ARCHITECTURE.md             ← this file
│   └── AI-INTEGRATION.md
└── test/
```

**State on disk:**

```
~/.nget/                            ← global, one per machine
└── active/
    └── sess_<id>.json              ← written while session runs, deleted on end

<destination>/.nget/                ← per destination, alongside the files
├── nget.history                    ← JSONL append log of completed downloads
└── <md5>.nget-meta                 ← resume metadata per URL (written by resumeManager)
```

---

### 5.2 Request lifecycle

```
nget https://example.com/file.zip --session-id agent-abc

index.js
  └─ parse argv
  └─ init ConfigManager
  └─ call download(urls, destination, options)

downloadPipeline.download()
  └─ create DownloadSession
       ├─ build Logger, SecurityService, MetadataService
       └─ write ~/.nget/active/sess_<id>.json
  └─ emitter.sessionStart()          → stdout: {"event":"session_start",...}
  └─ queue all URLs in status file
  └─ ConcurrencyLimiter × N

  per URL:
    └─ downloadFile(url, ..., { _session: session })
         └─ security.validateDownloadRequest()
         └─ emitter.downloadStart()    → stdout: {"event":"download_start",...}
         └─ fetch() + stream pipeline
              └─ Transform stream:
                   ├─ update progress bar (human mode)
                   └─ emitter.progress() every ~1s  → stdout: {"event":"progress",...}
         └─ emitter.downloadComplete() → stdout: {"event":"download_complete",...}
         └─ session.completeDownload() → update status file

  └─ session.end()
       ├─ emitter.sessionEnd()        → stdout: {"event":"session_end",...}
       └─ delete ~/.nget/active/sess_<id>.json
```

---

### 5.3 Event schema

All events: `{ event: string, ts: number, session: string, ...payload }`

| Event | Key payload fields |
|---|---|
| `session_start` | `sessionId`, `startTime`, `agent`, `pid` |
| `download_queued` | `url` |
| `download_start` | `url`, `filename`, `bytes_total`, `index`, `total`, `resumed`, `resume_from` |
| `progress` | `url`, `bytes_received`, `bytes_total`, `speed_bps`, `pct` |
| `checksum_start` | `file`, `algorithms` |
| `checksum_complete` | `file`, `checksums` |
| `download_complete` | `url`, `filename`, `file`, `size`, `duration_ms`, `speed_bps`, `resumed` |
| `download_error` | `url`, `error`, `code`, `retryable` |
| `warning` | `message`, `url`, `code` |
| `info` | `message` |
| `session_end` | `stats.total`, `stats.success`, `stats.errors`, `stats.bytes`, `stats.duration`, `stats.avg_speed`, `stats.file_paths` |

---

### 5.4 Active session state

**Writing:** `DownloadSession._flushStatus()` is called on `start()`, `queueDownload()`, `updateDownload()`, `completeDownload()`, and `failDownload()`. Writes are `fs.writeFile` (async, fire-and-forget) — they never block the download stream.

**Reading:** `nget jobs` calls `readActiveSessions()` which reads all `~/.nget/active/*.json` files. It calls `pruneDeadSessions()` first to remove files left by crashed processes. Dead process detection uses `process.kill(pid, 0)` which returns without sending a signal — it only checks whether the PID exists.

**Crash recovery:** If n-get crashes without calling `session.end()`, the status file persists. The next `nget jobs` call will prune it if the PID is gone. There is no stale data window where a dead session appears active longer than the next `nget jobs` call.

---

## 6. What Is Not Done Yet

### 6.1 Wire ChecksumPool into MetadataService

`MetadataService.generateChecksums()` currently computes hashes synchronously on the main thread. The pool and worker are built — this is a one-method change:

```js
// MetadataService.js — target
const { checksumPool } = require('../workers/ChecksumPool');

async generateChecksums(filePath, algorithms = ['md5', 'sha256']) {
    return checksumPool.compute(filePath, algorithms);
}
```

### 6.2 Wire up `lib/mcp/`

`@modelcontextprotocol/sdk` is installed. `lib/mcp/` is empty. The MCP server should expose `download_file`, `batch_download`, `get_jobs`, and `get_capabilities` tools so n-get works with Claude Desktop, Cursor, and any MCP-compatible agent without subprocess calls.

The session and event architecture maps directly to MCP tool responses.

### 6.3 Add tests for new modules

These modules have no tests yet:

| Module | Priority test cases |
|--------|-------------------|
| `lib/core/NgetEmitter.ts` | Emits valid NDJSON; human mode writes to stderr not stdout |
| `lib/core/DownloadSession.ts` | Creates/deletes status file; prunes dead sessions |
| `lib/workers/ChecksumPool.ts` | Correct checksums for known inputs; respects max concurrency |
| `lib/cli/jobsCommands.ts` | Correct NDJSON output for active sessions |

### 6.4 Migrate remaining JS files to TypeScript

The following files are still `.js` — pending migration in order of dependency:

1. `lib/services/MetadataService.js`
2. `lib/services/OutputFormatterService.js`
4. `lib/services/CapabilitiesService.js`
5. `lib/services/OpenAPIService.js`
6. `lib/resumeManager.js`
7. `lib/concurrencyLimiter.js`
8. `lib/sftpManager.js`
9. `lib/ui.js`
10. `lib/recursiveCrawler.js` + `lib/recursiveDownloader.js`
11. `lib/cli/configCommands.js`, `historyCommands.js`, `logsCommands.js`

---

## 7. TypeScript Migration

**Status: core migration complete.**

The `tsconfig.json` uses in-place compilation (`outDir: "."`) so `.ts` files compile to `.js` alongside the source. Existing `require()` calls in un-migrated JS files continue to work without changes.

**Migrated (as of v1.6.0):**

| File | Notes |
|------|-------|
| `types/index.ts` | Shared type definitions — single source of truth |
| `lib/core/NgetEmitter.ts` | Full event type system, discriminated union |
| `lib/core/DownloadSession.ts` | Session lifecycle, active status files |
| `lib/workers/ChecksumWorker.ts` | Worker thread entry point |
| `lib/workers/ChecksumPool.ts` | Thread pool, queuing, singleton export |
| `lib/cli/jobsCommands.ts` | `nget jobs` subcommand |
| `lib/errors/DownloadError.ts` | Severity, category, recovery actions fully typed |
| `lib/utils/ipv6Utils.ts` | Pure utility functions |
| `lib/services/Logger.ts` | `LogLevel`, `LogFormat`, `LoggerConfig` from shared types |
| `lib/services/HistoryManager.ts` | `HistoryEntry` and related interfaces |
| `lib/services/SecurityService.ts` | Validation result types, dependency injection typed |
| `lib/config/ConfigManager.ts` | `NgetConfig` as return type of `getConfig()` |
| `lib/downloadPipeline.ts` | DownloadSession wired; globals removed |
| `index.ts` | `--human`, `--agent-id`, `nget jobs` routing added |

**Compiler settings** (`tsconfig.json`):

- `strict: false` — loosened during migration; tighten per-file by enabling `// @ts-check`
- `allowJs: true`, `checkJs: false` — un-migrated JS files coexist without errors
- `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true` — enforced across all files
- `esModuleInterop: true` — CJS/ESM interop enabled

---

## 8. Scale Path

The current architecture handles dozens of concurrent agent calls cleanly. For hundreds to thousands:

**Bottleneck 1 — File system writes for status files**

`_flushStatus()` writes a JSON file on every progress update. At high concurrency this creates many small writes. Mitigation: debounce writes (only flush if last flush was >500ms ago), or switch `DownloadSession` to only write on state transitions (queued → active → complete/error), not on every progress tick.

**Bottleneck 2 — ChecksumPool thread count**

Default pool size is `min(cpus, 4)`. At high load with many large files this saturates. The pool size is configurable via `new ChecksumPool(n)`. A config key `workers.checksumPoolSize` can expose this.

**Bottleneck 3 — Single process per agent call**

At thousands of concurrent agents, process startup overhead (Node.js init, config load, service init) adds up. The right response is not to change n-get but to put a coordinator in front: a job queue that maintains a pool of pre-warmed nget processes or switches to the MCP server model where one persistent process handles many tool calls.

**When to change the architecture:**

The file-based state approach breaks down when `~/.nget/active/` has hundreds of concurrent files and `nget jobs` is called frequently. At that point, replace `readActiveSessions()` and `_flushStatus()` with a thin adapter over a local Redis or SQLite instance. The `DownloadSession` interface does not change — only the storage backend behind it.
