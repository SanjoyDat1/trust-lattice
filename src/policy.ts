import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { TrustPolicy } from "./types.js";

const tierSchema = z.object({
  minTrust: z.number().min(0).max(1),
  minEndorsements: z.number().int().min(0),
  requireVerifiedActor: z.boolean().optional(),
});

export const trustPolicySchema = z.object({
  version: z.number().int().positive(),
  priors: z.object({
    alpha: z.number().positive(),
    beta: z.number().positive(),
  }),
  decay: z.object({
    defaultHalfLifeHours: z.number().positive(),
  }),
  identity: z.object({
    influenceCaps: z.object({
      unverified: z.number().min(0).max(1),
      email: z.number().min(0).max(1),
      pubkey: z.number().min(0).max(1),
      org: z.number().min(0).max(1),
    }),
    selfAttestDiscount: z.number().min(0).max(1),
  }),
  path: z.object({
    maxDepth: z.number().int().positive(),
    minEdgeTrust: z.number().min(0).max(1),
    aggregation: z.enum(["noisy_or_product", "max_product"]),
  }),
  tiers: z.object({
    read: tierSchema,
    write: tierSchema,
    irreversible: tierSchema,
  }),
});

export function parsePolicy(raw: unknown): TrustPolicy {
  const parsed = trustPolicySchema.parse(raw);
  return {
    ...parsed,
    identity: {
      ...parsed.identity,
      influenceCaps: parsed.identity.influenceCaps,
    },
  };
}

export function loadPolicyFile(path: string): TrustPolicy {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parsePolicy(raw);
}

export function defaultPolicyPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/ -> ../policies ; src/ via tsx -> ../policies
  return join(here, "..", "policies", "default.json");
}

export function loadDefaultPolicy(): TrustPolicy {
  return loadPolicyFile(defaultPolicyPath());
}
