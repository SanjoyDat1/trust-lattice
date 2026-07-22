import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { TrustEngine } from "../src/core/engine.js";
import { loadDefaultPolicy } from "../src/policy.js";
import { TrustStore } from "../src/store/db.js";
import { seedDemoGraph } from "../src/seed/demo.js";
import type { RiskTier } from "../src/types.js";

const MAX_BODY_BYTES = 64 * 1024;
const RISK_TIERS = new Set<string>(["read", "write", "irreversible"]);

async function readBodyLimited(
  req: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk as Buffer);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error("Request body too large");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function trustApiPlugin(): Plugin {
  let engine: TrustEngine | undefined;

  const getEngine = () => {
    if (!engine) {
      const dbPath =
        process.env.TRUST_LATTICE_DB ||
        resolve(process.cwd(), "data/trust-lattice.db");
      engine = new TrustEngine(new TrustStore(dbPath), loadDefaultPolicy());
      if (engine.store.listNodes().length === 0) {
        seedDemoGraph(engine, { force: true });
      }
    }
    return engine;
  };

  return {
    name: "trust-lattice-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (!req.url) {
            next();
            return;
          }
          const url = new URL(req.url, "http://localhost");
          if (url.pathname === "/api/graph") {
            const e = getEngine();
            res.setHeader("Content-Type", "application/json");
            res.end(e.export("json"));
            return;
          }
          if (url.pathname === "/api/mermaid") {
            const e = getEngine();
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end(e.export("mermaid"));
            return;
          }
          if (url.pathname === "/api/gate" && req.method === "POST") {
            const raw = await readBodyLimited(req, MAX_BODY_BYTES);
            const body = JSON.parse(raw || "{}") as {
              actorId?: string;
              targetId?: string;
              riskTier?: string;
              action?: string;
            };
            if (body.riskTier && !RISK_TIERS.has(body.riskTier)) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  error: "riskTier must be read|write|irreversible",
                }),
              );
              return;
            }
            const e = getEngine();
            const decision = e.gateAction({
              actorId: body.actorId || "",
              targetId: body.targetId || "",
              riskTier: (body.riskTier as RiskTier) || "read",
              action: (body.action || "action").slice(0, 256),
            });
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(decision));
            return;
          }
          next();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.statusCode = message.includes("too large") ? 413 : 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: message }));
        }
      });
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname, "."),
  plugins: [trustApiPlugin()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    strictPort: true,
  },
});
