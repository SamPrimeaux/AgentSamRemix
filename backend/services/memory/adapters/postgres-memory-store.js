import { MEMORY_EMBEDDING_DIMENSIONS } from '../constants.js';
import { memoryTable, MEMORY_SELECT_COLUMNS, vectorLiteral } from '../memory-schema.js';

/**
 * pgvector MemoryStore.
 *
 * sql.query(text, params) -> Promise<{ rows: any[] } | any[]>
 *
 * Wrap Hyperdrive / pg here. Do not import src/core from this file.
 */
export class PostgresMemoryStore {
  constructor({ sql, nowUnix = () => Math.floor(Date.now() / 1000) }) {
    if (!sql || typeof sql.query !== 'function') {
      throw new TypeError('sql.query(text, params) is required');
    }
    this.sql = sql;
    this.nowUnix = nowUnix;
  }

  async insert(memory) {
    const now = this.nowUnix();
    const result = await this.sql.query(
      `
        INSERT INTO ${memoryTable()} (
          id,
          workspace_id,
          subject_id,
          agent_id,
          tenant_id,
          memory_type,
          content,
          content_hash,
          embedding,
          embedding_model,
          embedding_dimensions,
          importance,
          confidence,
          source_type,
          source_id,
          metadata,
          expires_at_unix,
          created_at_unix,
          updated_at_unix,
          embedded_at_unix
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9::vector(1536),
          $10, $11, $12, $13, $14, $15, $16::jsonb,
          $17, $18, $19, $20
        )
        RETURNING ${MEMORY_SELECT_COLUMNS}
      `,
      [
        memory.id,
        memory.workspaceId,
        memory.subjectId,
        memory.agentId,
        memory.tenantId,
        memory.memoryType,
        memory.content,
        memory.contentHash,
        vectorLiteral(memory.embedding),
        memory.embeddingModel,
        MEMORY_EMBEDDING_DIMENSIONS,
        memory.importance,
        memory.confidence,
        memory.sourceType,
        memory.sourceId,
        JSON.stringify(memory.metadata ?? {}),
        memory.expiresAtUnix,
        now,
        now,
        now,
      ],
    );
    return one(result);
  }

  async getById({ id, workspaceId }) {
    const result = await this.sql.query(
      `
        SELECT ${MEMORY_SELECT_COLUMNS}
        FROM ${memoryTable()}
        WHERE id = $1
          AND workspace_id = $2
        LIMIT 1
      `,
      [id, workspaceId],
    );
    return one(result) ?? null;
  }

  async search({
    workspaceId,
    queryEmbedding,
    limit,
    subjectId = null,
    memoryType = null,
    minConfidence = 0,
    includeExpired = false,
    nowUnix = this.nowUnix(),
  }) {
    const result = await this.sql.query(
      `
        SELECT
          ${MEMORY_SELECT_COLUMNS},
          GREATEST(
            0,
            LEAST(
              1,
              1 - (embedding <=> $1::vector(1536))
            )
          )::double precision AS semantic_score
        FROM ${memoryTable()}
        WHERE workspace_id = $2
          AND is_active = TRUE
          AND embedding IS NOT NULL
          AND ($3::text IS NULL OR subject_id = $3)
          AND ($4::text IS NULL OR memory_type = $4)
          AND confidence >= $5
          AND (
            $6::boolean = TRUE
            OR expires_at_unix IS NULL
            OR expires_at_unix > $7
          )
        ORDER BY embedding <=> $1::vector(1536)
        LIMIT $8
      `,
      [
        vectorLiteral(queryEmbedding),
        workspaceId,
        subjectId,
        memoryType,
        minConfidence,
        includeExpired,
        nowUnix,
        limit,
      ],
    );
    return rows(result);
  }

  async list({
    workspaceId,
    limit,
    subjectId = null,
    memoryType = null,
    includeInactive = false,
  }) {
    const result = await this.sql.query(
      `
        SELECT ${MEMORY_SELECT_COLUMNS}
        FROM ${memoryTable()}
        WHERE workspace_id = $1
          AND ($2::text IS NULL OR subject_id = $2)
          AND ($3::text IS NULL OR memory_type = $3)
          AND ($4::boolean = TRUE OR is_active = TRUE)
        ORDER BY updated_at_unix DESC
        LIMIT $5
      `,
      [workspaceId, subjectId, memoryType, includeInactive, limit],
    );
    return rows(result);
  }

  async update({ id, workspaceId, patch }) {
    const allowed = new Map([
      ['content', 'content'],
      ['contentHash', 'content_hash'],
      ['embedding', 'embedding'],
      ['embeddingModel', 'embedding_model'],
      ['embeddingDimensions', 'embedding_dimensions'],
      ['memoryType', 'memory_type'],
      ['subjectId', 'subject_id'],
      ['agentId', 'agent_id'],
      ['tenantId', 'tenant_id'],
      ['importance', 'importance'],
      ['confidence', 'confidence'],
      ['sourceType', 'source_type'],
      ['sourceId', 'source_id'],
      ['metadata', 'metadata'],
      ['expiresAtUnix', 'expires_at_unix'],
      ['supersedesId', 'supersedes_id'],
      ['supersededById', 'superseded_by_id'],
      ['isActive', 'is_active'],
      ['embeddedAtUnix', 'embedded_at_unix'],
    ]);

    const assignments = [];
    const params = [id, workspaceId];

    for (const [key, column] of allowed.entries()) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      let value = patch[key];
      let cast = '';
      if (key === 'embedding') {
        value = vectorLiteral(value);
        cast = '::vector(1536)';
      } else if (key === 'metadata') {
        value = JSON.stringify(value ?? {});
        cast = '::jsonb';
      }
      params.push(value);
      assignments.push(`${column} = $${params.length}${cast}`);
    }

    if (!assignments.length) {
      return this.getById({ id, workspaceId });
    }

    params.push(this.nowUnix());
    assignments.push(`updated_at_unix = $${params.length}`);

    const result = await this.sql.query(
      `
        UPDATE ${memoryTable()}
        SET ${assignments.join(', ')}
        WHERE id = $1
          AND workspace_id = $2
        RETURNING ${MEMORY_SELECT_COLUMNS}
      `,
      params,
    );
    return one(result) ?? null;
  }

  async softDelete({ id, workspaceId }) {
    return this.update({
      id,
      workspaceId,
      patch: { isActive: false },
    });
  }
}

function rows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

function one(result) {
  return rows(result)[0];
}
