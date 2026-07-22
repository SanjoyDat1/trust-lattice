import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  assertAdminToken,
  isAdminTokenConfigured,
} from "../auth/admin.js";
import {
  beginPubkeyChallenge,
  completePubkeyChallenge,
} from "../auth/pubkey-challenge.js";
import type { TrustEngine } from "../core/engine.js";
import type { RiskTier, VerificationLevel } from "../types.js";
import { assertWriteRateLimit } from "./rate-limit.js";

function textResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[trust-lattice]", message);
  const name = err instanceof Error ? err.name : "";
  const safe =
    name === "AuthError" ||
    name === "RateLimitError" ||
    name === "PubkeyChallengeError" ||
    message.startsWith("Unknown node:") ||
    message.includes("must be") ||
    message.includes("riskTier") ||
    message.includes("adminToken") ||
    message.includes("MCP writes disabled") ||
    message.includes("Rate limit") ||
    message.includes("pubkey") ||
    message.includes("Pubkey") ||
    message.includes("Invalid adminToken")
      ? message
      : "Request failed";
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ error: safe }) }],
  };
}

const idSchema = z.string().min(1).max(256);
const labelSchema = z.string().min(1).max(512);
const noteSchema = z.string().max(4096).optional();
const metadataSchema = z
  .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .optional();
const adminTokenSchema = z
  .string()
  .min(1)
  .max(512)
  .describe("Must match TRUST_LATTICE_ADMIN_TOKEN");

/** Authorize a mutating MCP tool; fails closed without a configured env token. */
export function authorizeMcpWrite(
  adminToken: string | undefined,
  rateKey: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  assertAdminToken(adminToken, env);
  assertWriteRateLimit(rateKey);
}

export function createMcpServer(
  engine: TrustEngine,
  options?: { env?: NodeJS.ProcessEnv },
): McpServer {
  const env = options?.env ?? process.env;
  const server = new McpServer({
    name: "trust-lattice",
    version: "0.1.0",
  });

  server.registerTool(
    "tl_register_node",
    {
      description:
        "Register or update a trust graph node (agent, tool, or claim_source). " +
        "Identity verification is always unverified for new nodes and cannot be " +
        "set by the client — use tl_promote_identity (admin) or pubkey challenge. " +
        "Requires adminToken.",
      inputSchema: {
        adminToken: adminTokenSchema,
        id: idSchema.describe("Stable node id"),
        kind: z.enum(["agent", "tool", "claim_source"]),
        label: labelSchema,
        metadata: metadataSchema,
      },
    },
    async (args) => {
      try {
        authorizeMcpWrite(args.adminToken, "tl_register_node", env);
        // Deliberately omit identity — engine ignores client verification.
        const node = engine.registerNode({
          id: args.id,
          kind: args.kind,
          label: args.label,
          metadata: args.metadata,
        });
        return textResult({ ok: true, node });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "tl_promote_identity",
    {
      description:
        "Operator-only: set identity.verification (email|pubkey|org|unverified). " +
        "Requires adminToken. Prefer tl_complete_pubkey_challenge for pubkey.",
      inputSchema: {
        adminToken: adminTokenSchema,
        nodeId: idSchema,
        verification: z.enum(["unverified", "email", "pubkey", "org"]),
        issuer: z.string().max(256).optional(),
      },
    },
    async (args) => {
      try {
        authorizeMcpWrite(args.adminToken, "tl_promote_identity", env);
        const node = engine.setIdentityVerification(args.nodeId, {
          verification: args.verification as VerificationLevel,
          issuer: args.issuer,
        });
        return textResult({ ok: true, node });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "tl_begin_pubkey_challenge",
    {
      description:
        "Begin an Ed25519 signature challenge to prove possession of a key " +
        "before promoting a node to verification=pubkey. Requires adminToken.",
      inputSchema: {
        adminToken: adminTokenSchema,
        nodeId: idSchema,
      },
    },
    async (args) => {
      try {
        authorizeMcpWrite(args.adminToken, "tl_begin_pubkey_challenge", env);
        if (!engine.store.getNode(args.nodeId)) {
          throw new Error(`Unknown node: ${args.nodeId}`);
        }
        const challenge = beginPubkeyChallenge(args.nodeId);
        return textResult({ ok: true, nodeId: args.nodeId, ...challenge });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "tl_complete_pubkey_challenge",
    {
      description:
        "Complete pubkey challenge: provide SPKI public key + signature over " +
        "the challenge string. On success sets verification=pubkey. Requires adminToken.",
      inputSchema: {
        adminToken: adminTokenSchema,
        nodeId: idSchema,
        publicKeySpkiBase64: z.string().min(1).max(4096),
        signatureBase64: z.string().min(1).max(4096),
      },
    },
    async (args) => {
      try {
        authorizeMcpWrite(args.adminToken, "tl_complete_pubkey_challenge", env);
        if (!engine.store.getNode(args.nodeId)) {
          throw new Error(`Unknown node: ${args.nodeId}`);
        }
        const { issuer } = completePubkeyChallenge(
          args.nodeId,
          args.publicKeySpkiBase64,
          args.signatureBase64,
        );
        const node = engine.setIdentityVerification(args.nodeId, {
          verification: "pubkey",
          issuer,
        });
        return textResult({ ok: true, node });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "tl_attest",
    {
      description:
        "Add positive attestation evidence on the directed edge fromId → toId. Requires adminToken.",
      inputSchema: {
        adminToken: adminTokenSchema,
        fromId: idSchema,
        toId: idSchema,
        actorId: idSchema,
        strength: z.number().min(0.01).max(1).optional(),
        halfLifeHours: z.number().positive().max(87600).optional(),
        note: noteSchema,
      },
    },
    async (args) => {
      try {
        authorizeMcpWrite(args.adminToken, `tl_attest:${args.actorId}`, env);
        const result = engine.attest(args);
        return textResult({ ok: true, ...result });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "tl_challenge",
    {
      description:
        "Add negative challenge evidence on the directed edge fromId → toId. Requires adminToken.",
      inputSchema: {
        adminToken: adminTokenSchema,
        fromId: idSchema,
        toId: idSchema,
        actorId: idSchema,
        strength: z.number().min(0.01).max(1).optional(),
        halfLifeHours: z.number().positive().max(87600).optional(),
        note: noteSchema,
      },
    },
    async (args) => {
      try {
        authorizeMcpWrite(args.adminToken, `tl_challenge:${args.actorId}`, env);
        const result = engine.challenge(args);
        return textResult({ ok: true, ...result });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "tl_endorse",
    {
      description:
        "Endorse a target node; strength is scaled by endorser path-trust and identity cap. Requires adminToken.",
      inputSchema: {
        adminToken: adminTokenSchema,
        toId: idSchema.describe("Node being endorsed"),
        actorId: idSchema.describe("Endorser node id"),
        fromId: idSchema
          .optional()
          .describe("Edge source; defaults to actorId"),
        strength: z.number().min(0.01).max(1).optional(),
        halfLifeHours: z.number().positive().max(87600).optional(),
        note: noteSchema,
      },
    },
    async (args) => {
      try {
        authorizeMcpWrite(args.adminToken, `tl_endorse:${args.actorId}`, env);
        const result = engine.endorse({
          fromId: args.fromId ?? args.actorId,
          toId: args.toId,
          actorId: args.actorId,
          strength: args.strength,
          halfLifeHours: args.halfLifeHours,
          note: args.note,
        });
        return textResult({ ok: true, ...result });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "tl_query_trust",
    {
      description:
        "Query evidence-decayed trust from one node to another (direct edge or path aggregate).",
      inputSchema: {
        fromId: idSchema,
        toId: idSchema,
      },
    },
    async (args) => {
      try {
        return textResult(engine.queryTrust(args.fromId, args.toId));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "tl_gate_action",
    {
      description:
        "Evaluate whether an actor may perform a risk-tiered action on a target. Returns allow/deny with explanation. Advisory only — orchestrators must enforce.",
      inputSchema: {
        actorId: idSchema,
        targetId: idSchema,
        riskTier: z.enum(["read", "write", "irreversible"]),
        action: z.string().min(1).max(256).describe("Human-readable action label"),
      },
    },
    async (args) => {
      try {
        const decision = engine.gateAction({
          actorId: args.actorId,
          targetId: args.targetId,
          riskTier: args.riskTier as RiskTier,
          action: args.action,
        });
        return textResult(decision);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "tl_explain_path",
    {
      description: "Explain supporting trust paths between two nodes.",
      inputSchema: {
        fromId: idSchema,
        toId: idSchema,
        limit: z.number().int().positive().max(20).optional(),
      },
    },
    async (args) => {
      try {
        return textResult(
          engine.explainPath(args.fromId, args.toId, args.limit ?? 5),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "tl_export_graph",
    {
      description: "Export the trust graph as JSON, Mermaid, or Graphviz DOT.",
      inputSchema: {
        format: z.enum(["json", "mermaid", "dot"]).default("json"),
      },
    },
    async (args) => {
      try {
        return textResult({
          format: args.format,
          graph: engine.export(args.format),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}

export async function serveMcp(engine: TrustEngine): Promise<void> {
  if (!isAdminTokenConfigured()) {
    console.error(
      "trust-lattice: TRUST_LATTICE_ADMIN_TOKEN unset or <16 chars — MCP mutating tools fail closed",
    );
  }
  const server = createMcpServer(engine);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("trust-lattice MCP server running on stdio");
}
