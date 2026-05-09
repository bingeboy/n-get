![Logo](https://raw.github.com/bingeboy/n-get/master/assets/nget-logo.png)

# n-get

A CLI download tool built for AI agents. n-get emits a structured NDJSON event stream to stdout when run as a subprocess, supports HTTP/HTTPS and SFTP (with resume), and ships an MCP server (`nget-mcp`) for direct integration with Claude and other MCP-compatible assistants.

## Install

```bash
npm install -g n-get
```

Requires Node.js >= 18.0.0.

## Quick start

```bash
# Single file
nget https://example.com/file.zip

# Multiple files to a destination directory
nget https://example.com/file1.zip https://example.com/file2.pdf -d ./downloads

# Fetch mode — stream response body to stdout (curl-style)
nget --stdout https://api.example.com/data.json | jq .

# SFTP (auto-detects SSH keys in ~/.ssh/)
nget sftp://user@server.com/path/to/file.zip -d ~/Downloads

# List active download sessions across all agents
nget jobs

# Force human-readable UI (progress bars) even inside a pipe
nget --human https://example.com/large-file.zip
```

## Agent interface

When stdout is not a TTY — the normal case for agent subprocesses and pipes — n-get writes one JSON object per line (NDJSON) to stdout. Each line is a self-contained event that can be parsed independently.

| Event | Description |
|---|---|
| `session_start` | Emitted once when the download session is created |
| `download_queued` | A URL has been queued |
| `download_start` | A download has begun |
| `progress` | Periodic byte-count and speed update |
| `checksum_start` | Checksum calculation started |
| `checksum_complete` | Checksum result (algorithm + hex digest) |
| `download_complete` | A single file finished successfully |
| `download_error` | A single file failed |
| `session_end` | Final session summary |

Example stream:

```
{"event":"session_start","ts":1714000000000,"sessionId":"s_abc123","agent":"my-agent"}
{"event":"download_start","ts":1714000000050,"url":"https://example.com/file.zip"}
{"event":"progress","ts":1714000001000,"url":"https://example.com/file.zip","bytes":524288,"total":1048576,"speed":"512KB/s"}
{"event":"download_complete","ts":1714000002100,"url":"https://example.com/file.zip","path":"./file.zip","size":1048576}
{"event":"session_end","ts":1714000002200,"sessionId":"s_abc123","success":1,"errors":0}
```

Filter events in a shell pipeline:

```bash
nget https://example.com/data.zip | jq 'select(.event == "download_complete")'
```

**Output mode flags:**
- `--human` — forces progress bars and banners regardless of TTY detection
- `--capabilities` — emits a self-describing tool capabilities document (JSON/YAML) for agent introspection
- `--openapi-spec` — emits an OpenAPI 3.0 specification for this tool

**Standard agent correlation flags:** `--agent-id`, `--session-id`, `--request-id`, `--conversation-id`

All active sessions are visible via `nget jobs` (NDJSON) or `nget jobs --human` (table). Pass `--agent-id <id>` to tag your agent in every event and in `nget jobs` output.

Run `nget --help` for the full flag reference.

## MCP server

n-get ships a standalone MCP server as the `nget-mcp` binary. Add it to your Claude Desktop config:

```json
{
  "mcpServers": {
    "n-get": { "command": "nget-mcp" }
  }
}
```

The MCP server exposes n-get's download and configuration capabilities as MCP tools. See `docs/AI-INTEGRATION.md` for CrewAI, AutoGen, and LangChain integration.

## Configuration

Settings are stored in YAML and can be overridden by `NGET_*` environment variables (e.g. `NGET_DOWNLOADS_MAXCONCURRENT=5`). Environment variables take precedence over the config file; CLI flags take precedence over both.

Built-in profiles: `fast`, `secure`, `bulk`, `careful`. Switch with `nget config profile <name>`.

Run `nget config show` for current settings or `nget --capabilities` for the full configuration surface including all env-var keys.

## Programmatic API

```javascript
const fetch = require('n-get/lib/fetch');

// axios-compatible response: .data, .status, .headers, .ok
const response = await fetch('https://api.example.com/data.json');
console.log(response.data);
```

The CLI is the primary interface. Programmatic use is supported but the response contract may evolve. See `docs/ARCHITECTURE.md` for internals.

## Documentation

- `docs/ARCHITECTURE.md` — design decisions, event contracts, session lifecycle, worker threads
- `docs/AI-INTEGRATION.md` — MCP, CrewAI, AutoGen, LangChain integration guides

## Development

The core library (`lib/`) is written in TypeScript. The compiled JavaScript is committed alongside the source so the package works without a build step for end users.

When contributing:
- Source files live in `lib/**/*.ts`
- Run `npm run build` to compile TypeScript to JavaScript
- Tests run against the compiled output: `npm test`
- The entry point (`index.js`) is the compiled output of the TypeScript source

## License

MIT
