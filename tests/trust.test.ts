import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TrustEngine } from "../src/core/engine.js";
import { computeBeta } from "../src/math/beta.js";
import { decayWeight } from "../src/math/decay.js";
import { findTrustPaths } from "../src/math/path.js";
import { loadDefaultPolicy } from "../src/policy.js";
import { seedDemoGraph } from "../src/seed/demo.js";
import { TrustStore } from "../src/store/db.js";

function tempEngine(): TrustEngine {
  const dir = mkdtempSync(join(tmpdir(), "trust-lattice-"));
  const store = new TrustStore(join(dir, "test.db"));
  return new TrustEngine(store, loadDefaultPolicy());
}

describe("decay", () => {
  it("halves at half-life", () => {
    expect(decayWeight(168, 168)).toBeCloseTo(0.5, 5);
    expect(decayWeight(0, 168)).toBe(1);
  });
});

describe("beta", () => {
  it("updates trust from positive and negative evidence", () => {
    const now = new Date("2026-07-22T00:00:00Z");
    const pos = computeBeta(
      1,
      1,
      [
        {
          polarity: 1,
          strength: 1,
          halfLifeHours: 1000,
          createdAt: now.toISOString(),
        },
      ],
      now,
    );
    expect(pos.trust).toBeCloseTo(2 / 3, 5);

    const neg = computeBeta(
      1,
      1,
      [
        {
          polarity: -1,
          strength: 1,
          halfLifeHours: 1000,
          createdAt: now.toISOString(),
        },
      ],
      now,
    );
    expect(neg.trust).toBeCloseTo(1 / 3, 5);
  });

  it("decays old evidence", () => {
    const now = new Date("2026-07-22T00:00:00Z");
    const old = new Date("2026-01-01T00:00:00Z").toISOString();
    const fresh = computeBeta(
      1,
      1,
      [
        {
          polarity: 1,
          strength: 2,
          halfLifeHours: 24,
          createdAt: old,
        },
      ],
      now,
    );
    // Nearly back to prior after many half-lives
    expect(fresh.trust).toBeLessThan(0.55);
    expect(fresh.trust).toBeGreaterThan(0.49);
  });
});

describe("path aggregation", () => {
  it("aggregates multiple paths with noisy-OR", () => {
    const { trust, paths } = findTrustPaths(
      [
        { fromId: "A", toId: "B", trust: 0.8 },
        { fromId: "B", toId: "C", trust: 0.8 },
        { fromId: "A", toId: "C", trust: 0.5 },
      ],
      "A",
      "C",
      { maxDepth: 3, minEdgeTrust: 0.1, aggregation: "noisy_or_product" },
    );
    expect(paths.length).toBeGreaterThanOrEqual(2);
    // direct 0.5 and path 0.64 → 1 - (1-0.5)*(1-0.64) = 0.82
    expect(trust).toBeCloseTo(0.82, 2);
  });
});

describe("engine gate", () => {
  it("allows read on trusted search tool after seed", () => {
    const engine = tempEngine();
    seedDemoGraph(engine, { force: true });
    const decision = engine.gateAction({
      actorId: "agent:planner",
      targetId: "tool:web-search",
      riskTier: "read",
      action: "search web",
    });
    expect(decision.allowed).toBe(true);
    engine.store.close();
  });

  it("denies irreversible payments for unverified sybil", () => {
    const engine = tempEngine();
    seedDemoGraph(engine, { force: true });
    const decision = engine.gateAction({
      actorId: "agent:sybil-bot",
      targetId: "tool:payments",
      riskTier: "irreversible",
      action: "send money",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => /unverified|Trust|Endorsements/i.test(r))).toBe(
      true,
    );
    engine.store.close();
  });

  it("caps unverified influence vs org attestation", () => {
    const engine = tempEngine();
    engine.registerNode({
      id: "a",
      kind: "agent",
      label: "A",
    });
    engine.setIdentityVerification("a", { verification: "org" });
    engine.registerNode({
      id: "b",
      kind: "agent",
      label: "B",
    });
    engine.registerNode({
      id: "t",
      kind: "tool",
      label: "T",
    });
    engine.setIdentityVerification("t", { verification: "org" });
    engine.attest({
      fromId: "a",
      toId: "t",
      actorId: "a",
      strength: 0.5,
      note: "org",
    });
    const before = engine.queryTrust("a", "t").trust;
    engine.attest({
      fromId: "b",
      toId: "t",
      actorId: "b",
      strength: 1,
      note: "sybil spam on different edge",
    });
    // Edge a→t unchanged by sybil's separate edge
    expect(engine.queryTrust("a", "t").trust).toBeCloseTo(before, 5);
    // Sybil edge trust should be pulled toward prior due to influence cap
    const sybilTrust = engine.queryTrust("b", "t").trust;
    expect(sybilTrust).toBeLessThan(0.7);
    engine.store.close();
  });

  it("exports mermaid and dot", () => {
    const engine = tempEngine();
    seedDemoGraph(engine, { force: true });
    const mermaid = engine.export("mermaid");
    expect(mermaid).toContain("flowchart LR");
    expect(mermaid).toContain("agent_planner");
    const dot = engine.export("dot");
    expect(dot).toContain("digraph TrustLattice");
    engine.store.close();
  });

  it("explains write gate denial with reasons", () => {
    const engine = tempEngine();
    seedDemoGraph(engine, { force: true });
    const decision = engine.gateAction({
      actorId: "agent:researcher",
      targetId: "tool:payments",
      riskTier: "write",
      action: "charge card",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.length).toBeGreaterThan(0);
    engine.store.close();
  });
});
