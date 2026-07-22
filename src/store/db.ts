import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Evidence,
  EvidenceKind,
  IdentityStub,
  NodeKind,
  TrustEdge,
  TrustNode,
  VerificationLevel,
} from "../types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  verification TEXT NOT NULL,
  issuer TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  alpha REAL NOT NULL,
  beta REAL NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(from_id, to_id),
  FOREIGN KEY(from_id) REFERENCES nodes(id),
  FOREIGN KEY(to_id) REFERENCES nodes(id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  polarity INTEGER NOT NULL,
  strength REAL NOT NULL,
  half_life_hours REAL NOT NULL,
  actor_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(edge_id) REFERENCES edges(id),
  FOREIGN KEY(actor_id) REFERENCES nodes(id)
);

CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
CREATE INDEX IF NOT EXISTS idx_evidence_edge ON evidence(edge_id);
CREATE INDEX IF NOT EXISTS idx_evidence_kind ON evidence(kind);
`;

function rowNode(row: Record<string, unknown>): TrustNode {
  const identity: IdentityStub = {
    verification: row.verification as VerificationLevel,
  };
  if (row.issuer) {
    identity.issuer = String(row.issuer);
  }
  return {
    id: String(row.id),
    kind: row.kind as NodeKind,
    label: String(row.label),
    identity,
    metadata: JSON.parse(String(row.metadata || "{}")) as Record<
      string,
      unknown
    >,
    createdAt: String(row.created_at),
  };
}

function rowEdge(row: Record<string, unknown>): TrustEdge {
  return {
    id: String(row.id),
    fromId: String(row.from_id),
    toId: String(row.to_id),
    alpha: Number(row.alpha),
    beta: Number(row.beta),
    updatedAt: String(row.updated_at),
  };
}

function rowEvidence(row: Record<string, unknown>): Evidence {
  return {
    id: String(row.id),
    edgeId: String(row.edge_id),
    kind: row.kind as EvidenceKind,
    polarity: Number(row.polarity) as 1 | -1,
    strength: Number(row.strength),
    halfLifeHours: Number(row.half_life_hours),
    actorId: String(row.actor_id),
    note: String(row.note),
    createdAt: String(row.created_at),
  };
}

export class TrustStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', '1')`,
      )
      .run();
  }

  close(): void {
    this.db.close();
  }

  clearAll(): void {
    this.db.exec(
      `DELETE FROM evidence; DELETE FROM edges; DELETE FROM nodes;`,
    );
  }

  upsertNode(node: TrustNode): TrustNode {
    this.db
      .prepare(
        `INSERT INTO nodes(id, kind, label, verification, issuer, metadata, created_at)
         VALUES(@id, @kind, @label, @verification, @issuer, @metadata, @createdAt)
         ON CONFLICT(id) DO UPDATE SET
           kind=excluded.kind,
           label=excluded.label,
           verification=excluded.verification,
           issuer=excluded.issuer,
           metadata=excluded.metadata`,
      )
      .run({
        id: node.id,
        kind: node.kind,
        label: node.label,
        verification: node.identity.verification,
        issuer: node.identity.issuer ?? null,
        metadata: JSON.stringify(node.metadata),
        createdAt: node.createdAt,
      });
    const got = this.getNode(node.id);
    if (!got) {
      throw new Error(`Failed to upsert node ${node.id}`);
    }
    return got;
  }

  getNode(id: string): TrustNode | undefined {
    const row = this.db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowNode(row) : undefined;
  }

  listNodes(): TrustNode[] {
    const rows = this.db
      .prepare(`SELECT * FROM nodes ORDER BY id`)
      .all() as Record<string, unknown>[];
    return rows.map(rowNode);
  }

  getEdge(fromId: string, toId: string): TrustEdge | undefined {
    const row = this.db
      .prepare(`SELECT * FROM edges WHERE from_id = ? AND to_id = ?`)
      .get(fromId, toId) as Record<string, unknown> | undefined;
    return row ? rowEdge(row) : undefined;
  }

  getEdgeById(id: string): TrustEdge | undefined {
    const row = this.db.prepare(`SELECT * FROM edges WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowEdge(row) : undefined;
  }

  listEdges(): TrustEdge[] {
    const rows = this.db
      .prepare(`SELECT * FROM edges ORDER BY from_id, to_id`)
      .all() as Record<string, unknown>[];
    return rows.map(rowEdge);
  }

  upsertEdge(edge: TrustEdge): TrustEdge {
    this.db
      .prepare(
        `INSERT INTO edges(id, from_id, to_id, alpha, beta, updated_at)
         VALUES(@id, @fromId, @toId, @alpha, @beta, @updatedAt)
         ON CONFLICT(from_id, to_id) DO UPDATE SET
           alpha=excluded.alpha,
           beta=excluded.beta,
           updated_at=excluded.updated_at`,
      )
      .run(edge);
    const got = this.getEdge(edge.fromId, edge.toId);
    if (!got) {
      throw new Error(`Failed to upsert edge ${edge.fromId}->${edge.toId}`);
    }
    return got;
  }

  insertEvidence(ev: Evidence): Evidence {
    this.db
      .prepare(
        `INSERT INTO evidence(id, edge_id, kind, polarity, strength, half_life_hours, actor_id, note, created_at)
         VALUES(@id, @edgeId, @kind, @polarity, @strength, @halfLifeHours, @actorId, @note, @createdAt)`,
      )
      .run(ev);
    return ev;
  }

  listEvidenceForEdge(edgeId: string): Evidence[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM evidence WHERE edge_id = ? ORDER BY created_at ASC`,
      )
      .all(edgeId) as Record<string, unknown>[];
    return rows.map(rowEvidence);
  }

  listAllEvidence(): Evidence[] {
    const rows = this.db
      .prepare(`SELECT * FROM evidence ORDER BY created_at ASC`)
      .all() as Record<string, unknown>[];
    return rows.map(rowEvidence);
  }

  listEndorsementsForTarget(toId: string): Evidence[] {
    const rows = this.db
      .prepare(
        `SELECT ev.* FROM evidence ev
         JOIN edges e ON e.id = ev.edge_id
         WHERE e.to_id = ? AND ev.kind = 'endorsement'
         ORDER BY ev.created_at ASC`,
      )
      .all(toId) as Record<string, unknown>[];
    return rows.map(rowEvidence);
  }
}

export function resolveDbPath(explicit?: string): string {
  return (
    explicit ||
    process.env.TRUST_LATTICE_DB ||
    new URL("../data/trust-lattice.db", import.meta.url).pathname
  );
}
