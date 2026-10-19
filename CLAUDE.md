# Claude Code Rules — n-get

## Commits

- Never add `Co-Authored-By` lines to commit messages. JP is the sole author.

## Model behavior

### When running as Opus — always delegate routine work to subagents

When the active model is Opus, spawn sonnet subagents for any task that is:
- A single-file JS → TS migration with no logic changes
- A doc update (README, RELEASE_NOTES, ROADMAP, ARCHITECTURE)
- A test file scaffold for a module that already exists and is well-understood
- A config or package.json field update

Keep Opus context focused on:
- Architectural decisions and trade-offs
- Cross-file refactors that need system-level understanding
- QA of subagent output (tsc clean, tests passing, logic correct)
- Anything that touches the public API or session/event contracts

**How to apply:** Before starting a task, judge whether it requires system-level reasoning. If not, spawn a `sonnet` subagent with exact file paths, line numbers, and instructions. Always QA the result yourself before moving on.

### Subagents — testing scope

Subagents may run **unit tests only** (i.e. `npm test`). They must NOT:
- Run integration / e2e tests (`npm run test:integration`, anything that hits the network or external services)
- Start dev servers, browsers, or background processes
- Run anything that touches Docker, system services, or external infra

If a change needs verification beyond unit tests, the subagent's job is to **file a potential issue** to the QA endpoint (`POST http://localhost:8787/issues` — see QA Bug Tracker section below for the exact body format) describing what should be tested and why. The QA team owns running non-unit tests after the change is pushed to origin.

**Why:** Subagents lack the broader environmental context and cost discipline that JP and the QA team enforce. A subagent running an integration test could spin up containers, hit cloud APIs, or wedge a service. Keep them in the small / deterministic / offline lane. Anything else gets handed off.

## Agent protocol support — always current

n-get targets the latest stable versions of every agent-facing protocol. When a new protocol version ships, update immediately — don't wait for a major release.

### MCP (Model Context Protocol)
- SDK: `@modelcontextprotocol/sdk` — keep at latest
- Transport: stdio (primary); HTTP transport is a future milestone
- Tools contract is versioned — breaking changes require a SemVer major bump

### A2A (Agent-to-Agent — Google / Linux Foundation)
- Spec version: **1.0** (stable). Versions are `Major.Minor` — patch numbers MUST NOT appear in a card or on the wire (spec §3.6).
- n-get exposes an Agent Card at `nget --agent-card` (outputs JSON, mirrors the `--capabilities` / `--openapi-spec` pattern)
- Card served at `/.well-known/agent-card.json` by whatever HTTP layer the user runs (Cloudflare Workers, their own infra). Renamed from `agent.json` in 0.3 — do not serve the old path.
- Card shape (spec §4.4.1): required members are `name`, `description`, `supportedInterfaces`, `version`, `capabilities`, `defaultInputModes`, `defaultOutputModes`, `skills`. There is **no** top-level `protocolVersion` and **no** top-level `url` — both moved into `supportedInterfaces[]`, where each `AgentInterface` (§4.4.6) requires `url`, `protocolBinding` and `protocolVersion`. The `kind` discriminator was removed in 1.0 (Appendix A.2.1).
- Version negotiation is via the `A2A-Version` request header (§3.6); an absent or empty value means 0.3.
- Invocation shape: JSON-RPC 2.0 POST — `message/send` for one-shot, `message/stream` for SSE streaming
- n-get skills in the card: `download`, `batch_download`, `fetch` — map 1:1 to MCP tools
- No A2A SDK dependency — raw HTTP + JSON-RPC, use `node:http` / `node-fetch`
- Auth: none required by default. `securitySchemes` / `securityRequirements` (both optional, both camelCase in 1.0) are omitted from the card; users add their own auth layer

**When implementing A2A features:** generate the card from `CapabilitiesService` (same source as `--capabilities`). Never hard-code skill descriptions — derive from the existing capabilities data so the card stays in sync automatically.

## Dependencies — prefer Node.js core

**Default to Node.js built-in modules.** Do not add a third-party dependency if a core module covers the need. When a third-party package is genuinely better (meaningfully better DX, fills a real gap, actively maintained), use it — but document why in the PR description.

Current exceptions and their justification:
- `mocha` + `chai` → **Vitest** (migrating; sunset to `node:test` tracked in a GitHub issue — next migration window)
- `minimist` — argv parsing; `node:util parseArgs` is close but lacks the alias/default/boolean shape we rely on
- `js-yaml`, `joi` — no core equivalent
- MCP SDK, SSH clients — no core equivalent

When adding any new devDependency: check `node:test`, `node:assert`, `node:crypto`, `node:stream`, `node:fs`, `node:http` first. If a core module works, use it.

## Testing

- Run `npm test` (unit suite) after every change. Target: 0 failing.
- `npm run test:integration` requires a live network — run explicitly, not on every change.
- Do not install `chai-as-promised`. Use try/catch for async throw assertions.
- `_flushStatus()` in DownloadSession is fire-and-forget — tests must `await flushIO()` (50ms setTimeout) after any state-changing call before reading the status file.

### Coverage — no exceptions

- Every new module must have a corresponding test file before the PR is merged.
- Every bug fix must include a test that reproduces the bug and verifies the fix. No fix without a test. No exceptions.
- If a bug is found in an already-tested module, update the existing spec to cover that case before touching the implementation.
- The rule: if it can break, it must be tested. If it broke once, it must be regression-tested forever.

## TypeScript

- In-place compilation: `outDir: "."` — compiled `.js` sits next to `.ts`, existing `require()` calls unchanged.
- Use `export = X` (not `export default`) for modules consumed via `require()`.
- Use `import X = require(...)` to consume `export =` modules inside TypeScript files.
- `strict: true` project-wide (#151). New code must type-check under it; do not add `// @ts-nocheck` or widen a type to `any` to get past an error.
- Explicit `any` annotations are held to a ceiling by `test/anyCountSpec.js`, with per-file limits. The numbers may only be lowered. When the count reaches zero, raise `@typescript-eslint/no-explicit-any` to `error` and delete that spec.

## Branching

- Feature work goes on `feature/*` branches off `master`.
- Releases go on `release/<version>` branches off `master`.

### Starting a new feature — always do this first

Before creating any feature branch, sync master with origin:

```bash
git fetch origin
git checkout master
git rebase origin/master
git checkout -b feature/<name>
```

No exceptions unless JP explicitly says otherwise. A branch cut from a stale master is the root cause of every conflict and ghost-commit mess in this repo.

### Git authentication and PR lifecycle — token-only, JP-only PR control

**Claude does NOT use JP's git credentials.** No SSH key auth, no credential-helper, no implicit identity-as-JP. Every remote write happens via a scoped GitHub token JP issues to Claude.

**Token usage:**
- JP stores a fine-grained PAT in `n-get/.env` under the key `GH_TOKEN_NGET`, scoped to `bingeboy/n-get` with **Contents: read/write**, **Pull requests: read/write** and **Issues: read/write**. `.env` is gitignored, so it is absent from any fresh clone — including Claude Code cloud sessions.
- Claude reads the token inline at push time — never copies it into shell history, never persists it to disk anywhere else:
  ```bash
  git push "https://x-access-token:$(grep '^GH_TOKEN_NGET=' .env | cut -d'=' -f2-)@github.com/bingeboy/n-get.git" <branch>
  ```
  Never plain `git push origin <branch>` (that uses JP's SSH/credential-helper).
- If `.env` is missing the key or empty: Claude commits locally and **stops**. JP pushes from their own terminal.

**PR lifecycle:**
- Claude MAY open PRs via the GitHub API using `GH_TOKEN_NGET` (requires `pull_requests:write` scope).
- Claude MAY merge PRs, provided every required check has passed. Never merge a PR that is red, still running, or has conflicts — fix or rebase it first.
- When merging, pass an explicit `commit_title` and `commit_message`. GitHub otherwise composes the squash commit from the PR and can carry `Co-authored-by` trailers in from branch commits. The merge commit must contain no `Co-Authored-By` line and no reference to Claude, Anthropic, or any LLM — same rule as every other commit. JP is the sole author.
- Claude does NOT close or comment on PRs.
- Claude does NOT reference the LLM or Anthropic in any public-facing PR body, commit message, or issue.

**Why this exists:** earlier in development a push from this session ran through JP's SSH key auth without an explicit prompt, because `Bash(git push:*)` was wildcard-allowed and the local credentials handed off silently. That conflates Claude's actions with JP's identity in git history and on GitHub. Token-based pushes from Claude make the actor explicit, which is what the token requirement is really for — not gatekeeping every remote action.

**Until JP signals otherwise:** any task requiring a `git push` or PR action must surface for JP approval first, even if a permission entry would technically auto-allow it.

**Token use requires explicit per-action approval.** Having `GH_TOKEN_NGET` in `.env` is not blanket authorization. Every use of the token — push, release, any GitHub API call — requires JP to explicitly say "do it" for that specific action in the current conversation. A previous approval does not carry forward to the next action.

### Claude Code cloud sessions

A cloud session clones the repo and sees **only committed files**. It gets this
file, but NOT `.env` — so `GH_TOKEN_NGET` is absent and the token-only push rule
above cannot be followed there.

GitHub is excluded from the "network secrets" mechanism: requests go through an
Anthropic-side proxy that attaches the credential server-side, and the VM never
holds it. There is no documented way to supply a custom PAT for pushes. The two
supported paths are the Claude GitHub App (pushes as the app) and `/web-setup`
(sends the token from JP's own `gh auth token` to Anthropic).

**What a cloud session may do:**

- Push branches
- Open PRs
- Read issues, and file them

**What a cloud session must NOT do:**

- **Merge.** JP merges every cloud-session PR. This differs deliberately from a
  local session, which may merge once all required checks pass — the local
  session pushes with a token JP scoped, so the actor is explicit in a way the
  cloud paths are not. Do not read the local merge permission as transferable.
- Push to `master`, or tag a release.

**Two behaviours are still undocumented.** Neither blocks work, but both should
be confirmed from the first cloud-session PR rather than assumed:

1. **Which identity appears on pushes** — the app, or JP's account.
2. **Whether attribution trailers are added automatically** — the
   no-`Co-Authored-By` rule is absolute, and a tool adding one would violate it
   silently. Check `git log -1 --format='%an <%ae>%n%B'` on the first branch and
   remove any trailer before the PR is reviewed.

Everything else in this file applies unchanged: the test-coverage rule, TSDoc,
SemVer, the ratchets, and no reference to the LLM or Anthropic in any commit
message, PR body, or issue.

### Secret hygiene — `.env` values never enter a context window

**If any `.env` key value appears anywhere in the context window — in Claude's output, tool results, error messages, or anywhere else — that token is considered leaked and must be revoked immediately. Generate a new one; do not attempt to continue using a leaked token.**

**Known secrets in `.env`:**
- `GH_TOKEN_NGET` — fine-grained PAT, `bingeboy/n-get`, contents + pull requests + issues (read/write)

There was previously a second `CLAUDE_GH_ISSUES_TOKEN`. It no longer exists; one token now covers all three permissions.

**No `.env` key value ever appears in Claude's output. Ever.** Not in text responses, not in tool results, not in error messages, not in "verification" output, not in commit messages, not in PR summaries.

**Forbidden operations** — these would leak secrets into the context window or transcript:

- `cat .env`, `head .env`, `tail .env`, `type .env` (PowerShell), or `Read` on `.env`
- `grep PATTERN .env` without piping through a sink (the matched line lands in stdout → tool result → context)
- `echo $GH_TOKEN_NGET`, `printf '%s' "$GH_TOKEN_NGET"`, `Write-Host $env:GH_TOKEN_NGET`, or any other command whose stdout is the value
- Logging a constructed token-URL (`echo "https://x-access-token:..."`) anywhere

**The only correct shape** for using the token is in-place command substitution inside a single command whose own argv is what's visible — the substitution result is consumed by `git push` and never returns to stdout:

```bash
git push "https://x-access-token:$(grep '^GH_TOKEN_NGET=' .env | cut -d'=' -f2-)@github.com/bingeboy/n-get.git" <branch>
```

What I see in the tool result is the command text (with the literal `$(grep …)` substitution syntax) and either success or an error — never the resolved token value.

**Error-response redaction:** if `git push` fails and the error message includes the constructed URL with the token, the token must be masked before the error is surfaced back. Replace the token segment with `***REDACTED***` before including any output containing it.

**Debugging failures without printing the secret:**

- Check existence: `test -s .env && grep -q '^GH_TOKEN_NGET=..*' .env && echo "token present" || echo "token missing/empty"` (prints only the boolean, not the value)
- Check token length: `awk -F= '$1=="GH_TOKEN_NGET"{print length($2)" chars"}' .env` (prints character count, not value)
- Never inspect the value to "see what's there." If a token-related operation fails, the fix is: revoke the token on GitHub, generate a new one, drop into `.env`. Never diagnose the value contents.

**Why:** transcripts and context windows are persisted, potentially shared (debugging, code review, training data); a token visible anywhere in this stream is functionally compromised. The grep-in-substitution pattern is the only place the value lives outside of `.env` itself, and that's for the lifetime of a single `git push` argv.

This rule extends to any future secret in `.env` (API keys, deploy tokens, signing keys, etc.), not just `GH_TOKEN_NGET`.

### Releases — use npm version, but tag only after the PR merges

**Never manually bump `package.json` — use `npm version`.** But `npm version` also creates a tag, and that tag is always wrong under our branch protection. Discard it and re-tag after the merge.

**Why:** master is protected by a repository ruleset — `Changes must be made through a pull request`. A direct `git push origin master` is rejected with `GH013`, and no token scope bypasses it. Because every release commit goes through a PR and gets squash-merged, the merged commit gets a **new SHA**. A tag created at `npm version` time points at the pre-merge commit, which never lands on master — leaving a tag whose `package.json` shows the *previous* version. This has bitten us; see the 2.3.1 release.

```bash
# 1. cut a release branch off a synced master
git fetch origin && git checkout master && git rebase origin/master
git checkout -b release/<version>

# 2. bump — commits artifacts and creates a local tag
npm version patch    # or minor / major / explicit e.g. 2.1.0

# 3. drop the tag it just made — it points at a commit that will not survive the squash
git tag -d v<version>

# 4. push the branch (token form — see Git authentication), open PR, merge it

# 5. tag the MERGED commit
git checkout master && git pull origin master
git tag -a v<version> -m "<version>"
git push origin v<version>

# 6. publish — JP only
npm publish
npm view n-get version    # confirm
```

`npm version` runs in sequence:
1. `preversion` → `scripts/prerelease-check.js` — guards branch (`master` or `release/*`), clean tree, sync with origin. Note: despite the script's header comment, it does **not** check for tag collision.
2. Bumps `package.json`
3. `version` → `scripts/sync-version.js` (updates `site/index.html`; `README.md` only if it carries a version string — currently it does not) + `npm run build` (rebuilds TS, regenerates `AGENTS.md`) + `git add -u`
4. Creates one commit with all artifacts + a `v<version>` tag ← **discard this tag, see step 3 above**

**If the build fails mid-run** (tsc error during step 3), npm aborts but `package.json` is already bumped. Recovery:
```bash
git checkout package.json
git tag -d v<version>   # only if tag was created before abort
```

**If a wrong tag already reached origin**, delete and recreate it — don't leave it. Deleting a GitHub Release does *not* delete its tag; remove the Release in the UI first, then:
```bash
git push origin :refs/tags/v<version>   # delete remote tag
git push origin v<version>              # push the corrected one
```
Verify with `git ls-remote --tags origin | grep v<version>` — for an annotated tag the `^{}` line is the commit, and it must equal `origin/master`.

Feature work goes on `feature/*` branches off master; releases go on `release/<version>` branches off master. Both merge via PR — there is no direct-to-master path.

### Release PR summary — required, generated whenever a release branch is pushed

Every time a `release/<version>` branch is pushed to origin (or about to be), generate a PR summary in the reply so JP can paste it into the GitHub PR body. Do this **proactively** — don't wait to be asked.

**Why:** the PR description is the artifact reviewers and downstream consumers read first. Generating it from the actual branch state (not from memory) keeps it accurate and saves JP from writing it twice.

**Format — paste-ready Markdown:**

1. **Title** — `release: <version> — <one-line theme>`
2. **Summary** — 1–3 sentence framing of *why* this release exists
3. **Highlights** — bullet list of user-visible additions (CLI flags, library exports, new files in the tarball, doc surfaces)
4. **Breaking changes** — explicit section if any. State the migration path inline.
5. **Versioned surface** — list the parts of the public contract this release touches (per SemVer section)
6. **Commits** — table of `SHA | description` for every commit in `origin/master..HEAD`. Use `git log origin/master..HEAD --oneline` as the source.
7. **Test plan** — checklist of what was verified (`npm test` count, `npm run build`, `npm pack --dry-run`, smoke checks). Mark items checked when actually verified.
8. **Out of scope** — what was deferred (helps reviewers calibrate scope and prevents "why didn't you also…" comments)

**How to generate:**
- Run `git log origin/master..HEAD --oneline` to get the commit list verbatim — don't invent SHAs.
- Run `git diff --stat origin/master..HEAD` to confirm the file surface.
- Use the current branch's actual test count, not a remembered number.

### Versioning — SemVer

We follow [Semantic Versioning 2.0.0](https://semver.org/) for `package.json` `version` and `release/<version>` branch names:

- **MAJOR** (`X.0.0`) — breaking changes to the public surface: removed/renamed CLI flags, renamed NDJSON event types, removed library exports, changed exit-code semantics, removed config keys.
- **MINOR** (`x.Y.0`) — backwards-compatible additions: new flags, new events, new library exports, new subcommands, new config keys.
- **PATCH** (`x.y.Z`) — backwards-compatible fixes: bug fixes, perf, internal refactors, doc-only changes.

The agent-facing surfaces (`nget --capabilities`, `nget --openapi-spec`, `AGENTS.md`, NDJSON event names, `--agent-id`/`--session-id`/`--request-id`/`--conversation-id` flag contracts) are part of the public contract and follow the same rules. **Treat the autogenerated `capabilities` JSON as a versioned contract** — agents in production may pin to specific keys.

When in doubt about whether a change is breaking, err on the higher bump. It's cheaper than a deprecation cycle.

## QA Bug Tracker

QA tracker is hosted on Tailscale (no auth required, Tailscale must be installed).

- **Host:** `http://QA_TRACKER_HOST`

**Check n-get bugs:**
```bash
curl http://QA_TRACKER_HOST/qa/bugs?project=n-get
```

**Update a ticket:**
```bash
curl -X PATCH http://QA_TRACKER_HOST/qa/bugs/<id> \
  -H "Content-Type: application/json" \
  -d '{"status":"fixed","verified_by":"claude-sonnet-4-6","fix_description":"..."}'
# status must be: verified | duplicate | wontfix | fixed | needs-retest | re-open
```

**Signal fix is ready for QA review:**
```bash
curl -X POST http://QA_TRACKER_HOST/operations/incidents \
  -H "Content-Type: application/json" \
  -d '{"project":"n-get","department":"qa","title":"Ready for QA","domain":"process","filed_by":"dev-external"}'
```

Duplicate detection is automatic — server returns 409 if same test + same expected/actual or >70% title similarity. -20 pts auto-applied.
