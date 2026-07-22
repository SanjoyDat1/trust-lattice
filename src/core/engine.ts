import { randomUUID } from "node:crypto";
import { clampStrength, computeBeta } from "../math/beta.js";
import { ageHours, decayWeight } from "../math/decay.js";
import { findTrustPaths } from "../math/path.js";
import type {
  Evidence,
  EvidenceInput,
  EvidenceKind,
  ExportFormat,
  GateDecision,
  RegisterNodeInput,
  RiskTier,
  TrustNode,
  TrustPath,
  TrustPolicy,
  TrustQueryResult,
  VerificationLevel,
} from "../types.js";
import { TrustStore } from "../store/db.js";
import { exportGraph } from "./export.js";

function nowIso(): string {
  return new Date().toISOString();
}

function edgeId(fromId: string, toId: string): string {
  return `edge:${fromId}->${toId}`;
}

export class TrustEngine {
  constructor(
    readonly store: TrustStore,
    readonly policy: TrustPolicy,
  ) {}

  /**
   * Register or update a node. Client-supplied `identity` is intentionally
   * ignored so MCP/API callers cannot spoof verification levels. New nodes
   * are always `unverified`; updates preserve the existing identity.
   * Elevate via {@link setIdentityVerification} or pubkey challenge completion.
   */
  registerNode(input: RegisterNodeInput): TrustNode {
    const existing = this.store.getNode(input.id);
    const node: TrustNode = {
      id: input.id,
      kind: input.kind,
      label: input.label,
      identity: existing?.identity ?? { verification: "unverified" },
      metadata: input.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? nowIso(),
    };
    return this.store.upsertNode(node);
  }

  /**
   * Operator-only identity promotion. Callers (CLI/MCP) must authenticate
   * before invoking this — the engine itself does not check secrets.
   */
  setIdentityVerification(
    nodeId: string,
    identity: { verification: VerificationLevel; issuer?: string },
  ): TrustNode {
    const existing = this.requireNode(nodeId);
    const next: TrustNode = {
      ...existing,
      identity: {
        verification: identity.verification,
        ...(identity.issuer !== undefined ? { issuer: identity.issuer } : {}),
      },
    };
    return this.store.upsertNode(next);
  }

  private requireNode(id: string): TrustNode {
    const n = this.store.getNode(id);
    if (!n) {
      throw new Error(`Unknown node: ${id}`);
    }
    return n;
  }

  private influenceCap(level: VerificationLevel): number {
    return this.policy.identity.influenceCaps[level];
  }

  private effectiveStrength(
    actor: TrustNode,
    subjectId: string,
    raw: number,
    _kind: EvidenceKind,
  ): number {
    let s = clampStrength(raw) * this.influenceCap(actor.identity.verification);
    if (actor.id === subjectId) {
      s *= this.policy.identity.selfAttestDiscount;
    }
    return clampStrength(s);
  }

  private ensureEdge(fromId: string, toId: string) {
    this.requireNode(fromId);
    this.requireNode(toId);
    const existing = this.store.getEdge(fromId, toId);
    if (existing) {
      return existing;
    }
    return this.store.upsertEdge({
      id: edgeId(fromId, toId),
      fromId,
      toId,
      alpha: this.policy.priors.alpha,
      beta: this.policy.priors.beta,
      updatedAt: nowIso(),
    });
  }

  private materializeEdge(edgeIdValue: string): void {
    const edge = this.store.getEdgeById(edgeIdValue);
    if (!edge) {
      return;
    }
    const evidence = this.store.listEvidenceForEdge(edgeIdValue);
    const stats = computeBeta(
      this.policy.priors.alpha,
      this.policy.priors.beta,
      evidence,
    );
    this.store.upsertEdge({
      ...edge,
      alpha: stats.alpha,
      beta: stats.beta,
      updatedAt: nowIso(),
    });
  }

  private addEvidence(
    kind: EvidenceKind,
    polarity: 1 | -1,
    input: EvidenceInput,
    strengthOverride?: number,
  ): { evidence: Evidence; trust: number } {
    const fromId = input.fromId ?? input.actorId;
    const actor = this.requireNode(input.actorId);
    const edge = this.ensureEdge(fromId, input.toId);
    let strength =
      strengthOverride !== undefined
        ? clampStrength(strengthOverride)
        : this.effectiveStrength(
            actor,
            input.toId,
            input.strength ?? 0.6,
            kind,
          );

    // Discount self-loop edges once more for bootstrapping edges
    if (strengthOverride === undefined && fromId === input.toId) {
      strength = clampStrength(
        strength * this.policy.identity.selfAttestDiscount,
      );
    }

    const halfLife =
      input.halfLifeHours ?? this.policy.decay.defaultHalfLifeHours;

    const evidence: Evidence = {
      id: `ev:${randomUUID()}`,
      edgeId: edge.id,
      kind,
      polarity,
      strength: clampStrength(strength),
      halfLifeHours: halfLife,
      actorId: input.actorId,
      note: input.note ?? "",
      createdAt: nowIso(),
    };
    this.store.insertEvidence(evidence);
    this.materializeEdge(edge.id);
    const q = this.queryTrust(fromId, input.toId);
    return { evidence, trust: q.trust };
  }

  attest(input: EvidenceInput) {
    return this.addEvidence("attestation", 1, input);
  }

  challenge(input: EvidenceInput) {
    return this.addEvidence("challenge", -1, input);
  }

  observe(input: EvidenceInput) {
    const polarity: 1 | -1 = input.positive === false ? -1 : 1;
    return this.addEvidence("observation", polarity, input);
  }

  endorse(input: EvidenceInput) {
    const endorser = this.requireNode(input.actorId);
    this.requireNode(input.toId);
    const fromId = input.fromId || input.actorId;
    const pathTrust = this.queryTrust(input.actorId, input.toId).trust;
    const scaled =
      (input.strength ?? 0.7) *
      Math.max(0.05, pathTrust) *
      this.influenceCap(endorser.identity.verification);

    return this.addEvidence(
      "endorsement",
      1,
      { ...input, fromId, strength: scaled },
      scaled,
    );
  }

  private edgeTrust(fromId: string, toId: string, now = new Date()) {
    const edge = this.store.getEdge(fromId, toId);
    if (!edge) {
      return undefined;
    }
    const evidence = this.store.listEvidenceForEdge(edge.id);
    return computeBeta(
      this.policy.priors.alpha,
      this.policy.priors.beta,
      evidence,
      now,
    );
  }

  private endorsementCount(targetId: string, now = new Date()): number {
    const list = this.store.listEndorsementsForTarget(targetId);
    const actors = new Set<string>();
    for (const ev of list) {
      const w = decayWeight(ageHours(ev.createdAt, now), ev.halfLifeHours);
      if (ev.strength * w < 0.05) {
        continue;
      }
      const actor = this.store.getNode(ev.actorId);
      if (!actor) {
        continue;
      }
      // unverified endorsements don't count toward quorum
      if (actor.identity.verification === "unverified") {
        continue;
      }
      actors.add(ev.actorId);
    }
    return actors.size;
  }

  queryTrust(fromId: string, toId: string): TrustQueryResult {
    this.requireNode(fromId);
    this.requireNode(toId);

    const direct = this.edgeTrust(fromId, toId);
    const endorsementCount = this.endorsementCount(toId);

    if (direct) {
      const path: TrustPath = {
        nodes: [fromId, toId],
        hops: [{ fromId, toId, trust: direct.trust }],
        score: direct.trust,
      };
      return {
        fromId,
        toId,
        trust: direct.trust,
        direct: true,
        alpha: direct.alpha,
        beta: direct.beta,
        paths: [path],
        endorsementCount,
      };
    }

    const weighted = this.store.listEdges().map((e) => {
      const stats =
        this.edgeTrust(e.fromId, e.toId) ??
        computeBeta(this.policy.priors.alpha, this.policy.priors.beta, []);
      return { fromId: e.fromId, toId: e.toId, trust: stats.trust };
    });

    const { trust, paths } = findTrustPaths(weighted, fromId, toId, {
      maxDepth: this.policy.path.maxDepth,
      minEdgeTrust: this.policy.path.minEdgeTrust,
      aggregation: this.policy.path.aggregation,
    });

    return {
      fromId,
      toId,
      trust,
      direct: false,
      alpha: this.policy.priors.alpha,
      beta: this.policy.priors.beta,
      paths,
      endorsementCount,
    };
  }

  explainPath(fromId: string, toId: string, limit = 5): TrustQueryResult {
    const result = this.queryTrust(fromId, toId);
    return { ...result, paths: result.paths.slice(0, limit) };
  }

  gateAction(input: {
    actorId: string;
    targetId: string;
    riskTier: RiskTier;
    action: string;
  }): GateDecision {
    const actor = this.requireNode(input.actorId);
    this.requireNode(input.targetId);
    const tier = this.policy.tiers[input.riskTier];
    const query = this.queryTrust(input.actorId, input.targetId);
    const reasons: string[] = [];
    const evidenceSummary: string[] = [];

    const edge = this.store.getEdge(input.actorId, input.targetId);
    if (edge) {
      for (const ev of this.store.listEvidenceForEdge(edge.id).slice(-8)) {
        evidenceSummary.push(
          `${ev.kind}(${ev.polarity > 0 ? "+" : "-"}${ev.strength.toFixed(2)}) by ${ev.actorId}: ${ev.note || "(no note)"}`,
        );
      }
    }

    if (tier.requireVerifiedActor && actor.identity.verification === "unverified") {
      reasons.push(
        `Actor ${input.actorId} is unverified; tier ${input.riskTier} requires a verified identity`,
      );
    }

    if (query.trust < tier.minTrust) {
      reasons.push(
        `Trust ${query.trust.toFixed(3)} < ${input.riskTier} threshold ${tier.minTrust}`,
      );
    }

    if (query.endorsementCount < tier.minEndorsements) {
      reasons.push(
        `Endorsements ${query.endorsementCount} < required ${tier.minEndorsements}`,
      );
    }

    const allowed = reasons.length === 0;
    if (allowed) {
      reasons.push(
        `Allowed: trust ${query.trust.toFixed(3)} ≥ ${tier.minTrust}, endorsements ${query.endorsementCount} ≥ ${tier.minEndorsements}`,
      );
    }

    return {
      allowed,
      actorId: input.actorId,
      targetId: input.targetId,
      action: input.action,
      riskTier: input.riskTier,
      trust: query.trust,
      minTrust: tier.minTrust,
      endorsementCount: query.endorsementCount,
      minEndorsements: tier.minEndorsements,
      path: query.paths[0],
      reasons,
      evidenceSummary,
    };
  }

  export(format: ExportFormat): string {
    return exportGraph(this, format);
  }
}
