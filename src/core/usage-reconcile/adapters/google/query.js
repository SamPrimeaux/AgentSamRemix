/**
 * BigQuery jobs.query helper (REST).
 */

/** @param {string} projectId @param {string} token @param {string} sql */
export async function bigQueryQuery(projectId, token, sql) {
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: sql,
      useLegacySql: false,
      timeoutMs: 60000,
      maxResults: 1000,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const msg = body.error?.message || JSON.stringify(body).slice(0, 400);
    throw new Error(`bigquery query HTTP ${res.status}: ${msg}`);
  }
  const fields = (body.schema?.fields || []).map((f) => f.name);
  const rows = (body.rows || []).map((row) => {
    const obj = {};
    (row.f || []).forEach((cell, i) => {
      obj[fields[i] || `c${i}`] = cell?.v;
    });
    return obj;
  });
  return rows;
}
