/**
 * Docs-family adapter: markdown topic (PDF-derived) → ingest_segment input.
 * Grounding uses pdf_pages from frontmatter when present.
 */

import { contentHash } from '../../../backend/rag/index.js';

export const DOCS_PROJECTION_KEY = 'docs:oai3large:1536:v1';
export const DOCS_EMBEDDING_ROUTE_VERSION = 'text-embedding-3-large:1536';
export const BYTEBYTEGO_SNAPSHOT_ID = 'snap_bytebytego_linkedin_2024_claude_v1';
export const BYTEBYTEGO_PIPELINE = 'bytebytego_topic_v1';

/**
 * @param {string} raw
 * @returns {Record<string, string>}
 */
export function parseFrontmatter(raw) {
  const m = String(raw ?? '').match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function stripFrontmatter(raw) {
  const m = String(raw ?? '').match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return (m ? m[1] : raw).trim();
}

/**
 * @param {string} pages
 * @returns {{ pageStart: number, pageEnd: number } | null}
 */
export function parsePdfPages(pages) {
  const s = String(pages ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d+)\s*[-–—]\s*(\d+)$/) || s.match(/^(\d+)$/);
  if (!m) return null;
  const pageStart = Number(m[1]);
  const pageEnd = Number(m[2] ?? m[1]);
  if (!Number.isInteger(pageStart) || !Number.isInteger(pageEnd) || pageStart < 1 || pageEnd < pageStart) {
    return null;
  }
  return { pageStart, pageEnd };
}

/**
 * Content-addressed segment id (stable across re-ingest of same snapshot body).
 * @param {string} snapshotId
 * @param {string} title
 * @param {string} body
 * @param {string} [pipelineVersion]
 */
export async function deriveSegmentId(snapshotId, title, body, pipelineVersion = BYTEBYTEGO_PIPELINE) {
  const material = `${snapshotId}\n${title}\n${body}\n${pipelineVersion}`;
  const hash = await contentHash(material);
  return `seg_${hash.slice(0, 32)}`;
}

/**
 * @param {{
 *   workspace_id_d1: string,
 *   markdown: string,
 *   fileName: string,
 *   source_snapshot_id?: string,
 *   pipeline_version?: string,
 *   knowledge_object_id?: string,
 *   artifact_key?: string,
 *   ordinal?: number,
 *   metadata?: Record<string, unknown>,
 * }} opts
 */
export async function docsTopicToIngestInput(opts) {
  const workspaceIdD1 = String(opts.workspace_id_d1 ?? '').trim();
  if (!workspaceIdD1) throw new Error('docsTopicToIngestInput: workspace_id_d1 required');

  const fileName = String(opts.fileName ?? '').trim();
  if (!fileName) throw new Error('docsTopicToIngestInput: fileName required');

  const raw = String(opts.markdown ?? '');
  const fm = parseFrontmatter(raw);
  const body = stripFrontmatter(raw);
  if (!body) throw new Error('docsTopicToIngestInput: empty body');

  const title = String(fm.title || fileName.replace(/\.md$/i, '')).trim();
  const snapshotId = String(opts.source_snapshot_id || BYTEBYTEGO_SNAPSHOT_ID).trim();
  const pipeline = String(opts.pipeline_version || BYTEBYTEGO_PIPELINE).trim();
  const segmentId = await deriveSegmentId(snapshotId, title, body, pipeline);
  const stem = fileName.replace(/\.md$/i, '');
  const knowledgeObjectId = String(
    opts.knowledge_object_id || `obj_bytebytego_${stem}`,
  ).trim();
  const artifactKey = String(
    opts.artifact_key ||
      `documents/${workspaceIdD1}/bytebytego-linkedin-2024/chunks/${fileName}`,
  ).trim();
  const sourceRef = `bytebytego:${snapshotId}:${segmentId}`;

  /** @type {Array<Record<string, unknown>>} */
  const grounding = [];
  const pages = parsePdfPages(fm.pdf_pages);
  if (pages) {
    grounding.push({
      kind: 'pdf_page',
      sourceSnapshotId: snapshotId,
      knowledgeObjectId,
      segmentId,
      pageStart: pages.pageStart,
      pageEnd: pages.pageEnd,
      artifactKey,
      extractionMethod: 'native',
    });
  }

  const topicOrdinal = Number(fm.chunk_index);
  const ordinal =
    opts.ordinal != null
      ? Number(opts.ordinal)
      : Number.isInteger(topicOrdinal) && topicOrdinal > 0
        ? topicOrdinal - 1
        : 0;

  return {
    lane: 'docs',
    workspace_id_d1: workspaceIdD1,
    source_snapshot_id: snapshotId,
    knowledge_object_id: knowledgeObjectId,
    segment_id: segmentId,
    projection_key: DOCS_PROJECTION_KEY,
    embedding_route_version: DOCS_EMBEDDING_ROUTE_VERSION,
    ordinal,
    title,
    content: body,
    artifact_key: artifactKey,
    grounding,
    tags: ['bytebytego', 'linkedin-2024', 'docs'],
    metadata: {
      file: fileName,
      pdf_pages: fm.pdf_pages || null,
      pipeline_version: pipeline,
      source_ref: sourceRef,
      source_path: sourceRef,
      source_type: 'markdown',
      chunk_type: 'section',
      object_key: artifactKey,
      ...(opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {}),
    },
  };
}
