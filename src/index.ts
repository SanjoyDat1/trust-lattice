#!/usr/bin/env node
/** MCP stdio entrypoint — equivalent to `trust-lattice serve`. */
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { TrustEngine } from "./core/engine.js";
import { serveMcp } from "./mcp/server.js";
import { loadDefaultPolicy, loadPolicyFile } from "./policy.js";
import { TrustStore } from "./store/db.js";

async function main(): Promise<void> {
  const dbPath =
    process.env.TRUST_LATTICE_DB ||
    resolve(process.cwd(), "data/trust-lattice.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  const policy = process.env.TRUST_LATTICE_POLICY
    ? loadPolicyFile(process.env.TRUST_LATTICE_POLICY)
    : loadDefaultPolicy();
  const engine = new TrustEngine(new TrustStore(dbPath), policy);
  await serveMcp(engine);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
