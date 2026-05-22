# n-get Feature Pipeline

## Queued

### OAuth for A2A
Add OAuth 2.0 bearer token support to the A2A agent card so orchestrators can authenticate before invoking n-get skills. No SDK dependency — raw HTTP + token exchange.

### Auto-help from CapabilitiesService
`nget --help` generated from the same source as `--capabilities` so help text never drifts from actual capabilities. Eliminates the hand-maintained flag descriptions in `index.ts`.

### Internal review agent (non-public)
PR webhook → Cloudflare Worker → n-get A2A → diff review via `fetch_http` → GitHub comment. Dogfoods the full stack. Design: generic webhook payload, not GitHub-specific, so it ports to any git host.

---

## Shipped (≤ 2.2.0)

- Coverage tooling + service layer at 90% (SecurityService 96%, OpenAPIService 100%, HistoryManager 90%, MetadataService 89%, Logger 87%) — 947 unit tests
- 5 new MCP tools: `cancel_session`, `get_session`, `set_profile`, `get_history`, `get_instructions` — 11 tools total
- TypeScript migration complete — all modules have `.ts` source
- HMAC webhook signing (`--webhook-secret`, per-URL secrets, config wiring)
- A2A 1.0 agent card (`--agent-card`, `get_agent_card` MCP tool)
- `fetch_http` MCP tool
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
