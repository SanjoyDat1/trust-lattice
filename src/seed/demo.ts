import type { TrustEngine } from "../core/engine.js";

/** Populate a demo multi-agent trust lattice for local exploration and tests. */
export function seedDemoGraph(engine: TrustEngine, options?: { force?: boolean }): void {
  if (options?.force) {
    engine.store.clearAll();
  } else if (engine.store.listNodes().length > 0) {
    return;
  }

  engine.registerNode({
    id: "agent:orchestrator",
    kind: "agent",
    label: "Orchestrator",
    identity: { verification: "org", issuer: "acme.internal" },
  });
  engine.registerNode({
    id: "agent:planner",
    kind: "agent",
    label: "Planner",
    identity: { verification: "pubkey", issuer: "did:key:planner" },
  });
  engine.registerNode({
    id: "agent:researcher",
    kind: "agent",
    label: "Researcher",
    identity: { verification: "email", issuer: "research@acme.test" },
  });
  engine.registerNode({
    id: "agent:sybil-bot",
    kind: "agent",
    label: "Sybil Bot",
    identity: { verification: "unverified" },
  });
  engine.registerNode({
    id: "tool:web-search",
    kind: "tool",
    label: "Web Search",
    identity: { verification: "org", issuer: "acme.tools" },
  });
  engine.registerNode({
    id: "tool:shell",
    kind: "tool",
    label: "Shell Executor",
    identity: { verification: "org", issuer: "acme.tools" },
  });
  engine.registerNode({
    id: "tool:payments",
    kind: "tool",
    label: "Payments API",
    identity: { verification: "org", issuer: "acme.tools" },
  });
  engine.registerNode({
    id: "source:docs",
    kind: "claim_source",
    label: "Internal Docs",
    identity: { verification: "org", issuer: "acme.internal" },
  });
  engine.registerNode({
    id: "source:rumor",
    kind: "claim_source",
    label: "Rumor Feed",
    identity: { verification: "unverified" },
  });

  // Strong orchestrator trust in planner
  engine.attest({
    fromId: "agent:orchestrator",
    toId: "agent:planner",
    actorId: "agent:orchestrator",
    strength: 0.9,
    note: "Planner passes canaries",
  });
  engine.endorse({
    fromId: "agent:orchestrator",
    toId: "agent:planner",
    actorId: "agent:orchestrator",
    strength: 0.8,
    note: "Org endorsement",
  });

  // Planner trusts researcher and web search
  engine.attest({
    fromId: "agent:planner",
    toId: "agent:researcher",
    actorId: "agent:planner",
    strength: 0.75,
    note: "Consistent citations",
  });
  engine.attest({
    fromId: "agent:planner",
    toId: "tool:web-search",
    actorId: "agent:planner",
    strength: 0.8,
    note: "Read-only search tool",
  });
  engine.endorse({
    toId: "tool:web-search",
    actorId: "agent:planner",
    strength: 0.7,
    note: "Safe for research",
  });

  // Researcher path to docs
  engine.attest({
    fromId: "agent:researcher",
    toId: "source:docs",
    actorId: "agent:researcher",
    strength: 0.85,
    note: "Canonical docs",
  });
  engine.attest({
    fromId: "agent:researcher",
    toId: "tool:web-search",
    actorId: "agent:researcher",
    strength: 0.7,
    note: "Useful for retrieval",
  });

  // Weak / adversarial edges
  engine.attest({
    fromId: "agent:sybil-bot",
    toId: "tool:payments",
    actorId: "agent:sybil-bot",
    strength: 1,
    note: "Sybil self-boost attempt",
  });
  engine.challenge({
    fromId: "agent:orchestrator",
    toId: "source:rumor",
    actorId: "agent:orchestrator",
    strength: 0.9,
    note: "Unreliable claims",
  });
  engine.challenge({
    fromId: "agent:planner",
    toId: "tool:shell",
    actorId: "agent:planner",
    strength: 0.4,
    note: "Needs tighter sandbox before write trust",
  });

  // Partial trust toward shell — not enough for irreversible alone
  engine.attest({
    fromId: "agent:orchestrator",
    toId: "tool:shell",
    actorId: "agent:orchestrator",
    strength: 0.55,
    note: "Sandboxed shell allowed for ops",
  });
  engine.endorse({
    toId: "tool:shell",
    actorId: "agent:planner",
    strength: 0.6,
    note: "Conditional endorse",
  });

  // Payments heavily gated
  engine.attest({
    fromId: "agent:orchestrator",
    toId: "tool:payments",
    actorId: "agent:orchestrator",
    strength: 0.4,
    note: "Provisional — awaiting dual control",
  });
}
