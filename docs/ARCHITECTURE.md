# Trust Lattice — Architecture

Evidence-weighted trust graph for multi-agent systems. Nodes are agents, tools, and claim-sources. Edges accumulate attestations, challenges, and endorsements. High-risk actions are **gated** until trust thresholds (and optional quorum rules) are met. An MCP server lets orchestrators query trust before tool calls.

## Goals

- Make “should this agent call that tool?” an explicit, explainable decision.
- Persist a local trust graph (SQLite) with time-decayed evidence.
- Expose a stable MCP tool surface for Cursor and other hosts.
- Prefer explainability over opaque scores (“why was this gated?”).

## Non-goals

- Global PKI / cryptographic identity (stubs only in v1).
- Distributed consensus or multi-writer replication.
- Automatic enforcement inside arbitrary runtimes (callers must honor `tl_gate_action`).

## System diagram

```
┌─────────────┐     stdio MCP      ┌──────────────────┐
│  Cursor /   │ ◄────────────────► │  trust-lattice   │
│  orchestrator│                    │  MCP server      │
└─────────────┘                    └────────┬─────────┘
                                            │
                                   ┌────────▼─────────┐
                                   │  TrustEngine      │
                                   │  gate + paths     │
                                   └────────┬─────────┘
                                            │
                                   ┌────────▼─────────┐
                                   │  SQLite store     │
                                   │  nodes/edges/ev   │
                                   └──────────────────┘
```

Optional Vite dashboard reads the same SQLite file (read-mostly) for visualization.

## Core model

### TrustNode

| Field | Meaning |
|-------|---------|
| `id` | Stable string id (`agent:planner`, `tool:shell`, …) |
| `kind` | `agent` \| `tool` \| `claim_source` |
| `label` | Human-readable name |
| `identity` | Sybil stub: `verification` ∈ `unverified` \| `email` \| `pubkey` \| `org`, optional `issuer` |
| `metadata` | Free-form JSON |
| `createdAt` | ISO timestamp |

### TrustEdge

Directed edge `from → to` with sufficient statistics for a Beta posterior:

| Field | Meaning |
|-------|---------|
| `alpha`, `beta` | Beta(α, β) parameters (prior + evidence) |
| `updatedAt` | Last evidence application |

Trust weight at query time:

\[
T(e) = \frac{\alpha}{\alpha + \beta} \in (0,1)
\]

### Evidence

Append-only events that update an edge:

| Kind | Effect |
|------|--------|
| `attestation` | Positive: increases α |
| `endorsement` | Positive, strength scaled by endorser’s path-trust to subject |
| `challenge` | Negative: increases β |
| `observation` | Mild positive/negative from runtime outcomes |

Each evidence row stores `strength` ∈ (0,1], `halfLifeHours`, `actorId`, `note`, `createdAt`.

### Attestation / Challenge / Endorsement

Thin wrappers over Evidence creation with validation:

- Attestor/challenger/endorser must exist as a node.
- Self-attestations are allowed but **discounted** (identity policy).
- Unverified actors have capped influence (sybil resistance).

### TrustPolicy (JSON DSL)

Risk tiers map action classes to thresholds:

```json
{
  "version": 1,
  "priors": { "alpha": 1, "beta": 1 },
  "decay": { "defaultHalfLifeHours": 168 },
  "identity": {
    "influenceCaps": {
      "unverified": 0.25,
      "email": 0.5,
      "pubkey": 0.85,
      "org": 1.0
    },
    "selfAttestDiscount": 0.35
  },
  "path": {
    "maxDepth": 4,
    "minEdgeTrust": 0.15,
    "aggregation": "noisy_or_product"
  },
  "tiers": {
    "read": { "minTrust": 0.35, "minEndorsements": 0 },
    "write": { "minTrust": 0.55, "minEndorsements": 1 },
    "irreversible": { "minTrust": 0.75, "minEndorsements": 2, "requireVerifiedActor": true }
  }
}
```

## Trust mathematics

### 1. Evidence application (Bayesian-ish Beta update)

Prior for a new edge: \(\mathrm{Beta}(\alpha_0, \beta_0)\) from policy (default Jeffreys-ish `(1,1)`).

Given evidence with raw strength \(s \in (0,1]\) and effective strength \(s'\) after identity caps / discounts:

- Positive (attestation, endorsement, positive observation):

\[
\alpha \leftarrow \alpha + s',\quad \beta \leftarrow \beta
\]

- Negative (challenge, negative observation):

\[
\beta \leftarrow \beta + s',\quad \alpha \leftarrow \alpha
\]

Endorsement strength is further scaled by the endorser’s **path trust** toward the subject (weak endorsers add little).

### 2. Time decay

Evidence does not rewrite history; at **query** time we recompute effective α′, β′ by decaying each evidence contribution:

\[
w(t) = 2^{-(\mathrm{ageHours}/h)}
\]

where \(h\) is the evidence half-life (or policy default). Then:

\[
\alpha' = \alpha_0 + \sum_{+} s'_i\, w(t_i),\quad
\beta' = \beta_0 + \sum_{-} s'_i\, w(t_i)
\]

\[
T(e,t) = \frac{\alpha'}{\alpha' + \beta'}
\]

Stale positive evidence fades; old challenges also fade (forgiveness), which is intentional for multi-agent remediation.

### 3. Path-trust aggregation

Direct edge trust is preferred when present. Otherwise we search directed paths up to `maxDepth`, discarding edges below `minEdgeTrust`.

Path score (product of edge trusts — conservative “weakest-link product”):

\[
P(\pi) = \prod_{e \in \pi} T(e)
\]

Multiple paths aggregate with **noisy-OR of products** (default):

\[
T_{\mathrm{path}}(A\!\to\!B) = 1 - \prod_{\pi} (1 - P(\pi))
\]

This rewards independent support paths without exceeding 1. Alternative `max_product` uses \(\max_\pi P(\pi)\).

### 4. Sybil-resistance basics

1. **Influence caps** by `identity.verification` (unverified nodes cannot swing irreversible gates alone).
2. **Endorsement quorum** per risk tier (`minEndorsements` from distinct verified actors).
3. **Self-attest discount** so bootstrapping is possible but weak.
4. Identity is a **stub**: no crypto verification in v1 — callers supply declared levels; production deployments should wire real identity providers later.

## Gate evaluation

`tl_gate_action({ actorId, targetId, riskTier, action })`:

1. Resolve policy tier (`read` | `write` | `irreversible`).
2. Compute trust score: direct edge if any, else best path aggregate from actor → target.
3. Count distinct qualifying endorsements of target (evidence kind `endorsement`, non-decayed below floor).
4. If `requireVerifiedActor` and actor is `unverified` → **deny**.
5. Allow iff `trust >= minTrust` AND `endorsements >= minEndorsements`.

### Explainability report

Denied (or allowed) decisions return:

- computed trust, threshold, endorsement count
- chosen path (node ids + per-edge trust)
- decaying evidence summaries
- human-readable `reasons[]` (“trust 0.41 < write threshold 0.55”, “need 1 more endorsement”)

## MCP surface

| Tool | Purpose |
|------|---------|
| `tl_register_node` | Upsert agent/tool/claim_source |
| `tl_attest` | Positive evidence |
| `tl_challenge` | Negative evidence |
| `tl_endorse` | Endorsement (path-scaled) |
| `tl_query_trust` | Score + optional path |
| `tl_gate_action` | Allow/deny + explanation |
| `tl_explain_path` | Best supporting paths |
| `tl_export_graph` | JSON / Mermaid / Graphviz DOT |

**STDIO rule:** never write to stdout except MCP JSON-RPC; log with `console.error`.

Patterns follow the official TypeScript tutorial: `McpServer` + `registerTool` + Zod schemas + `StdioServerTransport` ([Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server)).

## Persistence

SQLite via `better-sqlite3`:

- `nodes`, `edges`, `evidence`, `meta`
- Single-writer local file (`TRUST_LATTICE_DB` or `./data/trust-lattice.db`)
- Migrations applied on open

## CLI

`trust-lattice` / `npx trust-lattice`:

- `serve` — run MCP on stdio
- `seed` — load demo graph
- `gate` — evaluate an action from the shell
- `export` — dump Mermaid/DOT/JSON

## Dashboard

Optional Vite SPA (`npm run dev`) that:

- Lists nodes and edge trusts
- Shows gate simulator
- Renders Mermaid from `tl_export_graph`

## Security notes

- No secrets in repo; DB is local plaintext trust data (treat as sensitive operational state).
- MCP tools validate IDs and clamp strengths; no shell execution from graph data.
- Policy files are JSON only — no code execution DSL.
- Dashboard binds localhost by default.

## Extension points

- Pluggable identity verifiers
- HTTP/SSE MCP transport
- Evidence signed with agent keys
- Multi-tenant DB isolation
