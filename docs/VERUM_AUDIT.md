# Verum Audit — trust-lattice

**Date:** 2026-07-22  
**Verdict:** FAIL at audit time (Critical + High) → **TL-01/TL-02 remediated** (see Remediation)  
**Auditor:** Verum-driven audit agent (`user-verum` MCP)

## Verum tools used

| Tool | Purpose |
|------|---------|
| `brain_search` | Discover prior decisions; re-check identity spoofing & MCP write surface |
| `brain_learn` | Register architecture + verified Critical/High outcomes with `code_refs` |
| `mcp_auth` | Available; not required (`serverStatus: ready`) |

## Verum call log (summary)

| Pass | Calls | Focus |
|------|-------|-------|
| 1 | `brain_search` ×2, `brain_learn` ×1 | Discover/register Feature:trust-lattice |
| 2 | `brain_search` ×1 | Verify identity.verification spoof path vs sybil claims |
| 3 | `brain_learn` ×1, `brain_search` ×2 | Deep-dive engine + MCP + policy; record verification |

Approximate Verum MCP calls for this project: **7** (shared multi-project session total ~20+).

## Test / typecheck

| Command | Result |
|---------|--------|
| `npm test` | PASS — 16/16 (post-remediation) |
| `npm run typecheck` | PASS |

## Findings

### TL-01 — Client-spoofable identity verification (Critical)

- **Where:** `src/mcp/server.ts` (`tl_register_node` → `identity.verification`), `src/core/engine.ts` (`influenceCap`, `endorsementCount`, `gateAction`)
- **Issue:** MCP clients may set `verification` to `email` | `pubkey` | `org` with **no proof**. Influence caps (`org` = 1.0) and irreversible-tier endorsement quorum treat this field as authoritative. Unverified endorsements are ignored for quorum, so an attacker registers multiple “verified” nodes and endorses to unlock irreversible gates.
- **Impact:** Sybil-resistance / influence caps are ineffective; gate decisions can be fabricated.
- **Fix:**  
  1. Default MCP registration to `unverified` only; ignore client-supplied verification.  
  2. Separate operator-only CLI/API (env secret) to promote identity levels.  
  3. Require real pubkey signature challenge before `pubkey`/`org`.  
  4. Document that current verification is a stub.

### TL-02 — Unauthenticated mutable trust graph via MCP (High)

- **Where:** `src/mcp/server.ts` — `tl_attest`, `tl_challenge`, `tl_endorse`, `tl_register_node`
- **Issue:** Any holder of the stdio MCP connection can rewrite evidence. Acceptable for a single trusted local agent; unsafe if the MCP process is shared or exposed.
- **Fix:** Capability tokens / admin secret for write tools; read-only default; rate-limit evidence inserts.

### TL-03 — Gate is advisory only (Medium–High, design)

- **Where:** `TrustEngine.gateAction`
- **Issue:** Returns allow/deny JSON; does not wrap or prevent tool execution. Orchestrators must enforce.
- **Fix:** Document clearly; offer middleware helper that throws/blocks on deny.

### TL-04 — Dashboard API unauthenticated on loopback (Medium)

- **Where:** `dashboard/vite.config.ts` — `/api/graph`, `/api/mermaid`, `/api/gate`
- **Mitigation present:** `host: "127.0.0.1"`.
- **Residual:** Local malware / other users on same machine can read graph / probe gates.
- **Fix:** Optional shared secret header for dashboard API.

### Positive controls

- Parameterized SQLite (`better-sqlite3`)
- Self-attest discount + influence caps (when verification is honest)
- Zod bounds on MCP inputs; sanitized error messages for unknown failures
- Dashboard loopback bind

## Recommended priority

1. **Block client-set verification on MCP** (Critical)  
2. Gate write tools behind operator auth  
3. Clarify advisory gate + add enforcement helper  

## Pass/fail

**FAIL** — Critical identity spoofing confirmed under Verum verification + source review. Do not treat gate results as trustworthy until TL-01 is fixed.

## Remediation (2026-07-22)

### What changed

| Finding | Status | Change |
|---------|--------|--------|
| **TL-01** Critical | **Fixed** | `TrustEngine.registerNode` ignores client `identity` — new nodes are always `unverified`; updates preserve existing identity. Elevation only via `setIdentityVerification` (CLI `promote`, MCP `tl_promote_identity` with admin token) or Ed25519 pubkey challenge (`tl_begin_pubkey_challenge` / `tl_complete_pubkey_challenge`). |
| **TL-02** High | **Fixed** | All MCP mutating tools require `adminToken` matching `TRUST_LATTICE_ADMIN_TOKEN` (min 16 chars, timing-safe compare). Fail closed when unset/short. Sliding-window rate limit on authenticated writes. Read tools remain open. |
| **TL-03** Medium–High | Documented | Gate description notes advisory-only; orchestrators must enforce. |
| **TL-04** Medium | Unchanged | Dashboard still loopback-only; optional API secret deferred. |

**Code refs:** `src/core/engine.ts`, `src/auth/admin.ts`, `src/auth/pubkey-challenge.ts`, `src/mcp/server.ts`, `src/mcp/rate-limit.ts`, `src/cli.ts`, `tests/security.test.ts`

**Tests:** spoofed `identity.verification` on register stays unverified and cannot satisfy irreversible endorsement quorum; unauthenticated / wrong / missing admin token blocked; valid Ed25519 challenge promotes to `pubkey`.

### Residual risk

- **Email/org verification** remain operator stubs — a holder of `TRUST_LATTICE_ADMIN_TOKEN` can still promote arbitrarily; there is no external IdP proof.
- **Stdio MCP** trust model: anyone who can invoke the MCP process *and* knows the admin token can mutate the graph; protect the token like a root secret.
- **Direct SQLite / library access** still bypasses MCP/CLI auth (host compromise = full graph control).
- **Gate remains advisory** (TL-03) — deny responses do not wrap tool execution.
- **Dashboard APIs** (TL-04) still unauthenticated on loopback.
- **Read MCP tools** remain unauthenticated by design (graph export/query).
- Post-remediation security-auditor: **0 Critical / 0 High**; Mediums around CLI promote and rate-limit keys addressed in follow-up hardening.

### Re-audit note

After remediation, TL-01/TL-02 should re-verify as mitigated. Overall product risk drops from Critical to Medium (advisory gate + stub email/org + loopback dashboard).
