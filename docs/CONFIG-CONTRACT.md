# Configuration contract

n-get advertises its configuration surface to agents through `nget config show`,
`nget --capabilities`, and `config/default.yaml`. Agents read those surfaces and
act on them, so a key that appears there and changes nothing is not cosmetic
debt — it is wrong information delivered to a caller that cannot tell.

This document records the two invariants that keep that surface honest, why they
exist, and how they are enforced.

## The two invariants

**1. Every key the schema accepts must be read by something.**

A key that validates, defaults, and appears in `nget config show` while reaching
no code is indistinguishable — from the outside — from one that works.

**2. Every key shipped in `config/default.yaml` must exist in the schema.**

Validation runs with `stripUnknown: true`. A documented key the schema does not
declare is deleted at load. It looks supported and evaporates.

## Why these are enforced rather than trusted

Both have been violated in shipped releases.

| issue | what happened |
|---|---|
| #154 | Documented security keys did not take effect. |
| #164 | `security.certificateValidation` validated, defaulted, appeared in `config show`, and reached no code. Setting it `false` changed a label; TLS verification stayed on regardless. |
| #175 | `ssh` and `webhooks` — two entire top-level sections — shipped in `default.yaml` but were absent from the schema, so both were stripped at load. `DownloadSession` read four `webhooks.*` paths that all resolved to `undefined` behind `??` fallbacks. Configuring webhooks or SSH through a config file had never had any effect. |

The first two were found by hand, one at a time, after release. An audit
afterwards found a dozen more of the same shape, and the third was found by the
guard built in response.

The pattern is consistent: these failures are invisible because nothing errors.
The config loads, the command succeeds, the key is simply ignored.

## How they are enforced

`test/configKeyGuardSpec.js` checks both invariants on every run.

The codebase does not yet satisfy them, and some remaining violations are
blocked on product decisions. So the check is a **ratchet** rather than a
pass/fail invariant: each invariant carries an allowlist of the violations that
exist today, and the assertion is exact equality.

- A **new** violation is absent from the allowlist, and fails.
- A **fixed** violation leaves a stale entry, and fails until the line is removed.

The lists can only shrink. They double as the live inventory of the remaining
debt, and when one reaches `[]` that invariant becomes unconditional with no
further work.

> Do not add an entry to an allowlist to make a build pass. An addition means a
> key was shipped that does nothing — fix the key.

### Detection is deliberately conservative

A key counts as unread only when its name appears nowhere outside the Joi schema
and the dotted-path alias map in `ConfigManager`. Those two places mention every
key by name, so a scan that counts them as readers finds nothing wrong; the
helper strips them first.

This yields no false positives. The cost is missing a dead key whose leaf name
collides with a common property — `enabled`, `port`, `host`. Those are listed
below rather than detected.

A guard that cries wolf gets disabled. One that under-reports still catches the
recurrence pattern that actually occurs: a key is added and never wired.

## Known-dead keys the scan cannot see

Verified dead by inspection, invisible to a static scan:

| key | why it is dead |
|---|---|
| `development.hotReload` | Hot reload is real — `ConfigManager` watches files with `fs.watch` — but it is gated on the `enableHotReload` **constructor option**. The config key never reaches it. |
| `monitoring.enabled` | Leaf name `enabled` appears throughout the codebase. |
| `ai.mcp.enabled` | The MCP server is a separate binary (`nget-mcp`); a config flag does not gate it. |
| `ai.mcp.port`, `ai.mcp.host` | MCP transport is stdio. Both are meaningless until HTTP transport lands. |

They are left out of the allowlists so those stay mechanically derived rather
than hand-maintained.

## Adding a configuration key

1. Declare it in the Joi schema in `ConfigManager.createValidationSchema()`.
2. Ship a default in `config/default.yaml`.
3. Add an entry to the `toCamelCase` alias map **if** the leaf name is
   camelCase — that map is what makes `NGET_*` environment overrides resolve.
4. Mirror it in `NgetConfig` in `types/index.ts`.
5. **Read it somewhere.** If nothing consumes it yet, do not ship it.
6. Cover it with a test that asserts the configured value changes behaviour,
   not merely that it round-trips through `config.get()`.

Step 5 is the one that has failed repeatedly. A key with no reader is not
"scaffolding for later" — it is a claim the tool cannot honour, and the guard
will reject it.
