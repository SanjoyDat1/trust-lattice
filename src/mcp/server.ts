import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { TrustEngine } from "../core/engine.js";
import type { RiskTier } from "../types.js";

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
  const safe =
    message.startsWith("Unknown node:") ||
    message.includes("must be") ||
    message.includes("riskTier")
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

const identitySchema = z
  .object({
    verification: z.enum(["unverified", "email", "pubkey", "org"]),
    issuer: z.string().max(256).optional(),
  })
  .optional();

export function createMcpServer(engine: TrustEngine): McpServer {
  const server = new McpServer({
    name: "trust-lattice",
    version: "0.1.0",
  });

  server.registerTool(
    "tl_register_node",
    {
      description:
        "Register or update a trust graph node (agent, tool, or claim_source).",
      inputSchema: {
        id: idSchema.describe("Stable node id"),
        kind: z.enum(["agent", "tool", "claim_source"]),
        label: labelSchema,
        identity: identitySchema,
        metadata: metadataSchema,
      },
    },
    async (args) => {
      try {
        const node = engine.registerNode({
          id: args.id,
          kind: args.kind,
          label: args.label,
          identity: args.identity,
          metadata: args.metadata,
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
        "Add positive attestation evidence on the directed edge fromId → toId.",
      inputSchema: {
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
        "Add negative challenge evidence on the directed edge fromId → toId.",
      inputSchema: {
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
        "Endorse a target node; strength is scaled by endorser path-trust and identity cap.",
      inputSchema: {
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
        "Evaluate whether an actor may perform a risk-tiered action on a target. Returns allow/deny with explanation.",
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
  const server = createMcpServer(engine);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("trust-lattice MCP server running on stdio");
}
