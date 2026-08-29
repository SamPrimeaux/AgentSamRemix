import {
  EXEC_JOURNAL_HARD_CEILING,
  EXEC_JOURNAL_INLINE_MAX,
  EXEC_JOURNAL_SUMMARY_MAX,
  assertJournalPayloadUnderCeiling,
  compactPayloadForJournal,
  ensureOutputSummary,
  safeJsonStringify,
} from '../../telemetry/execution-journal-compact.js';

/** Compact one workflow step journal entry; runtime output never lives here. */
export function compactWorkflowStepEntry(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const outRaw = e.output;
  let outBytes = 0;
  let outSummary = '';
  if (outRaw != null) {
    const s = typeof outRaw === 'string' ? outRaw : safeJsonStringify(outRaw);
    outBytes = s.length;
    outSummary = ensureOutputSummary(outRaw, {
      toolName: e.node_key || e.handler_key || e.name,
      ok: e.ok !== false && e.status !== 'failed',
      errorMessage: e.error != null ? String(e.error) : null,
    });
  } else if (e.error != null) {
    outSummary = ensureOutputSummary(null, {
      ok: false,
      errorMessage: String(e.error),
      toolName: e.node_key || e.name,
    });
  } else {
    outSummary = ensureOutputSummary(e.summary ?? e.status ?? 'step', {
      toolName: e.node_key || e.name,
    });
  }

  const ok = e.ok !== false && e.status !== 'failed';
  return {
    node_key: e.node_key ?? e.name ?? null,
    node_type: e.node_type ?? null,
    handler_key: e.handler_key ?? null,
    step: e.step ?? null,
    name: e.name ?? null,
    ok,
    status: e.status != null ? e.status : ok ? 'completed' : 'failed',
    error: e.error != null ? String(e.error).slice(0, 500) : null,
    tool_chain_id: e.tool_chain_id ?? null,
    output_bytes: outBytes,
    output_summary: outSummary.slice(0, EXEC_JOURNAL_SUMMARY_MAX),
  };
}

export function compactStepResultsJson(stepResults) {
  const list = Array.isArray(stepResults) ? stepResults.map(compactWorkflowStepEntry) : [];
  const jsonText = safeJsonStringify(list);
  assertJournalPayloadUnderCeiling(jsonText, {
    digest: 'step_results_compact',
    field: 'step_results_json',
  });
  if (jsonText.length > EXEC_JOURNAL_HARD_CEILING) {
    const kept = [];
    let acc = 2;
    for (const row of list) {
      const piece = safeJsonStringify(row);
      if (acc + piece.length + 1 > EXEC_JOURNAL_INLINE_MAX) break;
      kept.push(row);
      acc += piece.length + 1;
    }
    return safeJsonStringify({
      __journal_compact: 1,
      total_steps: list.length,
      kept,
      truncated: true,
    });
  }
  return jsonText;
}

export async function compactWorkflowInputJson(input) {
  const packed = await compactPayloadForJournal(input ?? {}, {
    field: 'input_json',
    inlineMax: EXEC_JOURNAL_INLINE_MAX,
  });
  return packed.jsonText;
}
