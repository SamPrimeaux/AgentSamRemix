function candidateKey(hit) {
  return String(hit?.canonicalId || hit?.sourceId || hit?.chunkId || hit?.nodeId || hit?.id || '').trim();
}

/** Reciprocal Rank Fusion does not require score calibration across backends. */
export function reciprocalRankFusion(rankedLists, { k = 60 } = {}) {
  const accumulator = new Map();
  for (const list of Array.isArray(rankedLists) ? rankedLists : []) {
    const hits = Array.isArray(list?.hits) ? list.hits : [];
    const weight = Number.isFinite(Number(list?.weight)) ? Number(list.weight) : 1;
    const name = String(list?.name || list?.backend || 'retriever');
    hits.forEach((hit, index) => {
      const key = candidateKey(hit);
      if (!key) return;
      const rank = index + 1;
      const contribution = weight / (Math.max(1, Number(k) || 60) + rank);
      const previous = accumulator.get(key);
      const current = previous || {
        ...hit,
        canonicalId: key,
        rrfScore: 0,
        ranks: {},
        provenance: [],
        sourceScore: Number(hit?.score) || 0,
      };
      current.rrfScore += contribution;
      current.ranks[name] = rank;
      current.provenance = [...new Set([
        ...(Array.isArray(current.provenance) ? current.provenance : []),
        ...(Array.isArray(hit?.provenance) ? hit.provenance : []),
        name,
      ])];
      const hitScore = Number(hit?.score) || 0;
      if (previous && hitScore > (Number(current.sourceScore) || 0)) {
        const preserved = {
          rrfScore: current.rrfScore,
          ranks: current.ranks,
          provenance: current.provenance,
          canonicalId: key,
        };
        Object.assign(current, hit, preserved, { sourceScore: hitScore });
      }
      accumulator.set(key, current);
    });
  }

  const fused = [...accumulator.values()].sort((a, b) => b.rrfScore - a.rrfScore);
  const max = fused.length ? fused[0].rrfScore : 0;
  return fused.map((row) => ({
    ...row,
    score: max > 0 ? row.rrfScore / max : 0,
    retrievalScore: max > 0 ? row.rrfScore / max : 0,
  }));
}
