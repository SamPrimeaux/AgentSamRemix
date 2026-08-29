/**
 * Runtime-neutral contracts for the memory service.
 * Frontend/API callers may depend on these shapes, never on providers.
 *
 * @typedef {'fact'|'preference'|'goal'|'decision'|'instruction'|'context'|'summary'|'relationship'|'policy'|'state'|'error'|'custom'} MemoryType
 *
 * @typedef {Object} MemoryInput
 * @property {string} workspaceId
 * @property {string} content
 * @property {MemoryType|string} [memoryType]
 * @property {string|null} [subjectId]
 * @property {string|null} [agentId]
 * @property {string|null} [tenantId]
 * @property {number} [importance]
 * @property {number} [confidence]
 * @property {string|null} [sourceType]
 * @property {string|null} [sourceId]
 * @property {Record<string, unknown>} [metadata]
 * @property {number|null} [expiresAtUnix]
 *
 * @typedef {Object} MemorySearchInput
 * @property {string} workspaceId
 * @property {string} query
 * @property {number} [limit]
 * @property {string|null} [subjectId]
 * @property {string|null} [memoryType]
 * @property {number} [minConfidence]
 * @property {boolean} [includeExpired]
 *
 * @typedef {Object} MemoryRecord
 * @property {string} id
 * @property {string} workspace_id
 * @property {string|null} subject_id
 * @property {string|null} agent_id
 * @property {string|null} tenant_id
 * @property {string} memory_type
 * @property {string} content
 * @property {string} content_hash
 * @property {number} importance
 * @property {number} confidence
 * @property {string|null} source_type
 * @property {string|null} source_id
 * @property {Record<string, unknown>} metadata
 * @property {string|null} supersedes_id
 * @property {string|null} superseded_by_id
 * @property {boolean} is_active
 * @property {number|null} expires_at_unix
 * @property {number} created_at_unix
 * @property {number} updated_at_unix
 * @property {number} embedded_at_unix
 * @property {number} [semantic_score]
 * @property {number} [rank_score]
 *
 * @typedef {Object} MemoryStore
 * @property {(memory: object) => Promise<MemoryRecord>} insert
 * @property {(args: {id: string, workspaceId: string}) => Promise<MemoryRecord|null>} getById
 * @property {(args: object) => Promise<MemoryRecord[]>} search
 * @property {(args: object) => Promise<MemoryRecord[]>} list
 * @property {(args: {id: string, workspaceId: string, patch: object}) => Promise<MemoryRecord|null>} update
 * @property {(args: {id: string, workspaceId: string}) => Promise<MemoryRecord|null>} softDelete
 *
 * @typedef {Object} EmbeddingProvider
 * @property {(text: string, opts?: {title?: string|null}) => Promise<number[]>} embedDocument
 * @property {(text: string) => Promise<number[]>} embedQuery
 */

export {};
