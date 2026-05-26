# n-get Feature Pipeline

## Queued

### Internal review agent (non-public)
PR webhook → Cloudflare Worker → n-get A2A → diff review via `fetch_http` → GitHub comment. Dogfoods the full stack. Design: generic webhook payload, not GitHub-specific, so it ports to any git host.

---

## Shipped (≤ 2.3.0)

- Dependency maintenance: joi 18, ssh2 1.17, ssh2-sftp-client 12, @types/node 25.9, eslint 9.39, MCP SDK 1.29 — 0 audit vulnerabilities
- Auto-help: `nget --help` generated from `CapabilitiesService` — no hand-maintained flag list
- Coverage tooling + service layer at 90%+ (SecurityService 96%, OpenAPIService 100%, HistoryManager 90%, MetadataService 89%, Logger 87%) — 947 unit tests
- 5 new MCP tools: `cancel_session`, `get_session`, `set_profile`, `get_history`, `get_instructions` — 11 tools total
- TypeScript migration complete — all modules have `.ts` source
- HMAC webhook signing (`--webhook-secret`, per-URL secrets, config wiring)
- A2A 1.0 agent card (`--agent-card`, `get_agent_card` MCP tool)
- `fetch_http` MCP tool
- Webhook retry configurable (`webhooks.retry.maxAttempts` / `backoffMs`)
- Repeatable `--header` flag on `nget fetch`
- `--raw` flag on `nget fetch` — response body only, no NDJSON envelope
- Event-driven tests — all arbitrary `setTimeout`-as-sleep eliminated
- Drop `node-fetch`, `nyc`, `progress`, `cross-env`, `colors`, `cli-progress` — agent-first, no ANSI deps
- `@vitest/coverage-v8` — `npm run test:coverage`
- `DownloadError` — 100% coverage
- Drop dead `ResilientDownloadService`

---

## Notes

- A2A auth (`security_requirements`) is the operator's layer — handled by Cloudflare Worker or proxy in front of n-get, not by n-get itself. n-get surfaces `--agent-id` and correlation ID flags for attribution in the event stream.
- GitHub Issues go public once repo goes public
- Review agent is internal/non-public until the git-host portability story is solid
