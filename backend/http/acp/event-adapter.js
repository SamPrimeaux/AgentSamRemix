/**
 * Map IAM chat SSE event types → ACP session/update payloads (protocol-neutral adapter).
 * Does not invent ACP methods — only sessionUpdate discriminators from ACP v1.
 */

/**
 * @param {string} type
 * @param {Record<string, unknown>} payload
 * @param {string} sessionId — ACP sessionId (= conversation_id)
 * @returns {Record<string, unknown>|null} params for session/update notification, or null to skip
 */
export function chatEventToAcpSessionUpdate(type, payload, sessionId) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const base = { sessionId };

  switch (type) {
    case 'text':
    case 'token':
    case 'delta':
    case 'content': {
      const text = String(p.text ?? p.content ?? p.delta ?? '').slice(0, 8000);
      if (!text) return null;
      return {
        ...base,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text },
        },
      };
    }
    case 'thinking':
    case 'thinking_start': {
      const text = String(p.text ?? p.content ?? p.message ?? '').slice(0, 4000);
      if (!text && type === 'thinking_start') {
        return {
          ...base,
          update: {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: '' },
          },
        };
      }
      if (!text) return null;
      return {
        ...base,
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text },
        },
      };
    }
    case 'tool_call':
    case 'tool_start': {
      const name = String(p.tool ?? p.name ?? p.tool_name ?? 'tool').slice(0, 200);
      const toolCallId = String(p.tool_call_id ?? p.id ?? p.call_id ?? crypto.randomUUID()).slice(
        0,
        120,
      );
      return {
        ...base,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId,
          title: name,
          kind: 'other',
          status: 'pending',
          rawInput: p.args ?? p.tool_args ?? p.input ?? {},
        },
      };
    }
    case 'tool_result':
    case 'tool_done': {
      const toolCallId = String(p.tool_call_id ?? p.id ?? p.call_id ?? '').slice(0, 120);
      if (!toolCallId) return null;
      return {
        ...base,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId,
          status: p.is_error || p.error ? 'failed' : 'completed',
          content: [
            {
              type: 'content',
              content: {
                type: 'text',
                text: String(p.content ?? p.result ?? p.output ?? '').slice(0, 8000),
              },
            },
          ],
        },
      };
    }
    case 'approval_required':
    case 'tool_approval_request': {
      const toolCallId = String(
        p.approval_id ?? p.proposal_id ?? p.tool?.approval_id ?? crypto.randomUUID(),
      ).slice(0, 120);
      const title = String(
        p.tool_name ?? p.tool?.name ?? p.action_summary ?? 'approval_required',
      ).slice(0, 200);
      return {
        ...base,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId,
          title,
          kind: 'other',
          status: 'pending',
          rawInput: {
            iam_approval: true,
            proposal_id: p.proposal_id ?? p.approval_id ?? null,
            tool_args: p.tool_args ?? p.tool?.parameters ?? {},
          },
        },
      };
    }
    case 'status': {
      const phase = p.phase != null ? String(p.phase) : '';
      if (!phase) return null;
      return {
        ...base,
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: `[status:${phase}]` },
        },
      };
    }
    case 'error': {
      const msg = String(p.message ?? p.error ?? 'error').slice(0, 2000);
      return {
        ...base,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `Error: ${msg}` },
        },
      };
    }
    case 'done':
      return null;
    default:
      return null;
  }
}
