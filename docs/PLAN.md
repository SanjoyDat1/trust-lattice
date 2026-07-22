# Trust Lattice — Implementation Plan

## Phase 0 — Research (done before code)

- [x] Read MCP TypeScript build-server docs: `McpServer`, `registerTool`, Zod `inputSchema`, `StdioServerTransport`, stderr-only logging.
- [x] Capture architecture decisions in `docs/ARCHITECTURE.md`.
- [x] Browser MCP tab creation attempted; navigation flaky in subagent — docs fetched via WebFetch; dashboard verified via HTTP.

## Phase 1–5 — Complete

Scaffold, core library, MCP + CLI, Vite dashboard, tests, and security remediation are implemented.

## Phase 6 — Ship

1. [x] Conventional commits.
2. [x] `gh repo create SanjoyDat1/trust-lattice --public --source=. --remote=origin --push`

## Acceptance checklist

- [x] All eight MCP tools implemented
- [x] Trust decay + path aggregation + gate explanations
- [x] Policy JSON risk tiers
- [x] Mermaid + Graphviz export
- [x] Seed + tests green
- [x] README with Cursor config
- [x] No secrets
- [x] GitHub public repo pushed
