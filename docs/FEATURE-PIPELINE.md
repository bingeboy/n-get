# n-get Feature Pipeline

## 1.11.0 — Agent Security & Discovery

**Theme:** Make n-get a fully authenticated, A2A-discoverable agent citizen.
**Status:** In development

---

### Feature 1 — HMAC Webhook Signing (`--webhook-secret`)

**Why:** Webhook receivers currently have no way to verify events actually came from n-get. Any actor who knows the receiver URL can POST fake events. HMAC-SHA256 signing closes that gap — receivers verify the signature before processing.

**Design:**
- `--webhook-secret <secret>` CLI flag (repeatable per `--webhook` URL in future; global for now)
- `webhooks.secret` in `config/default.yaml` for persistent config
- Every webhook POST includes header: `X-NGet-Signature: sha256=<hmac-sha256-hex>`
- Signature computed over the raw JSON body using `node:crypto` — no new dependency
- Empty/absent secret = no header added (backwards compatible)

**Verification example (receiver side):**
```js
const sig = req.headers['x-nget-signature']; // "sha256=abc123..."
const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
const valid = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
```

**Files:**
- `index.ts` + `index.js` — new `--webhook-secret` flag
- `lib/core/NgetEmitter.ts` + `.js` — pass secret into `_fireWebhooks`, compute + attach header
- `types/index.ts` — add `webhookSecret?: string` to `WebhookConfig`
- `config/default.yaml` — add `webhooks.secret: ''`
- `lib/services/CapabilitiesService.ts` — add `webhooks.signing: 'hmac-sha256'` to capabilities
- `test/webhookSigningSpec.js` (NEW) — unit tests: header present, correct HMAC, absent when no secret

**Test plan:**
1. Unit: signature header present when secret configured
2. Unit: HMAC-SHA256 value is correct
3. Unit: no header when secret is empty/absent
4. Unit: `--capabilities` reports `webhooks.signing: 'hmac-sha256'`
5. Contract: existing webhook tests still pass (backwards compatible)

---

### Feature 2 — A2A Agent Card (`--agent-card`)

**Why:** Google's Agent-to-Agent (A2A) protocol (v0.3.0, Linux Foundation, stable) is becoming the standard for agent interoperability across vendors. Adding an Agent Card makes n-get discoverable and invocable by any A2A-compatible orchestrator — LangChain, AWS Bedrock AgentCore, Spring AI, etc.

**Design:**
- `nget --agent-card` — outputs A2A 0.3.0-compatible JSON to stdout (same pattern as `--capabilities`, `--openapi-spec`)
- Card generated from `CapabilitiesService` — never drifts from actual capabilities
- No new dependency — raw JSON output only
- Users serve the card at `/.well-known/agent.json` via their own HTTP layer (Cloudflare Workers, nginx, etc.)
- New `get_agent_card` MCP tool returns the same JSON
- `--capabilities` gains an `a2a` discovery subsection

**Agent Card schema (A2A 0.3.0):**
```json
{
  "name": "n-get",
  "description": "Observable downloads for AI agents — NDJSON event stream, webhook forwarding, HTTP + SFTP.",
  "version": "1.11.0",
  "protocolVersion": "0.3.0",
  "url": "https://{user-configured-endpoint}/a2a",
  "preferredTransport": "JSONRPC",
  "capabilities": { "streaming": true },
  "defaultInputModes": ["application/json"],
  "defaultOutputModes": ["application/json", "text/event-stream"],
  "skills": [
    {
      "id": "download",
      "name": "Download File",
      "description": "Download a file over HTTP/HTTPS or SFTP with streaming NDJSON events, resume support, and checksum verification.",
      "tags": ["file-transfer", "http", "sftp", "streaming", "observable"]
    },
    {
      "id": "batch_download",
      "name": "Batch Download",
      "description": "Download multiple URLs concurrently with per-file progress events and a session summary.",
      "tags": ["file-transfer", "batch", "concurrent", "observable"]
    },
    {
      "id": "fetch",
      "name": "Fetch HTTP API",
      "description": "Make HTTP API calls (GET/POST/PUT/DELETE) with structured JSON output and NDJSON event emission.",
      "tags": ["http", "api", "fetch", "observable"]
    }
  ]
}
```

**Files:**
- `index.ts` + `index.js` — new `--agent-card` flag (info-only, suppresses config logs like `--capabilities`)
- `lib/services/CapabilitiesService.ts` — new `toA2ACard()` method; add `a2a` subsection to `getDiscoveryInfo()`
- `lib/mcp/server.ts` + `.js` — new `get_agent_card` tool (10th MCP tool)
- `AGENTS.md` — regenerated via `npm run build:docs`
- `test/a2aCardSpec.js` (NEW) — unit tests for card shape and MCP tool
- `test/cliOutputContractSpec.js` — extend `--capabilities` assertion to include `discovery.a2a`

**Test plan:**
1. Unit: `--agent-card` output is valid JSON with required A2A 0.3.0 fields
2. Unit: `protocolVersion` is `"0.3.0"`
3. Unit: all 3 skills present with required `id`, `name`, `description`, `tags`
4. Unit: `get_agent_card` MCP tool returns same JSON as `--agent-card`
5. Contract: `--capabilities` `discovery` section includes `a2a` key

---

## Decided

| Decision | Rationale |
|---|---|
| HMAC-SHA256 for signing | Standard, no new dep (`node:crypto`), receiver-verifiable with one `timingSafeEqual` call |
| Global secret (not per-URL) | Simpler for 1.11.0; per-URL secret is a future extension |
| A2A 0.3.0 | Stable spec, Linux Foundation, production-adopted (AWS Bedrock, LangChain) |
| Card from CapabilitiesService | Single source of truth — no drift |
| No A2A HTTP server in n-get | n-get is CLI/MCP; users serve the card themselves — no new infra dependency |
| `/.well-known/agent.json` path | A2A spec standard; documented in AGENTS.md for users |

## Out of scope (future)

- Per-URL webhook secrets
- A2A HTTP invocation server (n-get accepting A2A calls directly)
- A2A streaming via SSE (would require HTTP server)
- Webhook retry/backoff
- TypeScript migration of remaining JS files (tracked separately for public-repo cleanup)

---

## GitHub Issues

Public-facing bugs, feature requests, and A2A/MCP integration questions go in GitHub Issues once the repo goes public. Until then use the internal QA tracker at `http://100.84.91.125:8787`.
