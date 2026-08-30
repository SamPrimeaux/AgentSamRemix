export const MEMORY_SELECT_COLUMNS = [
  'id', 'workspace_id', 'subject_id', 'agent_id', 'tenant_id', 'memory_type',
  'content', 'content_hash', 'embedding_model', 'embedding_dimensions', 'importance',
  'confidence', 'source_type', 'source_id', 'metadata', 'supersedes_id',
  'superseded_by_id', 'is_active', 'expires_at_unix', 'created_at_unix',
  'updated_at_unix', 'embedded_at_unix',
].join(',\n          ');

export function qualifiedMemoryTable(schemaName, tableName) {
  const safe = (value, field) => {
    const text = String(value || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) throw new Error(`memory_${field}_invalid`);
    return text;
  };
  return `${safe(schemaName, 'schema')}.${safe(tableName, 'table')}`;
}

export function vectorLiteral(vector, dimensions) {
  const expected = Number(dimensions);
  if (!Number.isInteger(expected) || expected <= 0) throw new TypeError('embedding dimensions required');
  if (!Array.isArray(vector) || vector.length !== expected) {
    throw new TypeError(`embedding must contain exactly ${expected} values`);
  }
  if (!vector.every(Number.isFinite)) throw new TypeError('embedding contains a non-finite value');
  return `[${vector.join(',')}]`;
}
