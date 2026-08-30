import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAgentToolLoopPtcHelpers } from '../ptc.js';

function helpers() {
  const state = {
    active: true,
    input: [],
    tools: [],
    retired: false,
    events: [],
  };
  const api = createAgentToolLoopPtcHelpers({
    emit(type, payload) {
      state.events.push({ type, payload });
    },
    getOpenaiPtcActive: () => state.active,
    getOpenaiResponsesAccumulatedInput: () => state.input,
    getActiveTools: () => state.tools,
    setActiveTools: (tools) => { state.tools = tools; },
    getOpenWebSearchRetired: () => state.retired,
    setOpenWebSearchRetired: (value) => { state.retired = value; },
  });
  return { state, api };
}

describe('Agent tool loop PTC replay', () => {
  it('copies call_id and caller verbatim onto function output', () => {
    const { state, api } = helpers();
    const caller = { type: 'program', caller_id: 'call_program_1' };
    api.appendOpenaiPtcFunctionCallOutput(
      { call_id: 'call_tool_1', name: 'fs_read_file', caller },
      '{"content":"ok"}',
    );
    assert.deepEqual(state.input, [{
      type: 'function_call_output',
      call_id: 'call_tool_1',
      output: '{"content":"ok"}',
      caller,
    }]);
  });

  it('fails loudly when a program-issued call loses caller linkage', () => {
    const { state, api } = helpers();
    assert.throws(
      () => api.appendOpenaiPtcFunctionCallOutput({
        call_id: 'call_tool_1',
        name: 'fs_read_file',
        caller_type: 'programmatic',
      }, '{}'),
      /openai_ptc_caller_missing/,
    );
    assert.equal(state.events.at(-1).payload.code, 'openai_ptc_caller_missing');
  });
});
