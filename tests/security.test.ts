import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthError, assertAdminToken } from "../src/auth/admin.js";
import {
  beginPubkeyChallenge,
  clearPubkeyChallenges,
  completePubkeyChallenge,
  PubkeyChallengeError,
} from "../src/auth/pubkey-challenge.js";
import { TrustEngine } from "../src/core/engine.js";
import { authorizeMcpWrite } from "../src/mcp/server.js";
import { clearWriteRateLimits } from "../src/mcp/rate-limit.js";
import { loadDefaultPolicy } from "../src/policy.js";
import { TrustStore } from "../src/store/db.js";

function tempEngine(): TrustEngine {
  const dir = mkdtempSync(join(tmpdir(), "trust-lattice-sec-"));
  const store = new TrustStore(join(dir, "test.db"));
  return new TrustEngine(store, loadDefaultPolicy());
}

afterEach(() => {
  clearPubkeyChallenges();
  clearWriteRateLimits();
  delete process.env.TRUST_LATTICE_ADMIN_TOKEN;
});

describe("TL-01 identity spoofing blocked", () => {
  it("ignores client-supplied identity.verification on registerNode", () => {
    const engine = tempEngine();
    const node = engine.registerNode({
      id: "agent:attacker",
      kind: "agent",
      label: "Attacker",
      // Spoof attempt — must not elevate caps/quorum
      identity: { verification: "org", issuer: "evil.example" },
    });
    expect(node.identity.verification).toBe("unverified");
    expect(node.identity.issuer).toBeUndefined();
    engine.store.close();
  });

  it("does not let spoofed registerNode meet irreversible endorsement quorum", () => {
    const engine = tempEngine();
    engine.registerNode({ id: "tool:pay", kind: "tool", label: "Pay" });
    engine.setIdentityVerification("tool:pay", { verification: "org" });

    // Attacker registers many "org" nodes via the public registration path
    for (let i = 0; i < 3; i++) {
      const id = `agent:sybil-${i}`;
      engine.registerNode({
        id,
        kind: "agent",
        label: `Sybil ${i}`,
        identity: { verification: "org" },
      });
      engine.attest({
        fromId: id,
        toId: "tool:pay",
        actorId: id,
        strength: 1,
      });
      engine.endorse({
        toId: "tool:pay",
        actorId: id,
        strength: 1,
      });
    }

    engine.registerNode({
      id: "agent:actor",
      kind: "agent",
      label: "Actor",
      identity: { verification: "org" },
    });
    engine.attest({
      fromId: "agent:actor",
      toId: "tool:pay",
      actorId: "agent:actor",
      strength: 1,
    });

    const decision = engine.gateAction({
      actorId: "agent:actor",
      targetId: "tool:pay",
      riskTier: "irreversible",
      action: "send money",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.endorsementCount).toBe(0);
    expect(
      decision.reasons.some((r) => /Endorsements|unverified|Trust/i.test(r)),
    ).toBe(true);
    engine.store.close();
  });

  it("operator setIdentityVerification elevates and counts toward quorum", () => {
    const engine = tempEngine();
    engine.registerNode({ id: "tool:pay", kind: "tool", label: "Pay" });
    engine.setIdentityVerification("tool:pay", { verification: "org" });
    engine.registerNode({ id: "agent:ops", kind: "agent", label: "Ops" });
    engine.setIdentityVerification("agent:ops", {
      verification: "org",
      issuer: "acme",
    });
    engine.registerNode({ id: "agent:actor", kind: "agent", label: "Actor" });
    engine.setIdentityVerification("agent:actor", { verification: "email" });

    engine.attest({
      fromId: "agent:actor",
      toId: "tool:pay",
      actorId: "agent:actor",
      strength: 1,
    });
    engine.attest({
      fromId: "agent:ops",
      toId: "tool:pay",
      actorId: "agent:ops",
      strength: 1,
    });
    engine.endorse({
      toId: "tool:pay",
      actorId: "agent:ops",
      strength: 1,
    });

    // Need enough endorsements per default irreversible policy
    engine.registerNode({ id: "agent:ops2", kind: "agent", label: "Ops2" });
    engine.setIdentityVerification("agent:ops2", { verification: "pubkey" });
    engine.attest({
      fromId: "agent:ops2",
      toId: "tool:pay",
      actorId: "agent:ops2",
      strength: 1,
    });
    engine.endorse({
      toId: "tool:pay",
      actorId: "agent:ops2",
      strength: 1,
    });

    const q = engine.queryTrust("agent:actor", "tool:pay");
    expect(q.endorsementCount).toBeGreaterThanOrEqual(2);
    engine.store.close();
  });

  it("pubkey challenge requires valid Ed25519 signature", () => {
    const engine = tempEngine();
    engine.registerNode({ id: "agent:k", kind: "agent", label: "Keyed" });
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const { challenge } = beginPubkeyChallenge("agent:k");
    const signature = sign(null, Buffer.from(challenge, "utf8"), privateKey).toString(
      "base64",
    );
    const { issuer } = completePubkeyChallenge("agent:k", spki, signature);
    const node = engine.setIdentityVerification("agent:k", {
      verification: "pubkey",
      issuer,
    });
    expect(node.identity.verification).toBe("pubkey");
    expect(node.identity.issuer?.startsWith("ed25519:")).toBe(true);

    expect(() =>
      completePubkeyChallenge("agent:k", spki, signature),
    ).toThrow(PubkeyChallengeError);
    engine.store.close();
  });
});

describe("TL-02 unauthenticated MCP writes blocked", () => {
  it("fails closed when TRUST_LATTICE_ADMIN_TOKEN is unset", () => {
    delete process.env.TRUST_LATTICE_ADMIN_TOKEN;
    expect(() => assertAdminToken("anything-long-enough")).toThrow(AuthError);
    expect(() => authorizeMcpWrite("anything-long-enough", "tl_attest")).toThrow(
      AuthError,
    );
  });

  it("rejects missing or wrong adminToken when configured", () => {
    process.env.TRUST_LATTICE_ADMIN_TOKEN = "test-admin-token-ok";
    expect(() => authorizeMcpWrite(undefined, "tl_attest")).toThrow(AuthError);
    expect(() => authorizeMcpWrite("", "tl_attest")).toThrow(AuthError);
    expect(() => authorizeMcpWrite("wrong-admin-token!!", "tl_attest")).toThrow(
      AuthError,
    );
    expect(() =>
      authorizeMcpWrite("test-admin-token-ok", "tl_attest"),
    ).not.toThrow();
  });

  it("rejects short configured tokens (fail closed)", () => {
    process.env.TRUST_LATTICE_ADMIN_TOKEN = "short";
    expect(() => authorizeMcpWrite("short", "tl_register_node")).toThrow(
      AuthError,
    );
  });
});
