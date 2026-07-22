import { timingSafeEqual } from "node:crypto";

/** Minimum length for TRUST_LATTICE_ADMIN_TOKEN (fail-closed below this). */
export const ADMIN_TOKEN_MIN_LENGTH = 16;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Read configured operator token from the environment (may be unset). */
export function getConfiguredAdminToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.TRUST_LATTICE_ADMIN_TOKEN;
  if (raw === undefined || raw === "") {
    return undefined;
  }
  return raw;
}

export function isAdminTokenConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const token = getConfiguredAdminToken(env);
  return token !== undefined && token.length >= ADMIN_TOKEN_MIN_LENGTH;
}

/**
 * Timing-safe check that `provided` matches TRUST_LATTICE_ADMIN_TOKEN.
 * Fails closed when the env token is missing or shorter than ADMIN_TOKEN_MIN_LENGTH.
 */
export function assertAdminToken(
  provided: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const expected = getConfiguredAdminToken(env);
  if (expected === undefined || expected.length < ADMIN_TOKEN_MIN_LENGTH) {
    throw new AuthError(
      "MCP writes disabled: set TRUST_LATTICE_ADMIN_TOKEN (min 16 chars)",
    );
  }
  if (provided === undefined || provided.length === 0) {
    throw new AuthError("adminToken required for mutating trust-lattice tools");
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AuthError("Invalid adminToken");
  }
}
