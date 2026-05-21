# n-get Feature Pipeline

## In Progress

### Coverage — close the gaps
**Baseline:** 51% statements (post DownloadError). Target: 80%+.

| Module | Coverage | Priority |
|---|---|---|
| `server.js` (MCP) | 61% | High — agents hit this directly |
| `ChecksumWorker.js` | 0% | Medium — worker thread harness needed |
| `OutputFormatterService.js` | 14% | Low |
| `Logger.js` | 65% | Low |

---

## Queued

### OAuth for A2A
Add OAuth 2.0 bearer token support to the A2A agent card so orchestrators can authenticate before invoking n-get skills. No SDK dependency — raw HTTP + token exchange.

### Auto-help from CapabilitiesService
`nget --help` generated from the same source as `--capabilities` so help text never drifts from actual capabilities. Eliminates the hand-maintained flag descriptions in `index.ts`.

### TypeScript migration — remaining .js-only files
`lib/ui.js`, `lib/sftpManager.js`, `lib/downloader.js`, `lib/recursiveCrawler.js` still have no `.ts` source. Migrate in-place (no logic changes).

### Internal review agent (non-public)
PR webhook → Cloudflare Worker → n-get A2A → diff review via `fetch_http` → GitHub comment. Dogfoods the full stack. Design: generic webhook payload, not GitHub-specific, so it ports to any git host.

---

## Shipped (≤ 2.1.0)

- HMAC webhook signing (`--webhook-secret`, per-URL secrets, config wiring)
- A2A 1.0 agent card (`--agent-card`, `get_agent_card` MCP tool)
- `fetch_http` MCP tool (11th tool)
- Webhook retry configurable (`webhooks.retry.maxAttempts` / `backoffMs`)
- Repeatable `--header` flag
- Event-driven tests — all arbitrary `setTimeout`-as-sleep eliminated
- Drop `node-fetch`, `nyc`, `progress`, `cross-env` — 0 audit vulnerabilities
- `@vitest/coverage-v8` — `npm run test:coverage`
- `DownloadError` — 100% coverage
- Drop dead `ResilientDownloadService` (never wired, never called)

---

## Notes

- Bug tracker: `http://100.84.91.125:8787`
- GitHub Issues go public once repo goes public
- Review agent is internal/non-public until the git-host portability story is solid
