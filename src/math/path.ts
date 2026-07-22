import type { PathAggregation, TrustPath } from "../types.js";

export interface WeightedEdge {
  fromId: string;
  toId: string;
  trust: number;
}

/**
 * DFS path search with product scores; aggregate via noisy-OR or max.
 */
export function findTrustPaths(
  edges: WeightedEdge[],
  fromId: string,
  toId: string,
  options: {
    maxDepth: number;
    minEdgeTrust: number;
    aggregation: PathAggregation;
    limit?: number;
  },
): { trust: number; paths: TrustPath[] } {
  if (fromId === toId) {
    return {
      trust: 1,
      paths: [{ nodes: [fromId], hops: [], score: 1 }],
    };
  }

  const adj = new Map<string, WeightedEdge[]>();
  for (const e of edges) {
    if (e.trust < options.minEdgeTrust) {
      continue;
    }
    const list = adj.get(e.fromId) ?? [];
    list.push(e);
    adj.set(e.fromId, list);
  }

  const found: TrustPath[] = [];
  const limit = options.limit ?? 16;

  const visit = (
    node: string,
    pathNodes: string[],
    hops: TrustPath["hops"],
    score: number,
    depth: number,
  ): void => {
    if (found.length >= limit) {
      return;
    }
    if (node === toId) {
      found.push({ nodes: [...pathNodes], hops: [...hops], score });
      return;
    }
    if (depth >= options.maxDepth) {
      return;
    }
    const outs = adj.get(node) ?? [];
    for (const edge of outs) {
      if (pathNodes.includes(edge.toId)) {
        continue;
      }
      const nextScore = score * edge.trust;
      hops.push({ fromId: edge.fromId, toId: edge.toId, trust: edge.trust });
      pathNodes.push(edge.toId);
      visit(edge.toId, pathNodes, hops, nextScore, depth + 1);
      pathNodes.pop();
      hops.pop();
    }
  };

  visit(fromId, [fromId], [], 1, 0);

  found.sort((a, b) => b.score - a.score);

  let trust = 0;
  if (found.length === 0) {
    trust = 0;
  } else if (options.aggregation === "max_product") {
    trust = found[0]?.score ?? 0;
  } else {
    // noisy-OR of path products
    let fail = 1;
    for (const p of found) {
      fail *= 1 - p.score;
    }
    trust = 1 - fail;
  }

  return { trust, paths: found };
}
