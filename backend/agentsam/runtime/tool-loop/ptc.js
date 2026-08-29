/**
 * OpenAI Responses PTC (previous_response_id / replay) helpers for the tool loop.
 * Mutates openaiResponsesAccumulatedInput / activeTools via the bag.
 */

/**
 * @param {{
 *   emit: (type: string, payload?: object) => void,
 *   getOpenaiPtcActive: () => boolean,
 *   getOpenaiResponsesAccumulatedInput: () => unknown[]|null,
 *   getActiveTools: () => unknown,
 *   setActiveTools: (tools: unknown) => void,
 *   getOpenWebSearchRetired: () => boolean,
 *   setOpenWebSearchRetired: (v: boolean) => void,
 * }} deps
 */
export function createAgentToolLoopPtcHelpers(deps) {
  const appendOpenaiPtcFunctionCallOutput = (call, output) => {
    if (!deps.getOpenaiPtcActive() || !Array.isArray(deps.getOpenaiResponsesAccumulatedInput())) {
      return;
    }
    const callId = String(call?.id || call?.call_id || '').trim();
    if (!callId) return;
    const outItem = {
      type: 'function_call_output',
      call_id: callId,
      output: output == null ? '' : String(output),
    };
    if (call?.caller != null) {
      outItem.caller = call.caller;
    } else {
      const ct = String(call?.caller_type || '').toLowerCase();
      if (ct === 'program' || ct === 'programmatic') {
        console.error(
          '[agent] openai_ptc_missing_caller_on_output',
          JSON.stringify({ call_id: callId, tool: call?.name || null }),
        );
        deps.emit('error', {
          message: 'OpenAI PTC missing caller on function_call_output',
          code: 'openai_ptc_caller_missing',
        });
        throw new Error('openai_ptc_caller_missing');
      }
    }
    deps.getOpenaiResponsesAccumulatedInput().push(outItem);
  };

  const stubMissingToolResults = (calls, results, errorCode, message) => {
    if (!Array.isArray(calls) || !Array.isArray(results)) return 0;
    const have = new Set(
      results
        .map((r) => (r?.tool_use_id != null ? String(r.tool_use_id) : ''))
        .filter(Boolean),
    );
    let filled = 0;
    for (const call of calls) {
      const id = call?.id != null ? String(call.id) : '';
      if (!id || have.has(id)) continue;
      const body = JSON.stringify({
        ok: false,
        error: errorCode,
        tool: call.name || null,
        message:
          message ||
          'Skipped: sibling tool_use closed so the model transcript stays valid.',
      });
      results.push({
        type: 'tool_result',
        tool_use_id: id,
        content: body,
        is_error: true,
      });
      appendOpenaiPtcFunctionCallOutput(call, body);
      have.add(id);
      filled += 1;
    }
    if (filled > 0) {
      console.info(
        '[agent] stubbed_missing_tool_results',
        JSON.stringify({ filled, error: errorCode }),
      );
    }
    return filled;
  };

  const reconcileOpenaiPtcPendingOutputs = (reason) => {
    const acc = deps.getOpenaiResponsesAccumulatedInput();
    if (!deps.getOpenaiPtcActive() || !Array.isArray(acc)) return 0;
    const have = new Set();
    for (const it of acc) {
      if (it?.type === 'function_call_output' && it.call_id) {
        have.add(String(it.call_id));
      }
    }
    let filled = 0;
    for (const it of [...acc]) {
      if (it?.type !== 'function_call') continue;
      const cid = String(it.call_id || '').trim();
      if (!cid || have.has(cid)) continue;
      const stub = {
        type: 'function_call_output',
        call_id: cid,
        output: JSON.stringify({
          ok: false,
          error: 'missing_tool_output_reconciled',
          reason: String(reason || 'unresolved'),
          tool: it.name || null,
        }),
      };
      if (it.caller != null) stub.caller = it.caller;
      acc.push(stub);
      have.add(cid);
      filled += 1;
    }
    if (filled > 0) {
      console.warn(
        '[agent] openai_ptc_reconciled_missing_outputs',
        JSON.stringify({ filled, reason: String(reason || 'unresolved') }),
      );
    }
    return filled;
  };

  const toolDefName = (t) =>
    String(t?.name || t?.tool_key || t?.function?.name || '')
      .trim()
      .toLowerCase();

  const retireOpenWebSearchTools = (reason) => {
    if (deps.getOpenWebSearchRetired() || !Array.isArray(deps.getActiveTools())) return;
    const activeTools = deps.getActiveTools();
    const before = activeTools.length;
    const next = activeTools.filter((t) => toolDefName(t) !== 'search_web');
    if (next.length === 0 && before > 1) {
      deps.setOpenWebSearchRetired(true);
      console.warn(
        '[agent] open_web_search_retire_aborted_empty_menu',
        JSON.stringify({ reason: String(reason || 'budget'), before }),
      );
      return;
    }
    if (next.length === before) {
      deps.setOpenWebSearchRetired(true);
      console.info(
        '[agent] open_web_search_retired',
        JSON.stringify({
          reason: String(reason || 'budget'),
          remaining_tools: before,
          note: 'name_miss_kept_menu',
        }),
      );
      return;
    }
    deps.setActiveTools(next);
    deps.setOpenWebSearchRetired(true);
    console.info(
      '[agent] open_web_search_retired',
      JSON.stringify({ reason: String(reason || 'budget'), remaining_tools: next.length }),
    );
  };

  return {
    appendOpenaiPtcFunctionCallOutput,
    stubMissingToolResults,
    reconcileOpenaiPtcPendingOutputs,
    retireOpenWebSearchTools,
  };
}
