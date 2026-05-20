# n-get — Agent Instructions

**Version:** 1.13.0 · **License:** MIT · **Node:** >= 18

Observable downloads for AI agents. NDJSON event stream, MCP server, OpenAPI spec, session visibility, HTTP + SFTP with resume.

Auto-generated from `CapabilitiesService.toMarkdown()` — single source of truth. To regenerate run `npm run build:docs`.

## Quick start

- Download a single file
  ```bash
  nget https://example.com/file.zip
  ```
- Download many files concurrently to a directory
  ```bash
  nget url1 url2 url3 -d ./downloads --max-concurrent 5
  ```
- Read URLs from stdin
  ```bash
  cat urls.txt | nget -i - -d ./downloads
  ```
- SFTP download with explicit key
  ```bash
  nget sftp://user@server/path/file.zip --ssh-key ~/.ssh/id_rsa
  ```
- List active sessions across all agents (NDJSON)
  ```bash
  nget jobs
  ```
- HTTP fetch with structured JSON output
  ```bash
  nget fetch https://api.example.com/data
  ```
- HTTP POST with body and agent tracking
  ```bash
  nget fetch --method POST --data '{"key":"val"}' --agent-id my-agent https://api.example.com/endpoint
  ```

## Discovery surfaces

Run any of these to introspect the tool — no docs required:

| Surface | Command | Returns |
|---|---|---|
| help | `nget --help` | Human-readable usage text with flag list and examples |
| capabilities | `nget --capabilities` | This document. Machine-readable JSON spec of every flag, event, and config key |
| openapi | `nget --openapi-spec` | OpenAPI 3.0.3 contract for HTTP-style tooling |
| mcp | `nget-mcp` | MCP server entry point exposing download_file, batch_download, get_jobs, get_capabilities |

## NDJSON event stream

When stdout is not a TTY, `nget` writes one JSON object per line. Output modes:

- **TTY** — progress bars and banners on stderr; final summary on stdout
- **non-TTY** — NDJSON event stream on stdout (one JSON object per line)
- **`--human`** — use --human to force tty-style output regardless of stdout

### Event types

- `session_start`
- `download_queued`
- `download_start`
- `progress`
- `checksum_start`
- `checksum_complete`
- `download_complete`
- `download_error`
- `session_end`

Run `nget --capabilities | jq .schemas` for full per-event field schemas.

## Protocols

Supported: `http`, `https`, `sftp`.

## Programmatic API

```javascript
const nget = require('n-get');

// Library exports — all derived from CapabilitiesService:
nget.capabilities;   // same JSON as `nget --capabilities`
nget.openapi;        // same OpenAPI as `nget --openapi-spec`
nget.instructions;   // this Markdown content as a string
nget.version;        // package.json version

// HTTP fetch (axios-compatible response):
const r = await nget.fetch('https://api.example.com/data.json');
// r.data, r.status, r.headers, r.ok
```

## MCP integration

`nget-mcp` is the bundled MCP server. Add to a Claude Desktop config:

```json
{
  "mcpServers": {
    "n-get": { "command": "nget-mcp" }
  }
}
```

Tools exposed: `download_file`, `batch_download`, `get_jobs`, `get_capabilities`.

---

For the complete machine-readable contract: `nget --capabilities` (JSON) or `nget --openapi-spec` (OpenAPI 3.0.3).
