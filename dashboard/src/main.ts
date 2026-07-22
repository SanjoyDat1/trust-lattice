import "./styles.css";

interface GraphNode {
  id: string;
  kind: string;
  label: string;
  identity: { verification: string };
}

interface GraphEdge {
  fromId: string;
  toId: string;
  trust: number;
}

interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GateDecision {
  allowed: boolean;
  reasons: string[];
  trust: number;
  minTrust: number;
  endorsementCount: number;
  minEndorsements: number;
  action: string;
  riskTier: string;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app missing");
}

app.innerHTML = `
  <header>
    <h1>Trust Lattice</h1>
    <p>Evidence-weighted trust graph for multi-agent systems. Inspect nodes, edge trusts, and simulate risk-tiered gates before tool calls.</p>
  </header>
  <div class="layout">
    <div>
      <section>
        <h2>Nodes</h2>
        <div class="nodes" id="nodes"></div>
      </section>
      <section>
        <h2>Edges</h2>
        <div class="edges" id="edges"></div>
      </section>
    </div>
    <div>
      <section>
        <h2>Gate simulator</h2>
        <form id="gate-form">
          <label>Actor
            <select name="actorId" id="actorId"></select>
          </label>
          <label>Target
            <select name="targetId" id="targetId"></select>
          </label>
          <label>Risk tier
            <select name="riskTier">
              <option value="read">read</option>
              <option value="write" selected>write</option>
              <option value="irreversible">irreversible</option>
            </select>
          </label>
          <label>Action
            <input name="action" value="invoke tool" maxlength="256" />
          </label>
          <button type="submit">Evaluate gate</button>
        </form>
        <div class="decision" id="decision">Run a gate evaluation to see allow/deny reasons.</div>
      </section>
      <section>
        <h2>Mermaid export</h2>
        <pre class="mermaid-out" id="mermaid"></pre>
      </section>
    </div>
  </div>
`;

async function load(): Promise<void> {
  const [graphRes, mermaidRes] = await Promise.all([
    fetch("/api/graph"),
    fetch("/api/mermaid"),
  ]);
  const graph = (await graphRes.json()) as GraphPayload;
  const mermaid = await mermaidRes.text();

  const nodesEl = document.querySelector("#nodes");
  const edgesEl = document.querySelector("#edges");
  const mermaidEl = document.querySelector("#mermaid");
  const actorSel = document.querySelector<HTMLSelectElement>("#actorId");
  const targetSel = document.querySelector<HTMLSelectElement>("#targetId");
  if (!nodesEl || !edgesEl || !mermaidEl || !actorSel || !targetSel) {
    return;
  }

  nodesEl.replaceChildren();
  for (const n of graph.nodes) {
    const row = document.createElement("div");
    row.className = "node";
    const left = document.createElement("div");
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = n.label;
    const id = document.createElement("div");
    id.textContent = n.id;
    left.append(label, id);
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = `${n.kind} · ${n.identity.verification}`;
    row.append(left, badge);
    nodesEl.append(row);
  }

  edgesEl.replaceChildren();
  for (const e of graph.edges) {
    const row = document.createElement("div");
    const trust = document.createElement("span");
    trust.className = "edge-trust";
    trust.textContent = e.trust.toFixed(3);
    row.append(document.createTextNode(`${e.fromId} → ${e.toId} `), trust);
    edgesEl.append(row);
  }

  mermaidEl.textContent = mermaid;

  actorSel.replaceChildren();
  targetSel.replaceChildren();
  for (const n of graph.nodes) {
    const optA = document.createElement("option");
    optA.value = n.id;
    optA.textContent = n.id;
    actorSel.append(optA);
    const optT = document.createElement("option");
    optT.value = n.id;
    optT.textContent = n.id;
    targetSel.append(optT);
  }
  actorSel.value = "agent:planner";
  targetSel.value = "tool:shell";
}

document.querySelector("#gate-form")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target as HTMLFormElement;
  const data = new FormData(form);
  const res = await fetch("/api/gate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      actorId: data.get("actorId"),
      targetId: data.get("targetId"),
      riskTier: data.get("riskTier"),
      action: data.get("action"),
    }),
  });
  const decision = (await res.json()) as GateDecision & { error?: string };
  const el = document.querySelector("#decision");
  if (!el) return;
  if (decision.error) {
    el.className = "decision deny";
    el.textContent = decision.error;
    return;
  }
  el.className = `decision ${decision.allowed ? "allow" : "deny"}`;
  el.textContent = [
    decision.allowed ? "ALLOW" : "DENY",
    `action: ${decision.action} (${decision.riskTier})`,
    `trust: ${decision.trust.toFixed(3)} (min ${decision.minTrust})`,
    `endorsements: ${decision.endorsementCount} (min ${decision.minEndorsements})`,
    "",
    ...decision.reasons.map((r) => `• ${r}`),
  ].join("\n");
});

void load();
