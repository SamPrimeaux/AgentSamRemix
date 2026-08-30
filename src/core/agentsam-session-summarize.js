/**
 * Wave 2: R2 messages.jsonl → model catalog summarize → agentsam_memory + memory_oai3large_1536.
 * No staging table. Replaces Edge summarize-thread as the write path.
 */
import { dispatchComplete } from '../../backend/agentsam/runtime/provider-dispatch.js';
import { getChatMessages } from '../../backend/agentsam/sessions/chat-do-client.js';
import { upsertPrivateAgentsamMemory } from '../../backend/http/agentsam/routes/private-memory.js';
import { writeMemoryLane, resolveSupabaseWorkspaceId } from '../../backend/rag/index.js';
import { isHyperdriveUsable, runHyperdriveQuery } from '../../backend/services/database/hyperdrive.js';

export const SESSION_SUMMARY_MODEL = 'gpt-5.6-luna';
export const MIN_MESSAGES_FOR_SESSION_SUMMARY = 8;
export const DEFAULT_MAX_MESSAGES = 60;

const SUMMARY_SYSTEM = `You are Agent Sam session historian. Summarize this chat for long-term memory.
Preserve: decisions, file/paths, migrations, errors+fixes, user constraints, open follow-ups, workspace/project names.
Output plain prose under 900 tokens. No markdown headers. No bullet lists.`;

/**
 * @param {Array<{ role?: string, content?: string }>} messages
 * @param {number} maxMessages
 */
export function formatTranscriptForSummary(messages, maxMessages = DEFAULT_MAX_MESSAGES) {
  const arr = Array.isArray(messages) ? messages : [];
  const sliced = arr.length > maxMessages ? arr.slice(-maxMessages) : arr;
  return sliced
    .map((m) => {
      const role = String(m?.role || 'user').trim() || 'user';
      const content = String(m?.content ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2000);
      return content ? `${role}: ${content}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * @param {any} env
 * @param {string} memoryKey
 * @param {string} workspaceIdD1
 */
async function memorySummaryExists(env, memoryKey, workspaceIdD1) {
  if (!isHyperdriveUsable(env)) return false;
  const workspaceUuid = await resolveSupabaseWorkspaceId(env, workspaceIdD1);
  if (!workspaceUuid) return false;
  const out = await runHyperdriveQuery(
    env,
    `SELECT 1 AS ok FROM agentsam.agentsam_memory_oai3large_1536
      WHERE workspace_id = $1::uuid AND memory_key = $2 LIMIT 1`,
    [workspaceUuid, memoryKey],
  );
  return Boolean(out.ok && (out.rows || []).length);
}

/**
 * Summarize a chat session from R2 (durable SSOT) and write managed + vector memory.
 *
 * @param {any} env
 * @param {{
 *   sessionId: string,
 *   tenantId?: string|null,
 *   workspaceId: string,
 *   userId?: string|null,
 *   maxMessages?: number,
 *   force?: boolean,
 *   ctx?: { waitUntil?: (p: Promise<unknown>) => void },
 * }} opts
 */
export async function summarizeSessionFromR2(env, opts) {
  const sessionId = String(opts?.sessionId || '').trim();
  const workspaceId = String(opts?.workspaceId || '').trim();
  const tenantId = String(opts?.tenantId || '').trim();
  const userId = String(opts?.userId || '').trim() || null;
  const force = opts?.force === true;
  const maxMessages = Math.min(
    120,
    Math.max(8, Number(opts?.maxMessages) || DEFAULT_MAX_MESSAGES),
  );

  if (!sessionId || !workspaceId || !tenantId) {
    return { ok: false, reason: 'missing_session_workspace_or_tenant' };
  }

  const memoryKey = `conversation_summary:${sessionId}`;

  if (!force && (await memorySummaryExists(env, memoryKey, workspaceId))) {
    return { ok: true, skipped: true, reason: 'summary_exists', memory_key: memoryKey };
  }

  let messages = await getChatMessages(env, sessionId);
  if (!Array.isArray(messages) || messages.length < MIN_MESSAGES_FOR_SESSION_SUMMARY) {
    return {
      ok: false,
      reason: 'below_message_threshold',
      message_count: Array.isArray(messages) ? messages.length : 0,
    };
  }

  const transcript = formatTranscriptForSummary(messages, maxMessages);
  if (!transcript) {
    return { ok: false, reason: 'empty_transcript' };
  }

  let summaryText = '';
  try {
    const result = await dispatchComplete(env, {
      modelKey: SESSION_SUMMARY_MODEL,
      systemPrompt: SUMMARY_SYSTEM,
      messages: [{ role: 'user', content: transcript }],
      tools: [],
      userId: userId || undefined,
      options: { reasoningEffort: 'none', verbosity: 'low', maxOutputTokens: 1400 },
    });
    summaryText =
      (typeof result?.text === 'string' && result.text) ||
      result?.choices?.[0]?.message?.content ||
      result?.output_text ||
      '';
    summaryText = String(summaryText).trim();
  } catch (e) {
    console.warn('[summarize-session] model', sessionId, e?.message ?? e);
    summaryText = transcript.slice(0, 2800);
  }

  if (!summaryText) {
    return { ok: false, reason: 'empty_summary' };
  }

  const title = `Session summary ${sessionId.slice(0, 12)}`;
  const managed = await upsertPrivateAgentsamMemory(env, {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    user_id: userId || `system:${workspaceId}`,
    memory_type: 'decision',
    memory_key: memoryKey,
    title,
    content: summaryText,
    summary: summaryText.slice(0, 480),
    source: 'conversation_summary',
    external_ref: sessionId,
    tags: ['conversation_summary', 'wave2'],
    importance: 0.7,
    value_json: {
      source_type: 'conversation_summary',
      session_id: sessionId,
      message_count: messages.length,
      model: SESSION_SUMMARY_MODEL,
    },
  });

  let lane = { ok: false };
  try {
    lane = await writeMemoryLane(env, {
      workspace_id: workspaceId,
      memory_key: memoryKey,
      content: summaryText,
      title,
      source: 'conversation_summary',
      source_type: 'conversation_summary',
      user_id: userId,
      metadata: {
        session_id: sessionId,
        message_count: messages.length,
        managed_memory_id: managed?.id ?? null,
      },
    });
  } catch (e) {
    console.warn('[summarize-session] memory_lane', sessionId, e?.message ?? e);
    lane = { ok: false, error: String(e?.message || e) };
  }

  return {
    ok: Boolean(managed?.ok || lane?.ok),
    memory_key: memoryKey,
    managed,
    lane,
    message_count: messages.length,
    summary_chars: summaryText.length,
  };
}

/**
 * Fire-and-forget after compaction / session close (never throws).
 * @param {any} env
 * @param {{
 *   sessionId: string,
 *   messageCount?: number,
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   userId?: string|null,
 *   ctx?: { waitUntil?: (p: Promise<unknown>) => void },
 * }} opts
 */
export async function maybeSummarizeSessionAfterCompaction(env, opts) {
  const sessionId = String(opts?.sessionId || '').trim();
  const workspaceId = String(opts?.workspaceId || '').trim();
  const messageCount = Number(opts?.messageCount) || 0;
  if (!sessionId || !workspaceId) {
    return { invoked: false, reason: 'missing_ids' };
  }
  if (messageCount > 0 && messageCount < MIN_MESSAGES_FOR_SESSION_SUMMARY) {
    return { invoked: false, reason: 'below_message_threshold' };
  }

  const run = () =>
    summarizeSessionFromR2(env, {
      sessionId,
      workspaceId,
      tenantId: opts.tenantId,
      userId: opts.userId,
      force: false,
    }).catch((e) => {
      console.warn('[summarize-session] compaction', sessionId, e?.message ?? e);
      return { ok: false, reason: 'error', error: String(e?.message || e) };
    });

  if (opts?.ctx?.waitUntil) {
    opts.ctx.waitUntil(run());
    return { invoked: true, deferred: true };
  }
  const result = await run();
  return { invoked: true, ok: result?.ok !== false, result };
}
