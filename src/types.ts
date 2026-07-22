/** Core domain types for trust-lattice. */

export type NodeKind = "agent" | "tool" | "claim_source";

export type VerificationLevel = "unverified" | "email" | "pubkey" | "org";

export type EvidenceKind =
  | "attestation"
  | "challenge"
  | "endorsement"
  | "observation";

export type RiskTier = "read" | "write" | "irreversible";

export type PathAggregation = "noisy_or_product" | "max_product";

export type ExportFormat = "json" | "mermaid" | "dot";

export interface IdentityStub {
  verification: VerificationLevel;
  issuer?: string;
}

export interface TrustNode {
  id: string;
  kind: NodeKind;
  label: string;
  identity: IdentityStub;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TrustEdge {
  id: string;
  fromId: string;
  toId: string;
  /** Sufficient stats when evidence is materialized; query uses decay recompute. */
  alpha: number;
  beta: number;
  updatedAt: string;
}

export interface Evidence {
  id: string;
  edgeId: string;
  kind: EvidenceKind;
  /** +1 positive contribution, -1 negative */
  polarity: 1 | -1;
  strength: number;
  halfLifeHours: number;
  actorId: string;
  note: string;
  createdAt: string;
}

export interface TierPolicy {
  minTrust: number;
  minEndorsements: number;
  requireVerifiedActor?: boolean;
}

export interface TrustPolicy {
  version: number;
  priors: { alpha: number; beta: number };
  decay: { defaultHalfLifeHours: number };
  identity: {
    influenceCaps: Record<VerificationLevel, number>;
    selfAttestDiscount: number;
  };
  path: {
    maxDepth: number;
    minEdgeTrust: number;
    aggregation: PathAggregation;
  };
  tiers: Record<RiskTier, TierPolicy>;
}

export interface PathHop {
  fromId: string;
  toId: string;
  trust: number;
}

export interface TrustPath {
  nodes: string[];
  hops: PathHop[];
  score: number;
}

export interface TrustQueryResult {
  fromId: string;
  toId: string;
  trust: number;
  direct: boolean;
  alpha: number;
  beta: number;
  paths: TrustPath[];
  endorsementCount: number;
}

export interface GateDecision {
  allowed: boolean;
  actorId: string;
  targetId: string;
  action: string;
  riskTier: RiskTier;
  trust: number;
  minTrust: number;
  endorsementCount: number;
  minEndorsements: number;
  path?: TrustPath;
  reasons: string[];
  evidenceSummary: string[];
}

export interface RegisterNodeInput {
  id: string;
  kind: NodeKind;
  label: string;
  identity?: IdentityStub;
  metadata?: Record<string, unknown>;
}

export interface EvidenceInput {
  fromId?: string;
  toId: string;
  actorId: string;
  strength?: number;
  halfLifeHours?: number;
  note?: string;
  /** For observations: positive or negative. */
  positive?: boolean;
}
