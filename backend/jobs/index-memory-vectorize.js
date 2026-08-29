import { chunkMarkdown } from './chunk-markdown.js';
import { generateWorkersAiEmbedding } from '../../src/core/embed-workers-ai.js';
import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';

const RAG_EMBED_BATCH_SIZE = 32;

export async function indexMemoryMarkdownToVectorize(env) {
  const begun = env?.DB
    ? await startCronRun(env, {
        jobName: 'index_memory_vectorize',
        cronExpression: '0 6 * * *',
        tenantId: null,
        workspaceId: null,
      })
    : null;
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();

  const keys = [];
  // Cron env may omit R2 on some worker entrypoints — guard before .list.
  if (env.R2?.list) {
    for (const prefix of ['memory/daily/', 'memory/compacted-chats/', 'knowledge/', 'docs/']) {
      let cursor;
      do {
        const list = await env.R2.list({ prefix, limit: 200, cursor });
        const objects = list.objects || [];
        for (const o of objects) {
          if (o.key && !o.key.endsWith('/')) keys.push(o.key);
        }
        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);
    }
  }
  if (!keys.includes('memory/schema-and-records.md')) keys.push('memory/schema-and-records.md');
  if (!keys.includes('memory/today-todo.md')) keys.push('memory/today-todo.md');

  const allChunks = [];
  for (const key of keys) {
    try {
      const obj = await env.R2.get(key);
      if (!obj) continue;
      const text = await obj.text();
      const date = key.match(/memory\/daily\/(\d{4}-\d{2}-\d{2})\.md$/)?.[1]
        || key.match(/memory\/compacted-chats\/(\d{4}-\d{2}-\d{2})\.md$/)?.[1]
        || null;
      const chunks = chunkMarkdown(text);
      const slug = key.replace(/\.md$/, '').replace(/\//g, '-');
      chunks.forEach((c, i) => {
        allChunks.push({
          id: `mem-${slug}-${i}`,
          text: c,
          source: key,
          date: date || '',
        });
      });
    } catch (e) {
      console.warn('[rag/index-memory] skip', key, e?.message);
    }
  }

  if (allChunks.length === 0) {
    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: keys.length,
        rowsWritten: 0,
        metadata: { message: 'No content to index' },
      });
    }
    return { indexed: keys.length, chunks: 0, message: 'No content to index' };
  }

  try {
    const vectors = [];
    for (let i = 0; i < allChunks.length; i += RAG_EMBED_BATCH_SIZE) {
      const batch = allChunks.slice(i, i + RAG_EMBED_BATCH_SIZE);
      const texts = batch.map((b) => b.text);
      let values;
      try {
        const vecs = await generateWorkersAiEmbedding(env, texts);
        values = Array.isArray(vecs) ? vecs : [];
      } catch (e) {
        throw new Error(`Embedding batch failed: ${e?.message || e}`);
      }
      batch.forEach((b, j) => {
        const vec = values[j];
        if (vec && Array.isArray(vec)) {
          vectors.push({
            id: b.id,
            values: vec,
            metadata: { source: b.source, date: b.date },
          });
        }
      });
    }

    // DISABLED: manual Vectorize upsert corrupts AutoRAG index (same index used by AI Search)
    // if (vectors.length > 0 && env.VECTORIZE.upsert) {
    //   await env.VECTORIZE.upsert(vectors);
    // }

    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: keys.length,
        rowsWritten: vectors.length,
        metadata: { chunks: vectors.length },
      });
    }
    return { indexed: keys.length, chunks: vectors.length };
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    throw e;
  }
}
