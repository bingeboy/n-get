![Logo](https://raw.github.com/bingeboy/n-get/master/assets/nget-logo.png)

# n-get

A download manager built for agent workflows. Emits structured NDJSON events to stdout, tracks active sessions across agents, and exposes a machine-readable capabilities document.

## Install

```bash
npm install n-get -g
```

## Basic usage

```bash
nget <url> [url...]
nget <url> -d ./downloads
nget <url> --agent-id my-agent --session-id abc123
```

## NDJSON event stream

When stdout is not a TTY (agent subprocess, pipe), n-get writes one JSON object per line to stdout. Human progress bars go to stderr.

| Event | Key fields |
|---|---|
| `session_start` | `sessionId`, `agent`, `pid` |
| `download_queued` | `url` |
| `download_start` | `url` |
| `progress` | `url`, `bytes`, `total`, `speed` |
| `checksum_start` | `url`, `algorithm` |
| `checksum_complete` | `url`, `algorithm`, `digest` |
| `download_complete` | `url`, `path`, `size` |
| `download_error` | `url`, `error`, `code` |
| `session_end` | `sessionId`, `success`, `errors` |

```bash
nget https://example.com/file.zip | jq 'select(.event == "download_complete")'
```

Use `--human` to force interactive progress bars regardless of TTY.

## Active session tracking

```bash
nget jobs            # NDJSON to stdout — list active sessions across all agents
nget jobs --human    # formatted table to stderr
```

Each session writes a status file to `~/.nget/active/` while running. `nget jobs` prunes stale files from crashed processes automatically.

## Key flags

| Flag | Description |
|---|---|
| `-d <path>` | Destination directory |
| `-c, --max-concurrent <n>` | Concurrent downloads (default: 3) |
| `--agent-id <id>` | Tag session with agent identity in all events |
| `--session-id <id>` | Override the generated session ID |
| `--stdout` | Stream response body to stdout (single URL only) |
| `--no-resume` | Disable HTTP range resume |
| `--capabilities` | Print tool capabilities document (JSON) and exit |
| `--openapi-spec` | Print OpenAPI 3.0 spec and exit |
| `--human` | Force interactive output |

## Machine-readable discovery

```bash
nget --capabilities        # full capabilities JSON for agent tool registration
nget --openapi-spec        # OpenAPI 3.0 spec
```

## Configuration

```bash
nget config show
nget config set downloads.maxConcurrent 5
nget config profile fast   # fast | secure | bulk | careful
nget config validate
```

Override anything via `NGET_*` env vars: `NGET_DOWNLOADS_MAXCONCURRENT`, `NGET_HTTP_TIMEOUT`, `NGET_LOG_FORMAT`, etc.

## History

```bash
nget history show
nget history search "example.com"
nget history stats
nget history export --csv --output downloads.csv
```

## SFTP

```bash
nget sftp://user@host/path/file.zip
nget sftp://user@host/file.zip --ssh-key ~/.ssh/id_ed25519
```

## Development

Source is TypeScript in `lib/**/*.ts`. Compiled output is committed alongside source — no build step required for consumers.

```bash
npm test           # unit suite
npm run test:integration  # requires live network
npm run lint
```

## License

MIT
