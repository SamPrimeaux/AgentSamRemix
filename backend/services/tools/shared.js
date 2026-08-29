/** Shared catalog executor parsing, workspace wrapping, and ledger helpers. */
import { dualCreatedAtFields } from '../database/d1-time.js';
import {
  assertJournalPayloadUnderCeiling,
  compactPayloadForJournal,
  ensureOutputSummary,
} from '../../telemetry/execution-journal-compact.js';
import {
  sanitizeShellCommandForGcpExec,
} from '../../agentsam/terminal/host-workspace-paths.js';

function parseInput(input) {
  if (input == null) return {};
  if (typeof input === 'object' && !Array.isArray(input)) return { ...input };
  return { value: input };
}

/** Resolve deploy shell command from workspace_settings.settings_json using handler_config.command_source. */
function resolveWorkspaceDeployCommand(settingsJson, commandSource) {
  let parsed = settingsJson;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (_) {
      return '';
    }
  }
  if (!parsed || typeof parsed !== 'object') return '';

  const src = String(commandSource || 'workspace_settings.deploy_command').trim();
  if (src.startsWith('workspace_settings.')) {
    const key = src.slice('workspace_settings.'.length);
    const specific = String(parsed[key] ?? '').trim();
    if (specific) return specific;
  }
  return String(parsed.deploy_command || '').trim();
}

/**
 * Prefix workspace deploy/build commands so PTY and tunnel exec run in the repo root.
 * @param {string|object|null} settingsJson
 * @param {string} command
 * @param {{ gcpExec?: boolean }} [opts]
 */
/**
 * @returns {string | { ok: false, error: string, user_message: string }}
 * Local/deploy wraps still return a string. GCP repository wraps return a typed
 * failure object when the checkout root is missing (never ambient cwd).
 */
export function wrapWorkspaceShellCommand(settingsJson, command, opts = {}) {
  const cmd = String(command || '').trim();
  if (!cmd) return cmd;

  let parsed = settingsJson;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (_) {
      return cmd;
    }
  }
  if (!parsed || typeof parsed !== 'object') return cmd;

  const gcpExec = opts.gcpExec === true;
  if (gcpExec) {
    const root = String(parsed.vm_workspace_root || parsed.repo?.vm_path || '').trim();
    if (!root) {
      return {
        ok: false,
        error: 'remote_checkout_unresolved',
        user_message:
          'No verified GCP checkout root for this workspace. Command was not executed from an ambient cwd.',
      };
    }
    const sanitized = sanitizeShellCommandForGcpExec(cmd, root, {
      settings: parsed,
      rejectUnmapped: false,
      requireRoot: true,
      executionScope: 'repository',
    });
    if (!sanitized.ok) {
      return {
        ok: false,
        error: sanitized.error || 'gcp_checkout_root_required',
        user_message: sanitized.user_message || sanitized.error,
      };
    }
    let next = sanitized.command;
    if (/^\s*cd\s+/i.test(next)) return next;
    if (next.includes(root)) return next;
    return `cd ${root} && ${next}`;
  }

  if (/^\s*cd\s+/i.test(cmd)) {
    return cmd;
  }

  const root = String(parsed.workspace_root || '').trim();
  if (root && cmd.includes(root)) return cmd;

  const cdPrefix = String(parsed.workspace_cd_command || '').trim();
  if (cdPrefix) {
    if (/&&\s*$/.test(cdPrefix)) return `${cdPrefix} ${cmd}`;
    if (cdPrefix.includes('&&')) return `${cdPrefix} && ${cmd}`;
    return `${cdPrefix} && ${cmd}`;
  }
  if (root) return `cd ${root} && ${cmd}`;
  return cmd;
}

function stableSortValue(value) {
  if (Array.isArray(value)) return value.map(stableSortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableSortValue(value[key])]),
    );
  }
  return value;
}

async function sha256Hex(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeJsonString(value, fallback = '{}') {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return fallback;
  }
}

function summarizeOutput(output) {
  const text =
    output?.summary ??
    output?.content?.[0]?.text ??
    output?.text ??
    output?.message ??
    output?.error ??
    safeJsonString(output, '');
  return String(text || '').slice(0, 1000) || null;
}

/** Flatten structured tool errors for receipts — never emit [object Object]. */
export function normalizeCatalogToolErrorMessage(err) {
  if (err == null) return null;
  if (typeof err === 'string') {
    const s = err.trim();
    if (!s || s === '[object Object]') return null;
    return s.slice(0, 8000);
  }
  if (err instanceof Error) {
    const msg = String(err.message || err.name || '').trim();
    return msg ? msg.slice(0, 8000) : 'tool_execution_failed';
  }
  if (typeof err === 'object') {
    const msg =
      err.message ??
      err.error_message ??
      err.user_message ??
      err.detail ??
      (typeof err.error === 'string' ? err.error : null);
    if (typeof msg === 'string' && msg.trim() && msg.trim() !== '[object Object]') {
      return msg.trim().slice(0, 8000);
    }
    if (err.error && typeof err.error === 'object') {
      const nested = err.error.message ?? err.error.code;
      if (typeof nested === 'string' && nested.trim()) return nested.trim().slice(0, 8000);
    }
    const code = err.code ?? err.error_code ?? err.errorCode;
    if (typeof code === 'string' && code.trim()) return code.trim().slice(0, 8000);
    try {
      return JSON.stringify(err).slice(0, 8000);
    } catch {
      return 'tool_execution_failed';
    }
  }
  const s = String(err).trim();
  return s && s !== '[object Object]' ? s.slice(0, 8000) : 'tool_execution_failed';
}

async function writeTelemetryError(env, runContext, source, error) {
  if (!env?.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_error_log
         (workspace_id, tenant_id, session_id, error_type, error_message, source, created_at)
       VALUES (?,?,?,?,?,?,unixepoch())`,
    )
      .bind(
        String(runContext?.workspaceId ?? runContext?.workspace_id ?? 'unknown').trim() || 'unknown',
        String(runContext?.tenantId ?? runContext?.tenant_id ?? 'system').trim() || 'system',
        runContext?.conversationId ?? runContext?.conversation_id ?? runContext?.sessionId ?? runContext?.session_id ?? null,
        'db_write_failure',
        String(error?.message || error || 'telemetry_failed').slice(0, 1000),
        source,
      )
      .run();
  } catch (_) {}
}

function bindingBucket(env, bindingName) {
  const key = String(bindingName || 'DB').trim();
  if (key === 'ASSETS' || key === 'DASHBOARD') return env.ASSETS;
  if (key === 'AI') return env.AI;
  return env[key] ?? env.DB;
}

function parseToolLogJsonCell(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return { text: String(raw).slice(0, 2000) };
  }
}

async function insertToolCallLog(env, payload, runContext = {}) {
      const { recordToolCallLog } = await import('../../../src/core/agentsam-ops-ledger.js');
  const toolKey = String(payload.toolKey ?? payload.toolName ?? '').trim().slice(0, 200);
  if (!toolKey) throw new Error('tool_key_required');
  const tenantId = String(payload.tenantId ?? '').trim();
  if (!tenantId) throw new Error('tenant_id_required');
  const workspaceId = String(payload.workspaceId ?? '').trim();
  if (!workspaceId) throw new Error('workspace_id_required');

  const merged = {
    ...runContext,
    ...payload,
    tenantId,
    workspaceId,
    toolName: toolKey,
    toolKey,
    agent_run_id:
      payload.agentRunId ??
      payload.agent_run_id ??
      runContext.agentRunId ??
      runContext.agent_run_id ??
      null,
    conversation_id:
      payload.conversationId ??
      payload.conversation_id ??
      runContext.conversationId ??
      runContext.conversation_id ??
      null,
    routing_arm_id: payload.routingArmId ?? payload.routing_arm_id ?? runContext.routingArmId ?? null,
    tool_chain_id: payload.toolChainId ?? payload.tool_chain_id ?? runContext.toolChainId ?? null,
    mode: payload.mode ?? runContext.mode ?? runContext.agent_mode ?? null,
    model_key: payload.modelKey ?? payload.model_key ?? runContext.modelKey ?? runContext.model_key ?? null,
    source_client:
      payload.sourceClient ??
      payload.source_client ??
      runContext.sourceClient ??
      runContext.source_client ??
      null,
    costUsd: payload.totalCostUsd ?? payload.costUsd ?? 0,
    durationMs: payload.durationMs ?? 0,
    status: payload.status ?? 'success',
  };

  const id = await recordToolCallLog(env, merged);
  if (!id) throw new Error('tool_call_log_write_failed');
  return id;
}

export { parseInput, resolveWorkspaceDeployCommand, stableSortValue, sha256Hex, safeJsonString, summarizeOutput, writeTelemetryError, insertToolCallLog, bindingBucket };
