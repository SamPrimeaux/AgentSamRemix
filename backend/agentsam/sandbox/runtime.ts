import { getSandbox } from '@cloudflare/sandbox';
import type { Env } from '../../src/env';

function clean(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

export function sandboxIdForScope(input: { userId: string; workspaceId: string }) {
  const raw = `asr-${clean(input.userId)}-${clean(input.workspaceId)}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
}

export async function executeInSandbox(
  env: Env,
  input: {
    userId: string;
    workspaceId: string;
    tenantId?: string | null;
    command: string;
    cwd?: string | null;
  },
) {
  if (!env.MY_CONTAINER) {
    return { ok: false, error: 'sandbox_binding_missing', exitCode: 1, text: 'MY_CONTAINER binding is not configured.', transport: 'sandbox' };
  }
  const sandboxId = sandboxIdForScope(input);
  const sandbox = getSandbox(env.MY_CONTAINER, sandboxId, {
    sleepAfter: '10m',
    labels: {
      app: 'agentsamremix',
      userId: input.userId,
      workspaceId: input.workspaceId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    },
  });
  const cwd = clean(input.cwd) || '/workspace';
  try {
    const result = await sandbox.exec(input.command, {
      cwd,
      timeout: 180_000,
    });
    return {
      ok: result.success,
      error: result.success ? null : 'sandbox_command_failed',
      exitCode: result.exitCode,
      text: [result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? '\n' : '').trim() || '(no output)',
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.duration,
      transport: 'cloudflare_sandbox',
      target: 'sandbox',
      sandboxId,
      cwd,
    };
  } catch (error) {
    return {
      ok: false,
      error: 'sandbox_exec_failed',
      exitCode: 1,
      text: error instanceof Error ? error.message : 'sandbox_exec_failed',
      transport: 'cloudflare_sandbox',
      sandboxId,
    };
  }
}

export function sandboxStatus(env: Env, input: { userId: string; workspaceId: string }) {
  // Deliberately do not ping the container here: a health request wakes a
  // sleeping container and starts billable runtime. Binding presence + the D1
  // connection registry are enough for idle status.
  return {
    ok: Boolean(env.MY_CONTAINER),
    state: env.MY_CONTAINER ? 'sleeping_or_ready' : 'unavailable',
    sandboxId: sandboxIdForScope(input),
    wakesOnFirstExec: true,
  };
}
