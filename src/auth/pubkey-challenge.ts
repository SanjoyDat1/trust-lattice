import {
  createPublicKey,
  createHash,
  randomBytes,
  verify,
} from "node:crypto";

export class PubkeyChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PubkeyChallengeError";
  }
}

interface PendingChallenge {
  nonce: string;
  expiresAtMs: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const pending = new Map<string, PendingChallenge>();

function challengeMessage(nodeId: string, nonce: string): string {
  return `trust-lattice:pubkey:${nodeId}:${nonce}`;
}

/** Start an Ed25519 signature challenge for promoting a node to `pubkey`. */
export function beginPubkeyChallenge(
  nodeId: string,
  ttlMs = DEFAULT_TTL_MS,
  nowMs = Date.now(),
): { challenge: string; expiresAt: string } {
  const nonce = randomBytes(32).toString("base64url");
  const expiresAtMs = nowMs + ttlMs;
  pending.set(nodeId, { nonce, expiresAtMs });
  return {
    challenge: challengeMessage(nodeId, nonce),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

/**
 * Verify an Ed25519 signature over the outstanding challenge.
 * `publicKeySpkiBase64` is a base64-encoded SPKI DER public key.
 * `signatureBase64` is a base64-encoded raw signature.
 * Returns a stable issuer fingerprint on success.
 */
export function completePubkeyChallenge(
  nodeId: string,
  publicKeySpkiBase64: string,
  signatureBase64: string,
  nowMs = Date.now(),
): { issuer: string } {
  const entry = pending.get(nodeId);
  if (!entry) {
    throw new PubkeyChallengeError("No pending pubkey challenge for node");
  }
  if (nowMs > entry.expiresAtMs) {
    pending.delete(nodeId);
    throw new PubkeyChallengeError("Pubkey challenge expired");
  }

  let key;
  try {
    key = createPublicKey({
      key: Buffer.from(publicKeySpkiBase64, "base64"),
      format: "der",
      type: "spki",
    });
  } catch {
    throw new PubkeyChallengeError("Invalid public key (expected SPKI base64)");
  }

  if (key.asymmetricKeyType !== "ed25519") {
    throw new PubkeyChallengeError("Only Ed25519 public keys are accepted");
  }

  const message = Buffer.from(challengeMessage(nodeId, entry.nonce), "utf8");
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureBase64, "base64");
  } catch {
    throw new PubkeyChallengeError("Invalid signature encoding");
  }

  const ok = verify(null, message, key, signature);
  if (!ok) {
    throw new PubkeyChallengeError("Invalid pubkey challenge signature");
  }

  pending.delete(nodeId);
  const fingerprint = createHash("sha256")
    .update(Buffer.from(publicKeySpkiBase64, "base64"))
    .digest("hex")
    .slice(0, 32);
  return { issuer: `ed25519:${fingerprint}` };
}

/** Test helper — clear in-memory challenges. */
export function clearPubkeyChallenges(): void {
  pending.clear();
}
