<div align="center">

# 𝐍̴̡͉̞̿͐͝-̸̺͙̦̄̄̽́͝𝐆̸͕̟̺̽͑̈́𝐄̸̢̦͖ͤͤ̾̀̕ᴛ̵͙̫͖ⷮ͒̈́

</div>

Downloads that agents can actually see. Structured NDJSON events, concurrent, resumable. HTTP/HTTPS + SFTP. 11 MCP tools. A2A 1.0.

## Install

```bash
npm install -g n-get
```

Requires Node.js >= 22.0.0.

## Quick start

```bash
# download a file
nget https://example.com/file.zip

# batch download
nget https://example.com/a.zip https://example.com/b.zip -d ./downloads

# HTTP API call — structured JSON, NDJSON events
nget fetch https://api.example.com/data.json

# pipe-friendly raw output
nget fetch --raw https://api.example.com/data.json | jq .

# stream a download to stdout
nget -o - https://example.com/data.json | jq .

# verify the download against an expected checksum
nget https://example.com/tool.tar.gz --expect sha256:9f86d081884c7d65...

# list all active download sessions
nget jobs
```

## Verified downloads

`--expect <algorithm>:<hex>` compares the downloaded file against a checksum
you supply — `md5`, `sha1`, `sha256` or `sha512`.

On a mismatch the file is **discarded**, the command exits non-zero, and a
`download_error` event carries `code: "CHECKSUM_MISMATCH"` with both digests.
Leaving a file that failed its own integrity check where a later step would
read it is worse than not checking at all.

This is what makes a download safe to run unattended: without it the tool can
tell you a file's SHA-256, but not whether it is the file you asked for.

## Restricting where downloads come from

```yaml
# config/local.yaml
security:
  allowedDomains: [example.com, cdn.example.org]   # empty = allow all
  blockedDomains: [internal.corp]
  blockPrivateIpLiterals: true
```

`blockPrivateIpLiterals` blocks private addresses written as IP literals in the
URL (`127.0.0.1`, `10.0.0.0/8`, `[::1]`) plus the hostname `localhost`. It does
**not** resolve hostnames, so a public name pointing at a private address is not
caught.

n-get is not a network sandbox. Run it inside one.

## MCP server

Add to Claude Desktop or any MCP-compatible host:

```json
{
  "mcpServers": {
    "n-get": { "command": "nget-mcp" }
  }
}
```

11 tools: `download_file`, `batch_download`, `get_jobs`, `get_capabilities`, `cancel_session`, `get_session`, `set_profile`, `get_history`, `get_instructions`, `fetch_http`, `get_agent_card`.

## For agents

```bash
nget instructions   # full agent guide (AGENTS.md)
nget --capabilities # capabilities document
nget --agent-card   # A2A 1.0 agent card
```

## License

MIT
