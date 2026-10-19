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

> **Names in this section are the ones in use at the time.** Two have since
> changed, in PR #111, as renames only — no behaviour moved:
> `lib/downloadPipeline.js` → `lib/downloader.ts`, and `NgetEmitter` →
> `EventSink`. Later sections use the current names.

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

**What changed:** Added the `--human` flag, and then flipped the default, which
is where it stands now: human rendering when stdout is a TTY, NDJSON otherwise.
`--human` forces the human path even when stdout is not a TTY. See 4.8.

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

**One sink, three destinations:**

`EventSink` (`lib/core/EventSink.ts`) is a write-through sink, not a pub/sub bus.
There are no subscribers and no listener registration: `emit()` writes
synchronously to a fixed set of destinations and returns the event.

1. **NDJSON to stdout** — the default (agent) mode. One `JSON.stringify(event)`
   per line.
2. **Human text to stderr via `UIManager`** — when `humanMode` is set (`--human`
   or a TTY stdout). `_renderHuman()` switches on the event type and calls the
   matching `ui.display*()` method, with a plain-text fallback when no
   `UIManager` was supplied. Only `session_start`, `download_start`,
   `download_complete`, `download_error`, `warning`, `info` and `session_end`
   render. Every other type falls through the default case and renders nothing —
   `progress` deliberately, because the progress bar renders itself.
3. **Webhook POSTs** — when webhooks are configured, every event is also POSTed
   as JSON to each configured URL, filtered by that webhook's `events` list.
   Delivery is out-of-band: retries with backoff (default 3 attempts,
   `[0, 500, 1000]` ms), a 2s per-attempt timeout, no retry on 4xx, retry on 5xx
   and network errors, and optional `X-NGet-Signature: sha256=<hex>` HMAC
   signing. In-flight POSTs are tracked and drained by `flush()`.

In pipe mode (`-o -`) destinations 1 and 2 both move to stderr so stdout carries
only file content. Direct `process.stdout.write` for event output is banned
outside this one file.

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
  "version": "3.0.0",
  "downloads": {
    "https://example.com/file.zip": {
      "status": "queued",
      "updatedAt": "2025-05-04T18:00:00.004Z"
    },
    "https://example.com/other.zip": {
      "status": "complete",
      "file": "/downloads/other.zip",
      "bytes_total": 1048576,
      "speed_bps": 2097152,
      "updatedAt": "2025-05-04T18:00:03.412Z"
    }
  }
}
```

**Status file granularity — read this before building on it.** Per-download
entries move `queued → complete` or `queued → error`, and nothing else. The
`DownloadStatus` type also carries `active` as a status value and a
`bytes_received` field, but no code path writes either: byte-level progress goes
to the event stream (`progress` events), not to the status file. `nget jobs` and
the `get_jobs` MCP tool both count entries with `status === 'active'`, so that
count is always zero today. Treat the status file as a roster of what a session
was asked to do and what finished, and the event stream as the live feed.

Status files are written with `fs.writeFile` and never awaited from the download
path, so they never block a download. The writes are chained rather than fired
blind: each `_flushStatus()` appends to an internal promise chain, which keeps
them ordered and lets `session.end()` drain them before unlinking the file.
`flushStatus()` exposes that drain publicly — tests need it, because from the
caller's side a `_flushStatus()` is still fire-and-forget.

---

### 4.6 Worker threads for checksums only

**Decision:** Use `worker_threads` for MD5/SHA256 computation. Do not use worker threads for downloads.

**Why not worker threads for downloads:**

Downloads are I/O-bound. Node's event loop handles concurrent I/O natively and efficiently. A 20-connection HTTP download saturates a gigabit link without ever needing a worker thread. Adding worker threads to I/O work adds IPC overhead, complexity, and serialization cost with no throughput benefit. The existing `ConcurrencyLimiter` semaphore pattern is the correct tool for controlling concurrent downloads.

**Why worker threads for checksums:**

Checksums are CPU-bound. `crypto.createHash('sha256')` running on a 1 GB file processes every byte through a hash function on the main thread, blocking all event loop callbacks for the duration. On the main thread this stalls progress updates, history writes, and any other concurrent download's I/O callbacks.

A worker thread runs the hash computation in a separate V8 isolate, off the event loop. The main thread remains responsive.

**The pool design:**

`ChecksumPool` limits concurrent workers to `min(cpus, 4)`. Each job creates a fresh `Worker`, which runs to completion and exits on its own — the pool never calls `terminate()` on a running job. There is no worker reuse — checksum jobs are infrequent relative to their duration, so startup cost is negligible and avoiding stale state across jobs is worth it. Pending jobs queue until a slot opens; the pool is a module-level singleton (`checksumPool`), so the limit is per process.

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

**Decision:** `DownloadSession` owns `Logger`, `SecurityService`, and `MetadataService` for one invocation. Module-level globals are removed from `lib/downloader.ts` (the file formerly named `downloadPipeline.js`).

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
│   ├── index.ts                    ← Library entry (`require('n-get')`): fetch, capabilities, openapi, instructions, version
│   ├── core/
│   │   ├── EventSink.ts            ← Write-through event sink: NDJSON → stdout, human text → stderr, webhook POSTs
│   │   └── DownloadSession.ts      ← Per-invocation context; owns services; writes status file
│   ├── workers/
│   │   ├── ChecksumWorker.ts       ← Worker thread script (runs in separate V8 isolate)
│   │   └── ChecksumPool.ts         ← Thread pool manager; singleton per process
│   ├── mcp/
│   │   └── server.ts               ← MCP stdio server (`nget-mcp` bin); 11 tools
│   ├── cli/
│   │   ├── configCommands.ts       ← nget config ...
│   │   ├── historyCommands.ts      ← nget history ...
│   │   ├── logsCommands.ts         ← nget logs ...
│   │   └── jobsCommands.ts         ← nget jobs (cross-agent visibility)
│   ├── config/
│   │   └── ConfigManager.ts        ← YAML config, profiles, env var merging
│   ├── services/
│   │   ├── Logger.ts               ← Structured logging (JSON/CSV/text)
│   │   ├── SecurityService.ts      ← URL/path validation, rate limiting
│   │   ├── MetadataService.ts      ← File metadata, checksums (via ChecksumPool), HTTP headers
│   │   ├── OutputFormatterService.ts ← Batch result formatting
│   │   ├── CapabilitiesService.ts  ← --capabilities / --help / --agent-card source of truth
│   │   ├── OpenAPIService.ts       ← --openapi-spec flag output
│   │   └── HistoryManager.ts       ← <destination>/.nget/nget.history JSONL
│   ├── errors/
│   │   └── DownloadError.ts        ← Structured error with codes, severity, recovery actions
│   ├── downloader.ts               ← Core download orchestration (HTTP + SFTP); module export is download()
│   ├── fetch.ts                    ← Programmatic HTTP client behind `nget fetch` and `nget.fetch()`
│   ├── resumeManager.ts            ← Partial download state, range request logic
│   ├── checksumVerifier.ts         ← Compares a downloaded file to a caller-supplied checksum (--expect)
│   ├── sftpManager.ts              ← SSH/SFTP downloads
│   ├── recursiveDownloader.ts      ← Recursive site download
│   ├── recursiveCrawler.ts         ← HTML/CSS link extraction
│   ├── concurrencyLimiter.ts       ← Semaphore for max concurrent downloads
│   ├── uriManager.ts               ← URL validation, normalization, protocol detection (IPv6-aware)
│   ├── getDestination.ts           ← Destination path resolution
│   ├── chdir.ts                    ← Working-directory change helper
│   ├── ui.ts                       ← Terminal rendering (progress bars, banners)
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
│   ├── AI-INTEGRATION.md
│   ├── CONFIG-CONTRACT.md
│   └── FEATURE-PIPELINE.md
└── test/
```

Every module under `lib/` and `types/` is TypeScript. The `.js` file beside each
`.ts` file is compiled output, not source — `tsconfig.json` sets
`outDir: "."` so `require()` paths never had to change. Do not edit the `.js`.

**State on disk:**

```
~/.nget/                            ← global, one per machine
└── active/
    └── sess_<id>.json              ← written while session runs, deleted on end

<destination>/.nget/                ← per destination, alongside the files
└── nget.history                    ← JSONL append log of completed downloads

<dir containing the file>/.nget/    ← same as <destination> for a flat download
└── <md5 of url>.nget-meta          ← resume metadata per URL (written by resumeManager)
```

`HistoryManager` writes to `<historyRoot>/.nget/nget.history`, where
`historyRoot` defaults to the downloaded file's own parent directory. Recursive
downloads pass the `-d` destination explicitly, so a whole crawl's history
collects in one place and `nget history show -d <dest>` — which reads exactly
one directory — finds all of it. `resumeManager` has no such override: its
metadata always lands in `.nget/` beside the file being written.

---

### 5.2 Request lifecycle

```
nget https://example.com/file.zip --session-id agent-abc

index.js
  └─ parse argv
  └─ init ConfigManager
  └─ call download(urls, destination, options)

download()                           ← lib/downloader; the module export IS the function
  └─ new DownloadSession(...).start()
       ├─ build Logger, SecurityService, MetadataService, EventSink
       ├─ write ~/.nget/active/sess_<id>.json
       └─ emitter.sessionStart()     → stdout: {"event":"session_start",...}
  └─ session.queueDownload(url) × N  → {"event":"download_queued",...} + status file
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

  └─ await session.end()
       ├─ drain in-flight status-file writes
       ├─ delete ~/.nget/active/sess_<id>.json
       ├─ emitter.sessionEnd()        → stdout: {"event":"session_end",...}
       ├─ emitter.flush()             → drain in-flight webhook POSTs
       └─ logger.shutdown()
```

`emitter` above is `session.emitter`, an `EventSink` (see 4.4). `sessionStart`
and `sessionEnd` are emitted by `DownloadSession.start()` / `end()` rather than
by the downloader, so a session cannot exist without bracketing events.

---

### 5.3 Event schema

All events: `{ event: string, ts: number, session: string, ...payload }`

Fourteen event types. The list is the `NgetEventType` union in `types/index.ts`
and the `EVENT` map in `lib/core/EventSink.ts`; those two are the contract, and
event names are part of the public surface (renaming one is a major bump).

| Event | Key payload fields |
|---|---|
| `session_start` | `sessionId`, `startTime`, `agent`, `pid`, `version` |
| `download_queued` | `url` |
| `download_start` | `url`, `filename`, `bytes_total`, `index`, `total`, `resumed`, `resume_from` |
| `progress` | `url`, `bytes_received`, `bytes_total`, `speed_bps`, `pct` |
| `checksum_start` | `file`, `algorithms` |
| `checksum_complete` | `file`, `checksums` |
| `download_complete` | `url`, `filename`, `file`, `size`, `duration_ms`, `speed_bps`, `resumed` |
| `download_error` | `url`, `error`, `code`, `retryable` |
| `fetch_start` | `url`, `method`, `hasBody` |
| `fetch_complete` | `url`, `method`, `status`, `statusText`, `latencyMs`, `contentType` |
| `fetch_error` | `url`, `method`, `error`, `latencyMs` |
| `warning` | `message`, `url`, `code` |
| `info` | `message` |
| `session_end` | `stats.total`, `stats.success`, `stats.errors`, `stats.resumed`, `stats.bytes`, `stats.duration`, `stats.avg_speed`, `stats.file_paths` |

The three `fetch_*` events belong to `nget fetch` / `nget.fetch()` and the
`fetch_http` MCP tool, not to the download pipeline.

---

### 5.4 Active session state

**Writing:** `DownloadSession._flushStatus()` is called on `start()`, `queueDownload()`, `updateDownload()` and `cancel()`. `completeDownload()` and `failDownload()` flush too, by delegating to `updateDownload()`. Writes are `fs.writeFile` (async) — they never block the download stream.

**Reading:** `readActiveSessions()` reads all `~/.nget/active/*.json` files.
Pruning is a separate function, and the caller sequences it: `nget jobs` and the
`get_jobs` MCP tool both call `pruneDeadSessions()` and then
`readActiveSessions()`. Dead process detection uses `process.kill(pid, 0)`,
which returns without sending a signal — it only checks whether the PID exists.

**Crash recovery:** If n-get crashes without calling `session.end()`, the status
file persists. The next `nget jobs` or `get_jobs` call prunes it if the PID is
gone, so a dead session does not appear active past that point. The
`get_session` and `cancel_session` MCP tools read without pruning first, so they
can still see a dead session's file until something else prunes it.

---

## 6. What Is Not Done Yet

Four items used to sit here: wiring `ChecksumPool` into `MetadataService`,
building out `lib/mcp/`, adding tests for the then-new core modules, and
finishing the JS → TS migration. All four have shipped. What follows is what is
genuinely still open at the architectural level. The feature queue itself lives
in `docs/FEATURE-PIPELINE.md` — this section is only for gaps in the structures
described above.

### 6.1 MCP server is stdio-only

`lib/mcp/server.ts` constructs a `StdioServerTransport` and nothing else. That
covers Claude Desktop, Cursor, and anything else that spawns a server process,
but not a server reached over the network. An HTTP transport is a future
milestone; until then an HTTP-facing deployment needs its own layer in front
(the same place the A2A agent card is served from).

### 6.2 Checksum pool size is not configurable

`MAX_WORKERS` in `lib/workers/ChecksumPool.ts` is a module constant,
`Math.min(os.cpus().length, 4)`, fixed at load. The constructor takes no
arguments and there is no config key for it. See section 8 for why this matters
at high load, and for the shape a config key would take.

### 6.3 `any` annotations remain

`strict: true` is on, so the type-checking half of the migration is finished.
What remains is explicit `any` annotations, which type-check fine and simply opt
out of the guarantees. They are held down by `test/anyCountSpec.js` — a total
ceiling (currently 124) plus a per-file ceiling, both of which may only be
lowered. When the count reaches zero,
`@typescript-eslint/no-explicit-any` is raised to `error` and that spec is
deleted. The bulk of the remainder is in `lib/recursiveDownloader.ts`,
`lib/mcp/server.ts` and `lib/cli/configCommands.ts`.

### 6.4 Status file never reports a download as `active`

Described in 4.5. The `active` status value and the `bytes_received` field are
part of the `DownloadStatus` type, and `nget jobs` and `get_jobs` both count
entries whose `status` is `'active'`, but nothing ever sets it: entries go
`queued → complete | error`. So the "active" count those two surfaces report is
structurally always zero. Closing this means calling
`session.updateDownload(url, { status: 'active', ... })` somewhere on the
download path — which reopens the write-volume question in section 8, since the
obvious place is the progress tick. Either write `active` once at download start
without byte counts, or accept the extra writes; the current state is neither.

---

## 7. TypeScript Migration

**Status: complete as of v3.0.0.** Every module under `index.ts`, `lib/` and
`types/` has a `.ts` source. The `.js` files beside them are build output.

The `tsconfig.json` uses in-place compilation (`outDir: "."`) so `.ts` files
compile to `.js` alongside the source. `require()` paths never changed, which is
why the migration could run file by file without a big-bang cutover.

The core modules, and what typing them bought:

| File | Notes |
|------|-------|
| `types/index.ts` | Shared type definitions — single source of truth |
| `lib/core/EventSink.ts` | Full event type system, discriminated union |
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
| `lib/downloader.ts` | DownloadSession wired; globals removed |
| `lib/mcp/server.ts` | MCP tool handlers, zod input schemas |
| `index.ts` | `--human`, `--agent-id`, `nget jobs` routing added |

`EventSink` was named `NgetEmitter`, and `lib/downloader.ts` was
`lib/downloadPipeline.ts`, until PR #111 renamed both.

**Compiler settings** (`tsconfig.json`):

- `target: ES2022`, `module: commonjs`, `moduleResolution: node10` — baseline is Node 22+
- `strict: true` — on project-wide (#151). Enabling it surfaced six errors across
  four files, not the large fallout the loose setting had been guarding against.
  New code must type-check under it; `// @ts-nocheck` and widening to `any` to
  get past an error are both out.
- `allowJs: true`, `checkJs: false` — `.js` build output and test files coexist without errors
- `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true` — enforced across all files
- `esModuleInterop: true`, `resolveJsonModule: true`, `skipLibCheck: true`
- `newLine: "lf"` — emit LF regardless of the source file's line endings, so a
  stray CRLF source cannot produce output that conflicts with `.gitattributes`
  and shows as build drift in CI (#150)
- `declaration: false`, `sourceMap: false` — no declarations or source maps yet

---

## 8. Scale Path

The current architecture handles dozens of concurrent agent calls cleanly. For hundreds to thousands:

**Bottleneck 1 — File system writes for status files**

`_flushStatus()` rewrites the whole status file on each call, and the file grows
with the number of URLs in the batch, so a large batch means repeated writes of
a large-ish JSON blob. The writes are already limited to state transitions
rather than progress ticks (see 4.5), which removes the worst version of this.
What is left: a batch of thousands of URLs writes the full roster once per
transition. Mitigation if it bites — debounce (flush at most every ~500ms), or
write per-download deltas instead of the whole document.

**Bottleneck 2 — ChecksumPool thread count**

Pool size is `min(cpus, 4)`. At high load with many large files this saturates,
and jobs past that point queue. It is not currently adjustable: `MAX_WORKERS` is
a module constant in `lib/workers/ChecksumPool.ts` and the constructor takes no
arguments. Making it tunable means parameterising the constructor and adding a
config key — `workers.checksumPoolSize` would be the natural name; no such key
exists today.

**Bottleneck 3 — Single process per agent call**

At thousands of concurrent agents, process startup overhead (Node.js init, config load, service init) adds up. The right response is not to change n-get but to put a coordinator in front: a job queue that maintains a pool of pre-warmed nget processes or switches to the MCP server model where one persistent process handles many tool calls.

**When to change the architecture:**

The file-based state approach breaks down when `~/.nget/active/` has hundreds of concurrent files and `nget jobs` is called frequently. At that point, replace `readActiveSessions()` and `_flushStatus()` with a thin adapter over a local Redis or SQLite instance. The `DownloadSession` interface does not change — only the storage backend behind it.
