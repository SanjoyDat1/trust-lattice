# Trust Lattice

Evidence-weighted **trust graph / reputation lattice** for multi-agent systems. Nodes are agents, tools, and claim-sources. Edges carry time-decayed evidence (attestations, challenges, endorsements). High-risk actions are **gated** until trust thresholds and endorsement quorums are met.

Full **MCP** surface so orchestrators (Cursor, Claude Desktop, custom agents) can query trust before tool calls.

## Features

- Beta / Bayesian-ish trust updates with exponential evidence decay
- Path-trust aggregation (noisy-OR of path products)
- Sybil-resistance basics via identity verification stubs + influence caps
- JSON policy DSL for risk tiers: `read` | `write` | `irreversible`
- Explainable gate decisions (“why was this gated?”)
- Export: JSON, Mermaid, Graphviz DOT
- SQLite persistence, CLI, Vitest suite, optional Vite dashboard

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the math and model.

## Quick start

```bash
npm install
npm run build
npm run seed -- --force
npm test
```

### MCP server (stdio)

```bash
npm run serve
# or after build:
node dist/index.js
```

### Cursor MCP config

Add to your Cursor MCP settings (path may vary by OS):

```json
{
  "mcpServers": {
    "trust-lattice": {
      "command": "node",
      "args": ["/ABS/PATH/TO/trust-lattice/dist/index.js"],
      "env": {
        "TRUST_LATTICE_DB": "/ABS/PATH/TO/trust-lattice/data/trust-lattice.db",
        "TRUST_LATTICE_ADMIN_TOKEN": "replace-with-a-long-random-secret"
      }
    }
  }
}
```

Or during development:

```json
{
  "mcpServers": {
    "trust-lattice": {
      "command": "npx",
      "args": ["tsx", "/ABS/PATH/TO/trust-lattice/src/index.ts"],
      "env": {
        "TRUST_LATTICE_DB": "/ABS/PATH/TO/trust-lattice/data/trust-lattice.db",
        "TRUST_LATTICE_ADMIN_TOKEN": "replace-with-a-long-random-secret"
      }
    }
  }
}
```

Mutating tools (`tl_register_node`, `tl_attest`, `tl_challenge`, `tl_endorse`, `tl_promote_identity`, pubkey challenge tools) require an `adminToken` argument that matches `TRUST_LATTICE_ADMIN_TOKEN` (min 16 chars). Writes fail closed when the env token is unset.

### CLI

```bash
npx tsx src/cli.ts seed --force
npx tsx src/cli.ts query agent:planner tool:web-search
npx tsx src/cli.ts gate agent:planner tool:shell write "run sandbox command"
npx tsx src/cli.ts export mermaid
npx tsx src/cli.ts promote agent:researcher email --issuer research@acme.test
```

### Dashboard

```bash
npm run dev
# → http://127.0.0.1:5173
```

## MCP tools

| Tool | Description |
|------|-------------|
| `tl_register_node` | Register/update node (always unverified; needs `adminToken`) |
| `tl_promote_identity` | Operator promote verification level (`adminToken`) |
| `tl_begin_pubkey_challenge` / `tl_complete_pubkey_challenge` | Ed25519 proof → `pubkey` |
| `tl_attest` | Positive evidence on an edge (`adminToken`) |
| `tl_challenge` | Negative evidence on an edge (`adminToken`) |
| `tl_endorse` | Path-scaled endorsement (`adminToken`) |
| `tl_query_trust` | Decayed trust + paths (read) |
| `tl_gate_action` | Allow/deny with explanation (read; advisory) |
| `tl_explain_path` | Supporting paths (read) |
| `tl_export_graph` | `json` \| `mermaid` \| `dot` (read) |

## Policy

Default policy lives in [`policies/default.json`](policies/default.json). Override with `TRUST_LATTICE_POLICY` or `--policy`.

## Security

- Set `TRUST_LATTICE_ADMIN_TOKEN` (≥16 chars) for MCP writes; mutating tools fail closed without it.
- Clients cannot set `identity.verification` via `registerNode` / `tl_register_node` — only operator `promote` / `tl_promote_identity` or a completed Ed25519 pubkey challenge.
- Email/org verification remain operator stubs (no external IdP); pubkey requires a signature challenge.
- Treat the SQLite DB as sensitive operational state.
- MCP logs only to stderr (stdio transport).
- Dashboard binds to `127.0.0.1` by default.
- Gate decisions are advisory — orchestrators must enforce deny.

## License

MIT
