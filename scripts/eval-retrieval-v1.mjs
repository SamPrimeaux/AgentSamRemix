import fs from 'node:fs/promises';

const fixtureUrl = new URL('../test/fixtures/retrieval-eval-v1.json', import.meta.url);
const fixture = JSON.parse(await fs.readFile(fixtureUrl, 'utf8'));

const baseUrl = String(process.env.AGENTSAM_RETRIEVAL_BASE_URL || '').replace(/\/$/, '');
const cookie = String(process.env.AGENTSAM_SESSION_COOKIE || '').trim();
if (!baseUrl) throw new Error('AGENTSAM_RETRIEVAL_BASE_URL_required');
if (!cookie) throw new Error('AGENTSAM_SESSION_COOKIE_required');

const normalizePath = (value) => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
const matchesExpected = (actual, expected) => {
  const a = normalizePath(actual);
  const e = normalizePath(expected);
  return Boolean(a && e && (a === e || a.endsWith(`/${e}`)));
};

function scoreCase(result, expectedPaths, topK) {
  const paths = (result?.citations || []).map((row) => normalizePath(row?.filePath)).filter(Boolean);
  const seenExpected = new Set();
  const relevantAtRank = paths.map((path) => {
    const match = expectedPaths.find((expected) => !seenExpected.has(expected) && matchesExpected(path, expected));
    if (!match) return false;
    seenExpected.add(match);
    return true;
  });
  const first = relevantAtRank.findIndex(Boolean);
  const relevantHits = relevantAtRank.slice(0, topK).filter(Boolean).length;
  const recall = expectedPaths.length ? relevantHits / expectedPaths.length : null;
  const precision = Math.min(topK, paths.length)
    ? relevantHits / Math.min(topK, paths.length)
    : 0;
  const mrr = first >= 0 ? 1 / (first + 1) : 0;
  let dcg = 0;
  for (let i = 0; i < Math.min(topK, relevantAtRank.length); i += 1) {
    if (relevantAtRank[i]) dcg += 1 / Math.log2(i + 2);
  }
  let idcg = 0;
  const idealCount = Math.min(topK, expectedPaths.length);
  for (let i = 0; i < idealCount; i += 1) idcg += 1 / Math.log2(i + 2);
  return {
    recallAtK: recall,
    precisionAtK: precision,
    mrr,
    ndcgAtK: idcg ? dcg / idcg : null,
    firstRelevantRank: first >= 0 ? first + 1 : null,
    returnedPaths: paths,
  };
}

const cases = [];
for (const testCase of fixture.cases) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/agent/retrieval/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
    },
    body: JSON.stringify({
      query: testCase.query,
      repoFullName: fixture.repoFullName,
      candidateK: fixture.defaults.candidateK,
      topK: fixture.defaults.topK,
      tokenBudget: fixture.defaults.tokenBudget,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const wallMs = performance.now() - started;
  if (!response.ok || !payload?.ok) {
    cases.push({
      id: testCase.id,
      ok: false,
      httpStatus: response.status,
      error: payload?.error || `http_${response.status}`,
      warnings: payload?.warnings || [],
      wallMs,
    });
    continue;
  }

  const score = scoreCase(payload, testCase.expectedPaths, fixture.defaults.topK);
  const denseWarning = (payload.warnings || []).find((value) => /^dense_|embedding_|semantic_workspace_|pgvector_/i.test(String(value)));
  cases.push({
    id: testCase.id,
    ok: !denseWarning,
    denseOk: !denseWarning,
    denseWarning: denseWarning || null,
    expectedPaths: testCase.expectedPaths,
    ...score,
    selectedChunks: Number(payload?.metrics?.selectedChunks) || 0,
    selectedTokens: Number(payload?.metrics?.selectedTokens) || 0,
    retrievalMs: Number(payload?.metrics?.totalRetrievalMs) || null,
    wallMs,
    observationRecorded: payload?.observation?.recorded === true,
    observationError: payload?.observation?.error || null,
  });
}

const successful = cases.filter((row) => row.ok);
const average = (key) => successful.length
  ? successful.reduce((sum, row) => sum + (Number(row[key]) || 0), 0) / successful.length
  : 0;
const totalTokens = successful.reduce((sum, row) => sum + (Number(row.selectedTokens) || 0), 0);
const meanRecall = average('recallAtK');
const summary = {
  schemaVersion: fixture.schemaVersion,
  repoFullName: fixture.repoFullName,
  caseCount: cases.length,
  successCount: successful.length,
  denseHealthyCount: cases.filter((row) => row.denseOk).length,
  observationRecordedCount: cases.filter((row) => row.observationRecorded).length,
  recallAtK: meanRecall,
  precisionAtK: average('precisionAtK'),
  mrr: average('mrr'),
  ndcgAtK: average('ndcgAtK'),
  meanRetrievalMs: average('retrievalMs'),
  meanWallMs: average('wallMs'),
  totalSelectedTokens: totalTokens,
  recallPerThousandTokens: totalTokens > 0 ? meanRecall / (totalTokens / 1000) : null,
  cases,
};

const json = JSON.stringify(summary, null, 2);
console.log(json);
if (process.env.AGENTSAM_RETRIEVAL_EVAL_OUT) {
  await fs.writeFile(process.env.AGENTSAM_RETRIEVAL_EVAL_OUT, `${json}\n`, 'utf8');
}

const minimumRecall = Number(process.env.AGENTSAM_RETRIEVAL_MIN_RECALL || 0.5);
const minimumMrr = Number(process.env.AGENTSAM_RETRIEVAL_MIN_MRR || 0.5);
const requireObservations = process.env.AGENTSAM_RETRIEVAL_REQUIRE_OBSERVATIONS !== '0';
if (
  successful.length !== cases.length ||
  meanRecall < minimumRecall ||
  summary.mrr < minimumMrr ||
  (requireObservations && summary.observationRecordedCount !== cases.length)
) {
  process.exitCode = 1;
}
