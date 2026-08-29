import {
  MEMORY_EMBEDDING_DIMENSIONS,
  MEMORY_EMBEDDING_MODEL,
  MEMORY_MAX_LIMIT,
} from './constants.js';
import { MemoryEmbedding, assertEmbedding } from './memory-embedding.js';
import { assertMemoryClient } from './memory-client-contract.js';
import { assertMemoryStore } from './memory-repository.js';
import { retrieveMemories } from './memory-retrieval.js';
import {
  clamp01,
  normalizeLimit,
  normalizeMemoryContent,
  normalizeMemoryInput,
  normalizeMemorySearch,
  nowUnix,
  nullableString,
  requireNonEmptyString,
  shouldRemember,
} from './memory-policy.js';

export class MemoryService {
  constructor({
    repository,
    embeddingProvider,
    idFactory = defaultIdFactory,
    now = () => Date.now(),
  }) {
    this.repository = assertMemoryStore(repository);
    this.embedding = new MemoryEmbedding(embeddingProvider);
    this.idFactory = idFactory;
    this.now = now;
    assertMemoryClient(this);
  }

  async remember(input) {
    if (!shouldRemember(input)) {
      throw new TypeError('content is required');
    }
    const normalized = normalizeMemoryInput(input);
    const embedding = await this.embedding.embedDocument(normalized.content, {
      title: normalized.memoryType,
    });
    const contentHash = await sha256Hex(normalized.content);

    return this.repository.insert({
      id: this.idFactory(),
      ...normalized,
      contentHash,
      embedding,
      embeddingModel: MEMORY_EMBEDDING_MODEL,
      embeddingDimensions: MEMORY_EMBEDDING_DIMENSIONS,
    });
  }

  async get({ id, workspaceId }) {
    return this.repository.getById({
      id: requireNonEmptyString(id, 'id'),
      workspaceId: requireNonEmptyString(workspaceId, 'workspaceId'),
    });
  }

  async search(input) {
    const normalized = normalizeMemorySearch(input);
    return retrieveMemories({
      store: this.repository,
      embedding: this.embedding,
      search: normalized,
      now: nowUnix(this.now()),
    });
  }

  async list({
    workspaceId,
    limit = 25,
    subjectId = null,
    memoryType = null,
    includeInactive = false,
  } = {}) {
    return this.repository.list({
      workspaceId: requireNonEmptyString(workspaceId, 'workspaceId'),
      limit: normalizeLimit(limit),
      subjectId: nullableString(subjectId),
      memoryType: nullableString(memoryType),
      includeInactive: Boolean(includeInactive),
    });
  }

  async update({ id, workspaceId, patch }) {
    const memoryId = requireNonEmptyString(id, 'id');
    const wid = requireNonEmptyString(workspaceId, 'workspaceId');
    if (!patch || typeof patch !== 'object') {
      throw new TypeError('patch is required');
    }

    const safePatch = {};

    if (Object.prototype.hasOwnProperty.call(patch, 'content')) {
      const content = normalizeMemoryContent(patch.content);
      if (!content) throw new TypeError('content cannot be empty');
      const embedding = await this.embedding.embedDocument(content, {
        title: String(patch.memoryType ?? 'memory'),
      });
      assertEmbedding(embedding);
      safePatch.content = content;
      safePatch.contentHash = await sha256Hex(content);
      safePatch.embedding = embedding;
      safePatch.embeddingModel = MEMORY_EMBEDDING_MODEL;
      safePatch.embeddingDimensions = MEMORY_EMBEDDING_DIMENSIONS;
      safePatch.embeddedAtUnix = nowUnix(this.now());
    }

    copyString(patch, safePatch, 'memoryType');
    copyNullableString(patch, safePatch, 'subjectId');
    copyNullableString(patch, safePatch, 'agentId');
    copyNullableString(patch, safePatch, 'tenantId');
    copyNullableString(patch, safePatch, 'sourceType');
    copyNullableString(patch, safePatch, 'sourceId');

    if (Object.prototype.hasOwnProperty.call(patch, 'importance')) {
      safePatch.importance = clamp01(patch.importance, 0.5);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'confidence')) {
      safePatch.confidence = clamp01(patch.confidence, 0.75);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'metadata')) {
      safePatch.metadata =
        patch.metadata && typeof patch.metadata === 'object' && !Array.isArray(patch.metadata)
          ? patch.metadata
          : {};
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'expiresAtUnix')) {
      if (patch.expiresAtUnix == null || patch.expiresAtUnix === '') {
        safePatch.expiresAtUnix = null;
      } else {
        const n = Number(patch.expiresAtUnix);
        if (!Number.isInteger(n) || n <= 0) {
          throw new TypeError('expiresAtUnix must be a positive unixepoch integer');
        }
        safePatch.expiresAtUnix = n;
      }
    }

    return this.repository.update({
      id: memoryId,
      workspaceId: wid,
      patch: safePatch,
    });
  }

  async forget({ id, workspaceId }) {
    return this.repository.softDelete({
      id: requireNonEmptyString(id, 'id'),
      workspaceId: requireNonEmptyString(workspaceId, 'workspaceId'),
    });
  }

  async supersede({ id, workspaceId, replacement }) {
    const old = await this.get({ id, workspaceId });
    if (!old) return null;

    const next = await this.remember({
      workspaceId,
      subjectId: replacement.subjectId ?? old.subject_id,
      agentId: replacement.agentId ?? old.agent_id,
      tenantId: replacement.tenantId ?? old.tenant_id,
      memoryType: replacement.memoryType ?? old.memory_type,
      content: replacement.content,
      importance: replacement.importance ?? old.importance,
      confidence: replacement.confidence ?? old.confidence,
      sourceType: replacement.sourceType ?? old.source_type,
      sourceId: replacement.sourceId ?? old.source_id,
      metadata: replacement.metadata ?? old.metadata ?? {},
      expiresAtUnix: replacement.expiresAtUnix ?? old.expires_at_unix,
    });

    await this.repository.update({
      id: next.id,
      workspaceId,
      patch: { supersedesId: old.id },
    });

    await this.repository.update({
      id: old.id,
      workspaceId,
      patch: {
        supersededById: next.id,
        isActive: false,
      },
    });

    return this.get({ id: next.id, workspaceId });
  }

  async consolidate({ workspaceId, limit = MEMORY_MAX_LIMIT } = {}) {
    const wid = requireNonEmptyString(workspaceId, 'workspaceId');
    const rows = await this.list({
      workspaceId: wid,
      limit: normalizeLimit(limit),
    });

    const byHash = new Map();
    for (const row of rows) {
      const key = String(row.content_hash || '');
      if (!key) continue;
      const group = byHash.get(key) || [];
      group.push(row);
      byHash.set(key, group);
    }

    const retired = [];
    for (const group of byHash.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => {
        const imp = Number(b.importance) - Number(a.importance);
        if (imp !== 0) return imp;
        return Number(b.updated_at_unix) - Number(a.updated_at_unix);
      });
      const [keep, ...rest] = group;
      for (const old of rest) {
        await this.forget({ id: old.id, workspaceId: wid });
        retired.push({ kept: keep.id, forgotten: old.id });
      }
    }

    return { retired };
  }
}

function defaultIdFactory() {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('crypto.randomUUID() is required or pass idFactory');
  }
  return `mem_${globalThis.crypto.randomUUID()}`;
}

async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('crypto.subtle is required');
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function copyString(source, target, key) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return;
  target[key] = requireNonEmptyString(source[key], key);
}

function copyNullableString(source, target, key) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return;
  target[key] = nullableString(source[key]);
}
