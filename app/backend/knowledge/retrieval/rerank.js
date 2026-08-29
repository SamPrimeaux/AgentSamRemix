export async function maybeRerank({ query, candidates, service, enabled }) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!enabled || typeof service !== 'function' || list.length <= 1) {
    return { ok: true, applied: false, candidates: list };
  }
  try {
    const response = await service({
      query: String(query || ''),
      candidates: list.map((row) => ({
        id: row.canonicalId || row.sourceId || row.id,
        text: row.text || '',
        sourceType: row.sourceType || null,
      })),
    });
    const scores = response?.scores && typeof response.scores === 'object' ? response.scores : {};
    const reranked = list.map((row) => {
      const id = String(row.canonicalId || row.sourceId || row.id || '');
      const rerankScore = Number(scores[id]);
      return Number.isFinite(rerankScore)
        ? { ...row, rerankScore, score: rerankScore, retrievalScore: rerankScore }
        : row;
    }).sort((a, b) => (Number(b?.score) || 0) - (Number(a?.score) || 0));
    return { ok: true, applied: true, candidates: reranked };
  } catch (error) {
    return {
      ok: false,
      applied: false,
      error: `rerank_failed:${String(error?.message || error).slice(0, 180)}`,
      candidates: list,
    };
  }
}
