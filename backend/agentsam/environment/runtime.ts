import type { Env } from '../../src/env';
import { callExecOS } from '../terminal/execos';

export type EnvironmentScope = {
  userId: string;
  workspaceId: string;
  tenantId?: string | null;
};

type EnvironmentBinding = {
  environmentId: string;
  expiresAt?: string | null;
};

function cacheKey(scope: EnvironmentScope) {
  return `asr:gcp-environment:${scope.userId}:${scope.workspaceId}`;
}

async function readBinding(env: Env, scope: EnvironmentScope): Promise<EnvironmentBinding | null> {
  const raw = await env.SESSION_CACHE?.get(cacheKey(scope)).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EnvironmentBinding;
    return parsed?.environmentId ? parsed : null;
  } catch {
    return null;
  }
}

async function writeBinding(env: Env, scope: EnvironmentScope, binding: EnvironmentBinding, ttlMinutes = 60) {
  const ttl = Math.max(600, Math.min(ttlMinutes * 60 + 900, 24 * 60 * 60));
  await env.SESSION_CACHE.put(cacheKey(scope), JSON.stringify(binding), { expirationTtl: ttl });
}

async function clearBinding(env: Env, scope: EnvironmentScope) {
  await env.SESSION_CACHE?.delete(cacheKey(scope)).catch(() => undefined);
}

function publicEnvironment(data: any) {
  if (!data) return null;
  return {
    environmentId: data.environment_id || null,
    state: data.state || null,
    zone: data.zone || null,
    machineType: data.machine_type || null,
    createdAt: data.created_at || null,
    expiresAt: data.expires_at || null,
    active: Boolean(data.environment_id && data.state !== 'deleted' && data.state !== 'deleting'),
  };
}

export async function environmentStatus(env: Env, scope: EnvironmentScope) {
  const binding = await readBinding(env, scope);
  if (!binding) {
    return { ok: true, active: false, state: 'not_started', environmentId: null };
  }

  const result = await callExecOS(env, `/environments/${encodeURIComponent(binding.environmentId)}`, {
    method: 'GET',
    timeoutMs: 15_000,
  });
  if (result.status === 404 || result.data?.error === 'environment_not_found') {
    await clearBinding(env, scope);
    return { ok: true, active: false, state: 'not_started', environmentId: null };
  }
  if (!result.ok) {
    return {
      ok: false,
      active: true,
      state: 'unknown',
      environmentId: binding.environmentId,
      error: result.data?.error || 'environment_status_failed',
    };
  }
  return { ok: true, ...publicEnvironment(result.data) };
}

export async function ensureEnvironment(env: Env, scope: EnvironmentScope, ttlMinutes = 60) {
  const current = await environmentStatus(env, scope);
  if (current.ok && current.active && current.environmentId) return current;

  const ttl = Math.max(10, Math.min(Number(ttlMinutes) || 60, 360));
  const result = await callExecOS(env, '/environments', {
    method: 'POST',
    timeoutMs: 30_000,
    body: {
      user_id: scope.userId,
      workspace_id: scope.workspaceId,
      tenant_id: scope.tenantId || undefined,
      ttl_minutes: ttl,
    },
  });
  const id = String(result.data?.environment_id || '').trim();
  if (!result.ok || !id) {
    return {
      ok: false,
      active: false,
      state: 'create_failed',
      error: result.data?.error || 'environment_create_failed',
      detail: result.data?.detail,
    };
  }
  await writeBinding(env, scope, { environmentId: id, expiresAt: result.data?.expires_at || null }, ttl);
  return { ok: true, active: true, ...publicEnvironment(result.data) };
}

export async function executeInEnvironment(
  env: Env,
  input: EnvironmentScope & { command: string; cwd?: string | null; ttlMinutes?: number },
) {
  const environment: any = await ensureEnvironment(env, input, input.ttlMinutes || 60);
  if (!environment.ok || !environment.environmentId) {
    return {
      ok: false,
      error: environment.error || 'environment_unavailable',
      exitCode: 1,
      text: environment.detail || environment.error || 'Environment unavailable.',
      transport: 'gcp_environment',
      target: 'environment',
    };
  }

  const result = await callExecOS(env, `/environments/${encodeURIComponent(environment.environmentId)}/run`, {
    method: 'POST',
    timeoutMs: 310_000,
    body: {
      command: input.command,
      cwd: input.cwd || '/workspace',
      timeout_ms: 180_000,
    },
  });
  const data = result.data || {};
  const exitCode = Number.isFinite(Number(data.exit_code)) ? Number(data.exit_code) : result.ok ? 0 : 1;
  const stdout = typeof data.stdout === 'string' ? data.stdout : '';
  const stderr = typeof data.stderr === 'string' ? data.stderr : '';
  const text = [stdout, stderr].filter(Boolean).join(stdout && stderr ? '\n' : '').trim()
    || data.detail
    || data.error
    || (result.ok ? '(no output)' : 'Environment command failed.');

  return {
    ok: result.ok && exitCode === 0,
    error: result.ok && exitCode === 0 ? null : data.error || `environment_${result.status}`,
    exitCode,
    text,
    stdout,
    stderr,
    transport: 'gcp_environment',
    target: 'environment',
    environmentId: environment.environmentId,
    environment: publicEnvironment(data.environment) || environment,
    cwd: data.cwd || input.cwd || '/workspace',
    latencyMs: data.latency_ms ?? null,
  };
}

export async function destroyEnvironment(env: Env, scope: EnvironmentScope) {
  const binding = await readBinding(env, scope);
  if (!binding) return { ok: true, deleted: false, state: 'not_started', environmentId: null };
  const result = await callExecOS(env, `/environments/${encodeURIComponent(binding.environmentId)}`, {
    method: 'DELETE',
    timeoutMs: 30_000,
  });
  if (result.ok || result.status === 404) await clearBinding(env, scope);
  return {
    ok: result.ok || result.status === 404,
    deleted: Boolean(result.data?.deleted),
    state: result.data?.state || (result.status === 404 ? 'deleted' : 'delete_failed'),
    environmentId: binding.environmentId,
    error: result.ok || result.status === 404 ? null : result.data?.error || 'environment_delete_failed',
  };
}
