import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildOpenAIResponsesBody } from '../openai.js';
import {
  assertCallerAllowedAtInvoke,
  openAIOutputNeedsContinuation,
  toOpenAIResponsesTools,
} from '../openai-ptc.js';

const readTool = {
  name: 'fs_read_file',
  description: 'Read a file.',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
  output_schema: {
    type: 'object',
    properties: { content: { type: 'string' } },
    required: ['content'],
    additionalProperties: false,
  },
  caller_policy: '["direct","programmatic"]',
  defer_loading: true,
};

describe('OpenAI Responses programmatic tool calling', () => {
  it('builds the GPT-5.6 PTC wire contract fail-closed per tool', () => {
    const capture = {};
    const body = buildOpenAIResponsesBody({
      modelKey: 'gpt-5.6-terra',
      systemPrompt: 'Use tools only when useful.',
      messages: [{ role: 'user', content: 'Inspect the files.' }],
      tools: [
        readTool,
        {
          name: 'fs_write_file',
          input_schema: { type: 'object', properties: {} },
          caller_policy: '["direct"]',
        },
      ],
      openaiPtcEnabled: true,
      openaiApplyPatchEnabled: false,
      openaiResponsesCapture: capture,
      reasoningEffort: 'high',
    }, true);

    assert.equal(body.model, 'gpt-5.6-terra');
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.deepEqual(body.reasoning, { effort: 'high', context: 'all_turns' });
    assert.equal(body.tools.at(-1).type, 'programmatic_tool_calling');

    const read = body.tools.find((tool) => tool.name === 'fs_read_file');
    assert.deepEqual(read.allowed_callers, ['direct', 'programmatic']);
    assert.equal('defer_loading' in read, false);
    assert.deepEqual(read.output_schema, readTool.output_schema);

    const write = body.tools.find((tool) => tool.name === 'fs_write_file');
    assert.deepEqual(write.allowed_callers, ['direct']);
    assert.equal(capture.openaiPtcEnabled, true);
    assert.deepEqual(capture.sentInput, body.input);
  });

  it('replays exact ordered program state without previous_response_id', () => {
    const caller = { type: 'program', caller_id: 'call_program_1' };
    const replay = [
      { role: 'user', content: 'Compare files.' },
      { type: 'program', call_id: 'call_program_1', code: '...', fingerprint: 'opaque' },
      {
        type: 'function_call',
        call_id: 'call_read_1',
        name: 'fs_read_file',
        arguments: '{"path":"a.js"}',
        caller,
      },
      {
        type: 'function_call_output',
        call_id: 'call_read_1',
        output: '{"content":"ok"}',
        caller,
      },
      {
        type: 'program_output',
        call_id: 'call_program_1',
        result: '{"ok":true}',
        status: 'completed',
      },
    ];
    const body = buildOpenAIResponsesBody({
      modelKey: 'gpt-5.6-sol',
      messages: [],
      tools: [readTool],
      openaiPtcEnabled: true,
      openaiResponsesReplayInput: replay,
      openaiPreviousResponseId: 'resp_must_not_be_used',
    }, true);

    assert.equal(body.input, replay);
    assert.equal('previous_response_id' in body, false);
    assert.equal(body.store, false);
  });

  it('does not advertise programmatic callers when PTC is off', () => {
    const tools = toOpenAIResponsesTools([readTool], { openaiPtcEnabled: false });
    assert.deepEqual(tools[0].allowed_callers, ['direct']);
    assert.equal(tools[0].defer_loading, true);
  });

  it('enforces caller policy again at invocation', () => {
    assert.deepEqual(
      assertCallerAllowedAtInvoke('["direct"]', { type: 'program', caller_id: 'p1' }),
      {
        ok: false,
        reason: 'caller_policy_denies_programmatic',
        allowed_callers: ['direct'],
        caller_type: 'programmatic',
      },
    );
    assert.deepEqual(
      assertCallerAllowedAtInvoke('["direct","programmatic"]', { type: 'program' }),
      { ok: true },
    );
  });

  it('continues after program output until an assistant message arrives', () => {
    assert.equal(
      openAIOutputNeedsContinuation([
        { type: 'program_output', call_id: 'p1', status: 'completed', result: '{}' },
      ]),
      true,
    );
    assert.equal(
      openAIOutputNeedsContinuation([
        { type: 'program_output', call_id: 'p1', status: 'completed', result: '{}' },
        { type: 'message', role: 'assistant', content: [] },
      ]),
      false,
    );
  });
});
