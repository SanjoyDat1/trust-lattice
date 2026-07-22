import { ageHours, decayWeight } from "./decay.js";

export interface EvidenceContribution {
  polarity: 1 | -1;
  strength: number;
  halfLifeHours: number;
  createdAt: string;
}

export interface BetaStats {
  alpha: number;
  beta: number;
  trust: number;
}

/** Recompute Beta posterior from prior + time-decayed evidence. */
export function computeBeta(
  priorAlpha: number,
  priorBeta: number,
  evidence: EvidenceContribution[],
  now: Date = new Date(),
): BetaStats {
  let alpha = priorAlpha;
  let beta = priorBeta;

  for (const ev of evidence) {
    const w = decayWeight(ageHours(ev.createdAt, now), ev.halfLifeHours);
    const contrib = ev.strength * w;
    if (ev.polarity > 0) {
      alpha += contrib;
    } else {
      beta += contrib;
    }
  }

  const denom = alpha + beta;
  return {
    alpha,
    beta,
    trust: denom > 0 ? alpha / denom : 0.5,
  };
}

export function clampStrength(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.1;
  }
  return Math.min(1, Math.max(0.01, value));
}
