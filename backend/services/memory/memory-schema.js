import {
  MEMORY_EMBEDDING_DIMENSIONS,
  MEMORY_PG_QUALIFIED,
} from './constants.js';

export const MEMORY_SELECT_COLUMNS = [
  'id',
  'workspace_id',
  'subject_id',
  'agent_id',
  'tenant_id',
  'memory_type',
  'content',
  'content_hash',
  'embedding_model',
  'embedding_dimensions',
  'importance',
  'confidence',
  'source_type',
  'source_id',
  'metadata',
  'supersedes_id',
  'superseded_by_id',
  'is_active',
  'expires_at_unix',
  'created_at_unix',
  'updated_at_unix',
  'embedded_at_unix',
].join(',\n          ');

export function memoryTable() {
  return MEMORY_PG_QUALIFIED;
}

export function vectorLiteral(vector) {
  if (!Array.isArray(vector) || vector.length !== MEMORY_EMBEDDING_DIMENSIONS) {
    throw new TypeError(
      `embedding must contain exactly ${MEMORY_EMBEDDING_DIMENSIONS} values`,
    );
  }
  if (!vector.every(Number.isFinite)) {
    throw new TypeError('embedding contains a non-finite value');
  }
  return `[${vector.join(',')}]`;
}
