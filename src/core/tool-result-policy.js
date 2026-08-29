export const ABSOLUTE_TOOL_RESULT_BYTES = 64 * 1024;

function parseJson(raw, fallback = null) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function operationFromInput(input = {}) {
  const raw = String(
    input.operation ?? input.op ?? input.sub_operation ?? input.action ?? input.mode ?? '',
  ).trim().toLowerCase();
  const aliases = {
    memory_search: 'search',
    memory_list: 'list',
    memory_read: 'read',
    memory_write: 'write',
    memory_delete: 'delete',
    memory_resolve: 'resolve',
    upsert: 'write',
    save: 'write',
    get: 'read',
    close: 'resolve',
  };
  return aliases[raw] || raw || 'default';
}

function truncateValue(value, maxChars) {
  if (typeof value !== 'string' || !maxChars || value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function projectObject(value, fields, fieldLimits = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const field of fields || []) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    out[field] = truncateValue(value[field], Number(fieldLimits[field]) || 0);
  }
  return out;
}

function schemaMatches(schema, value) {
  if (!schema || typeof schema !== 'object') return true;
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.filter((candidate) => schemaMatches(candidate, value)).length === 1;
  }
  const type = schema.type;
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
    }
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (Object.prototype.hasOwnProperty.call(value, key) && !schemaMatches(child, value[key])) return false;
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) return false;
    if (schema.maxItems != null && value.length > Number(schema.maxItems)) return false;
    if (schema.items && value.some((item) => !schemaMatches(schema.items, item))) return false;
  } else if (type === 'string' && typeof value !== 'string') {
    return false;
  } else if (type === 'number' && typeof value !== 'number') {
    return false;
  } else if (type === 'integer' && !Number.isInteger(value)) {
    return false;
  } else if (type === 'boolean' && typeof value !== 'boolean') {
    return false;
  } else if (type === 'null' && value !== null) {
    return false;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  return true;
}

function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

async function emitPolicyTelemetry(env, toolRow, context, telemetry) {
  console.info('[tool-result-policy]', JSON.stringify(telemetry));
  if (!env?.DB) return;
  await env.DB.prepare(
    `INSERT INTO agentsam_tool_result_policy_log
       (id, tool_id, tool_key, operation, original_bytes, returned_bytes,
        original_items, returned_items, was_truncated, outcome,
        agent_run_id, conversation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
  )
    .bind(
      `trp_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
      toolRow.id,
      toolRow.tool_key,
      telemetry.operation,
      telemetry.original_bytes,
      telemetry.returned_bytes,
      telemetry.original_items,
      telemetry.returned_items,
      telemetry.was_truncated ? 1 : 0,
      telemetry.outcome,
      context.agentRunId ?? context.agent_run_id ?? null,
      context.conversationId ?? context.conversation_id ?? context.sessionId ?? null,
    )
    .run()
    .catch(() => null);
}

export async function applyToolResultPolicy({
  env,
  toolRow,
  input,
  result,
  context = {},
}) {
  const policy = parseJson(toolRow?.result_policy_json, null);
  if (!policy || Number(policy.version) !== 1) return result;

  const operation = operationFromInput(input);
  const opPolicy = policy.operations?.[operation] ?? policy.operations?.default;
  if (!opPolicy) {
    return {
      error: 'tool_result_contract_error',
      code: 'result_policy_operation_missing',
      tool_key: toolRow.tool_key,
      operation,
    };
  }

  const originalBytes = byteLength(result);
  const collectionField = String(opPolicy.collection_field || '');
  const originalItems =
    collectionField && Array.isArray(result?.[collectionField]) ? result[collectionField].length : 0;
  const rootFields = opPolicy.root_fields || Object.keys(result || {});
  if (
    collectionField &&
    Object.prototype.hasOwnProperty.call(result || {}, collectionField) &&
    !Array.isArray(result[collectionField])
  ) {
    await emitPolicyTelemetry(env, toolRow, context, {
      tool_key: toolRow.tool_key,
      operation,
      original_bytes: originalBytes,
      returned_bytes: 0,
      original_items: 0,
      returned_items: 0,
      was_truncated: true,
      outcome: 'schema_rejected',
      policy_version: 1,
    });
    return {
      error: 'tool_result_contract_error',
      code: 'output_schema_validation_failed',
      tool_key: toolRow.tool_key,
      operation,
    };
  }
  let bounded = projectObject(result, rootFields, opPolicy.field_char_limits);
  if (rootFields.includes('operation')) bounded.operation = operation;

  if (collectionField) {
    const source = Array.isArray(result?.[collectionField]) ? result[collectionField] : [];
    const maxItems = Math.max(0, Number(opPolicy.max_items) || 0);
    bounded[collectionField] = source
      .slice(0, maxItems)
      .map((item) => projectObject(item, opPolicy.item_fields || [], opPolicy.item_field_char_limits));
    if (opPolicy.count_field) bounded[opPolicy.count_field] = bounded[collectionField].length;
  }

  const configuredMax = Math.max(256, Number(opPolicy.max_serialized_bytes) || ABSOLUTE_TOOL_RESULT_BYTES);
  const maxBytes = Math.min(configuredMax, ABSOLUTE_TOOL_RESULT_BYTES);
  if (collectionField && Array.isArray(bounded[collectionField])) {
    while (bounded[collectionField].length > 0 && byteLength(bounded) > maxBytes) {
      bounded[collectionField].pop();
      if (opPolicy.count_field) bounded[opPolicy.count_field] = bounded[collectionField].length;
    }
  }

  const returnedBytes = byteLength(bounded);
  const returnedItems =
    collectionField && Array.isArray(bounded[collectionField]) ? bounded[collectionField].length : 0;
  const telemetry = {
    tool_key: toolRow.tool_key,
    operation,
    original_bytes: originalBytes,
    returned_bytes: returnedBytes,
    original_items: originalItems,
    returned_items: returnedItems,
    was_truncated: returnedBytes < originalBytes || returnedItems < originalItems,
    outcome: 'ok',
    policy_version: 1,
  };

  if (returnedBytes > maxBytes || returnedBytes > ABSOLUTE_TOOL_RESULT_BYTES) {
    telemetry.outcome = 'size_rejected';
    await emitPolicyTelemetry(env, toolRow, context, telemetry);
    return {
      error: 'tool_result_contract_error',
      code: 'bounded_result_too_large',
      tool_key: toolRow.tool_key,
      operation,
    };
  }

  const outputSchema = parseJson(toolRow.output_schema, null);
  if (outputSchema && !schemaMatches(outputSchema, bounded)) {
    telemetry.outcome = 'schema_rejected';
    await emitPolicyTelemetry(env, toolRow, context, telemetry);
    return {
      error: 'tool_result_contract_error',
      code: 'output_schema_validation_failed',
      tool_key: toolRow.tool_key,
      operation,
    };
  }

  await emitPolicyTelemetry(env, toolRow, context, telemetry);
  return bounded;
}
