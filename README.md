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

# list all active download sessions
nget jobs
```

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
