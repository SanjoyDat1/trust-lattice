#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { assertAdminToken } from "./auth/admin.js";
import { TrustEngine } from "./core/engine.js";
import { serveMcp } from "./mcp/server.js";
import { loadDefaultPolicy, loadPolicyFile } from "./policy.js";
import { seedDemoGraph } from "./seed/demo.js";
import { TrustStore } from "./store/db.js";
import type { ExportFormat, RiskTier } from "./types.js";

function usage(): never {
  console.error(`trust-lattice — evidence-weighted trust graph for multi-agent systems

Usage:
  trust-lattice serve [--db <path>] [--policy <path>]
  trust-lattice seed [--db <path>] [--policy <path>] [--force]
  trust-lattice query <fromId> <toId> [--db <path>]
  trust-lattice gate <actorId> <targetId> <riskTier> <action...> [--db <path>]
  trust-lattice export [json|mermaid|dot] [--db <path>]
  trust-lattice promote <nodeId> <unverified|email|pubkey|org> [--issuer <id>] [--admin-token <secret>] [--db <path>]

Env:
  TRUST_LATTICE_DB            SQLite path (default: ./data/trust-lattice.db)
  TRUST_LATTICE_POLICY        Policy JSON path
  TRUST_LATTICE_ADMIN_TOKEN   Required for MCP writes and CLI promote (min 16 chars)
`);
  process.exit(1);
}

function defaultDbPath(): string {
  return process.env.TRUST_LATTICE_DB || resolve(process.cwd(), "data/trust-lattice.db");
}

function parseArgs(argv: string[]) {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      positionals.push(a);
    }
  }
  return { flags, positionals };
}

function openEngine(flags: Map<string, string | boolean>): TrustEngine {
  const dbPath = String(flags.get("db") || defaultDbPath());
  mkdirSync(dirname(dbPath), { recursive: true });
  const policyPath =
    (flags.get("policy") as string | undefined) ||
    process.env.TRUST_LATTICE_POLICY;
  const policy = policyPath ? loadPolicyFile(policyPath) : loadDefaultPolicy();
  const store = new TrustStore(dbPath);
  return new TrustEngine(store, policy);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    usage();
  }
  const { flags, positionals } = parseArgs(argv);
  const cmd = positionals[0];
  if (!cmd) usage();

  if (cmd === "serve") {
    const engine = openEngine(flags);
    await serveMcp(engine);
    return;
  }

  if (cmd === "seed") {
    const engine = openEngine(flags);
    seedDemoGraph(engine, { force: Boolean(flags.get("force")) });
    console.error(
      `Seeded demo graph → ${String(flags.get("db") || defaultDbPath())} (${engine.store.listNodes().length} nodes)`,
    );
    engine.store.close();
    return;
  }

  if (cmd === "query") {
    const fromId = positionals[1];
    const toId = positionals[2];
    if (!fromId || !toId) usage();
    const engine = openEngine(flags);
    const result = engine.queryTrust(fromId, toId);
    console.log(JSON.stringify(result, null, 2));
    engine.store.close();
    return;
  }

  if (cmd === "gate") {
    const actorId = positionals[1];
    const targetId = positionals[2];
    const riskTier = positionals[3] as RiskTier | undefined;
    const action = positionals.slice(4).join(" ") || "action";
    if (!actorId || !targetId || !riskTier) usage();
    if (!["read", "write", "irreversible"].includes(riskTier)) {
      console.error("riskTier must be read|write|irreversible");
      process.exit(1);
    }
    const engine = openEngine(flags);
    const decision = engine.gateAction({
      actorId,
      targetId,
      riskTier,
      action,
    });
    console.log(JSON.stringify(decision, null, 2));
    engine.store.close();
    process.exit(decision.allowed ? 0 : 2);
  }

  if (cmd === "export") {
    const format = (positionals[1] || "json") as ExportFormat;
    if (!["json", "mermaid", "dot"].includes(format)) usage();
    const engine = openEngine(flags);
    console.log(engine.export(format));
    engine.store.close();
    return;
  }

  if (cmd === "promote") {
    const nodeId = positionals[1];
    const verification = positionals[2];
    if (
      !nodeId ||
      !verification ||
      !["unverified", "email", "pubkey", "org"].includes(verification)
    ) {
      usage();
    }
    const provided =
      (typeof flags.get("admin-token") === "string"
        ? String(flags.get("admin-token"))
        : undefined) ?? process.env.TRUST_LATTICE_ADMIN_TOKEN;
    try {
      assertAdminToken(provided);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    const issuer = flags.get("issuer");
    const engine = openEngine(flags);
    const node = engine.setIdentityVerification(nodeId, {
      verification: verification as "unverified" | "email" | "pubkey" | "org",
      ...(typeof issuer === "string" ? { issuer } : {}),
    });
    console.log(JSON.stringify({ ok: true, node }, null, 2));
    engine.store.close();
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
