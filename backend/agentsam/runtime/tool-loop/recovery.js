/**
 * Text-only end-of-model-turn recovers (hosted shell empty, empty end_turn, repeat halt).
 * Returns { action: 'continue' | 'break' }. Mutates conversation / assistant content via bag.
 */

import { isEmptyHostedShellAction } from '../../../../src/core/openai-hosted-shell.js';

/**
 * @param {{
 *   emit: Function,
 *   conversationMessages: unknown[],
 *   turnHostedShellEvents: unknown[],
 *   assistantContent: unknown[],
 *   turnCount: number,
 *   maxTurns: number,
 *   modelKey: string|null|undefined,
 *   chatAgentRunId: unknown,
 *   forceTextOnlyAfterRepeatHalt: boolean,
 *   emptyEndTurnRecoverUsed: boolean,
 *   consecutiveEmptyHostedShellRecovers: number,
 *   EMPTY_HOSTED_SHELL_RECOVER_CAP: number,
 * }} L
 * @returns {{
 *   action: 'continue'|'break',
 *   forceTextOnlyAfterRepeatHalt: boolean,
 *   emptyEndTurnRecoverUsed: boolean,
 *   consecutiveEmptyHostedShellRecovers: number,
 *   banditPenalty: null|{ reason: 'empty_end_turn_recover'|'empty_end_turn_synthesize' },
 * }}
 */
export function processTextOnlyModelTurn(L) {
  const {
    emit,
    conversationMessages,
    turnHostedShellEvents,
    assistantContent,
    turnCount,
    maxTurns,
    modelKey,
    chatAgentRunId,
  } = L;
  let { forceTextOnlyAfterRepeatHalt, emptyEndTurnRecoverUsed, consecutiveEmptyHostedShellRecovers } =
    L;
  const EMPTY_HOSTED_SHELL_RECOVER_CAP = L.EMPTY_HOSTED_SHELL_RECOVER_CAP;
  /** @type {null|{ reason: 'empty_end_turn_recover'|'empty_end_turn_synthesize' }} */
  let banditPenalty = null;

  const emptyShellCalls = turnHostedShellEvents.filter(
    (e) => e?.type === 'shell_call' && (e.empty === true || isEmptyHostedShellAction(e.action)),
  );
  const workspaceShellCalls = turnHostedShellEvents.filter(
    (e) => e?.type === 'shell_call' && e.workspace_targeted === true,
  );
  const assistantPlain = assistantContent
    .filter((b) => b?.type === 'text')
    .map((b) => String(b.text || ''))
    .join('')
    .trim();

  const synthesizeHostedShellHalt = (reason) => {
    const msg =
      'Hosted shell returned nothing useful (empty commands[] or out-of-scope paths) after repeated tries — ' +
      'that is a non-success, not a finished task. I am stopping further hosted-shell retries this turn. ' +
      'For repo / .scratch work use workspace fs_* or agentsam_terminal_*; hosted shell is only for /mnt/data with real commands.';
    console.warn(
      '[agent] openai_hosted_shell_recover_halt',
      JSON.stringify({
        reason,
        consecutive_empty: consecutiveEmptyHostedShellRecovers,
        had_assistant_text: Boolean(assistantPlain),
        turn: turnCount,
        agent_run_id: chatAgentRunId != null ? String(chatAgentRunId) : null,
      }),
    );
    emit('status', {
      phase: 'recover_halt',
      message: 'Empty hosted shell cap — synthesizing a visible reply',
    });
    const caveat = assistantPlain ? `\n\n⚠️ ${msg}` : msg;
    emit('text', { text: caveat });
    assistantContent.push({ type: 'text', text: caveat });
    consecutiveEmptyHostedShellRecovers = 0;
  };

  if (emptyShellCalls.length) {
    consecutiveEmptyHostedShellRecovers += 1;
    const atCap =
      consecutiveEmptyHostedShellRecovers >= EMPTY_HOSTED_SHELL_RECOVER_CAP || turnCount >= maxTurns;
    if (atCap) {
      synthesizeHostedShellHalt(
        consecutiveEmptyHostedShellRecovers >= EMPTY_HOSTED_SHELL_RECOVER_CAP
          ? 'empty_recover_cap'
          : 'empty_recover_last_turn',
      );
      // Halt already wrote visible text — do not fall through into empty_end_turn
      // (assistantPlain was snapshotted before the halt and would still look empty).
      return {
        action: 'break',
        forceTextOnlyAfterRepeatHalt,
        emptyEndTurnRecoverUsed,
        consecutiveEmptyHostedShellRecovers,
        banditPenalty,
      };
    } else {
      console.warn(
        '[agent] openai_hosted_shell_empty_recover',
        JSON.stringify({
          empty_count: emptyShellCalls.length,
          consecutive: consecutiveEmptyHostedShellRecovers,
          cap: EMPTY_HOSTED_SHELL_RECOVER_CAP,
          had_assistant_text: Boolean(assistantPlain),
          turn: turnCount,
          agent_run_id: chatAgentRunId != null ? String(chatAgentRunId) : null,
        }),
      );
      emit('status', {
        phase: 'recover',
        message: 'Empty hosted shell — continuing the agent turn',
      });
      conversationMessages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'SYSTEM: The previous OpenAI hosted shell call had empty commands[] and is a durable non-success. ' +
              'Do NOT call hosted shell again with empty commands. Do not invent shell output. ' +
              'Continue with a different tool already on your menu (fs_write_file / fs_read_file / agentsam_terminal_local for workspace work), ' +
              'or reply briefly explaining you need a real /mnt/data command. You must produce either a tool call or visible text.',
          },
        ],
      });
      return {
        action: 'continue',
        forceTextOnlyAfterRepeatHalt,
        emptyEndTurnRecoverUsed,
        consecutiveEmptyHostedShellRecovers,
        banditPenalty,
      };
    }
  } else if (workspaceShellCalls.length && turnCount < maxTurns) {
    consecutiveEmptyHostedShellRecovers += 1;
    if (consecutiveEmptyHostedShellRecovers >= EMPTY_HOSTED_SHELL_RECOVER_CAP) {
      synthesizeHostedShellHalt('workspace_scope_cap');
      return {
        action: 'break',
        forceTextOnlyAfterRepeatHalt,
        emptyEndTurnRecoverUsed,
        consecutiveEmptyHostedShellRecovers,
        banditPenalty,
      };
    } else {
      console.warn(
        '[agent] openai_hosted_shell_workspace_scope_recover',
        JSON.stringify({
          count: workspaceShellCalls.length,
          turn: turnCount,
          agent_run_id: chatAgentRunId != null ? String(chatAgentRunId) : null,
        }),
      );
      emit('status', {
        phase: 'recover',
        message: 'Hosted shell workspace scope violation — use workspace tools',
      });
      conversationMessages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'SYSTEM: OpenAI hosted shell targeted workspace/repo paths and is out of scope. ' +
              'Do NOT retry hosted shell for those paths. Continue with workspace fs_* / agentsam_terminal_* tools, or reply with a short status.',
          },
        ],
      });
      return {
        action: 'continue',
        forceTextOnlyAfterRepeatHalt,
        emptyEndTurnRecoverUsed,
        consecutiveEmptyHostedShellRecovers,
        banditPenalty,
      };
    }
  } else {
    consecutiveEmptyHostedShellRecovers = 0;
  }

  if (forceTextOnlyAfterRepeatHalt && !assistantPlain) {
    const msg =
      'I hit a tool safety or budget limit while exploring and did not produce a written answer this turn. ' +
      'Prior tool results are still in the thread — ask me to continue from a specific symbol or hop, or narrow the question.';
    console.warn(
      '[agent] repeat_halt_empty_reply_synthesized',
      JSON.stringify({
        turn: turnCount,
        agent_run_id: chatAgentRunId != null ? String(chatAgentRunId) : null,
      }),
    );
    emit('status', {
      phase: 'recover_halt',
      message: 'Repeat-tool halt — synthesizing a visible reply',
    });
    emit('text', { text: msg });
    assistantContent.push({ type: 'text', text: msg });
    const lastAsst = conversationMessages[conversationMessages.length - 1];
    if (lastAsst?.role === 'assistant' && Array.isArray(lastAsst.content)) {
      lastAsst.content = assistantContent;
    }
    forceTextOnlyAfterRepeatHalt = false;
  }

  if (!assistantPlain && !forceTextOnlyAfterRepeatHalt) {
    if (!emptyEndTurnRecoverUsed && turnCount < maxTurns) {
      emptyEndTurnRecoverUsed = true;
      banditPenalty = { reason: 'empty_end_turn_recover' };
      console.warn(
        '[agent] empty_end_turn_recover',
        JSON.stringify({
          turn: turnCount,
          model_key: modelKey,
          agent_run_id: chatAgentRunId != null ? String(chatAgentRunId) : null,
        }),
      );
      emit('status', {
        phase: 'recover',
        message: 'Empty model turn — requesting a visible text reply',
      });
      conversationMessages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'SYSTEM: Your previous turn produced no user-visible text and no tool calls ' +
              '(thinking-only or empty end_turn). Reply now with the answer in plain text or markdown. ' +
              'Do not call tools unless strictly required. Produce visible content.',
          },
        ],
      });
      return {
        action: 'continue',
        forceTextOnlyAfterRepeatHalt,
        emptyEndTurnRecoverUsed,
        consecutiveEmptyHostedShellRecovers,
        banditPenalty,
      };
    }
    const msg =
      'I finished a model turn without producing a visible answer (often adaptive thinking exhausted the output budget). ' +
      'Please send the request again, or switch to Ask mode for a simple text reply.';
    banditPenalty = { reason: 'empty_end_turn_synthesize' };
    console.warn(
      '[agent] empty_end_turn_synthesize',
      JSON.stringify({
        turn: turnCount,
        model_key: modelKey,
        agent_run_id: chatAgentRunId != null ? String(chatAgentRunId) : null,
      }),
    );
    emit('status', {
      phase: 'recover_halt',
      message: 'Empty model end_turn — synthesizing a visible reply',
    });
    emit('text', { text: msg });
    assistantContent.push({ type: 'text', text: msg });
    const lastAsst = conversationMessages[conversationMessages.length - 1];
    if (lastAsst?.role === 'assistant' && Array.isArray(lastAsst.content)) {
      lastAsst.content = assistantContent;
    }
  }

  return {
    action: 'break',
    forceTextOnlyAfterRepeatHalt,
    emptyEndTurnRecoverUsed,
    consecutiveEmptyHostedShellRecovers,
    banditPenalty,
  };
}
