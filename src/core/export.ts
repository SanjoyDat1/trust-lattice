import type { ExportFormat } from "../types.js";
import type { TrustEngine } from "./engine.js";

function escapeMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function escapeLabel(label: string): string {
  return label.replace(/"/g, '\\"');
}

export function exportGraph(engine: TrustEngine, format: ExportFormat): string {
  const nodes = engine.store.listNodes();
  const edges = engine.store.listEdges();

  if (format === "json") {
    const payload = {
      nodes,
      edges: edges.map((e) => {
        const q = engine.queryTrust(e.fromId, e.toId);
        return {
          ...e,
          trust: q.trust,
          alpha: q.alpha,
          beta: q.beta,
        };
      }),
      policyVersion: engine.policy.version,
      exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(payload, null, 2);
  }

  if (format === "mermaid") {
    const lines = ["flowchart LR"];
    for (const n of nodes) {
      const mid = escapeMermaidId(n.id);
      lines.push(
        `  ${mid}["${escapeLabel(n.label)}\\n(${n.kind}/${n.identity.verification})"]`,
      );
    }
    for (const e of edges) {
      const q = engine.queryTrust(e.fromId, e.toId);
      lines.push(
        `  ${escapeMermaidId(e.fromId)} -->|${q.trust.toFixed(2)}| ${escapeMermaidId(e.toId)}`,
      );
    }
    return lines.join("\n");
  }

  // Graphviz DOT
  const lines = [
    "digraph TrustLattice {",
    "  rankdir=LR;",
    '  node [shape=box, style="rounded,filled", fillcolor="#f5f5f5", fontname="Helvetica"];',
    '  edge [fontname="Helvetica", fontsize=10];',
  ];
  for (const n of nodes) {
    lines.push(
      `  "${escapeLabel(n.id)}" [label="${escapeLabel(n.label)}\\n${escapeLabel(n.kind)}"];`,
    );
  }
  for (const e of edges) {
    const q = engine.queryTrust(e.fromId, e.toId);
    const penwidth = (0.5 + q.trust * 2.5).toFixed(2);
    lines.push(
      `  "${escapeLabel(e.fromId)}" -> "${escapeLabel(e.toId)}" [label="${q.trust.toFixed(2)}", penwidth=${penwidth}];`,
    );
  }
  lines.push("}");
  return lines.join("\n");
}
