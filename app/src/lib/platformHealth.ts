import { isEpochStale, normalizeEpochMs, parseHealthCheckEpochMs } from './normalizeEpochMs';

export type PlatformHealthIssue = {
  id: string;
  severity: 'error' | 'warn';
  label: string;
  fixHref?: string;
  fixLabel?: string;
};

type ConnectedIntegrationItem = {
  derived_status?: string;
  connection?: {
    provider_key?: string;
    status?: string;
    config_json?: Record<string, unknown>;
    last_health_check_at?: string | null;
    last_health_status?: string | null;
  };
  integration_status?: { connected?: boolean; last_verified_at?: number };
};

/** True when local_tunnel is connected but verification/health is stale (>5 min). */
export function localTunnelVerificationStale(items: ConnectedIntegrationItem[]): boolean {
  const lt = items.find(
    (i) => String(i?.connection?.provider_key || '').toLowerCase() === 'local_tunnel',
  );
  const tunnelConnected =
    String(lt?.derived_status || '').toLowerCase() === 'connected' ||
    lt?.integration_status?.connected === true;
  if (!lt || !tunnelConnected) return false;

  const cfgTs =
    typeof lt?.integration_status?.last_verified_at === 'number'
      ? normalizeEpochMs(lt.integration_status.last_verified_at)
      : typeof lt?.connection?.config_json?.last_verified_at === 'number'
        ? normalizeEpochMs(lt.connection.config_json.last_verified_at as number)
        : null;
  const healthTs = parseHealthCheckEpochMs(lt?.connection?.last_health_check_at);
  const verifiedMs =
    cfgTs != null && healthTs != null ? Math.max(cfgTs, healthTs) : cfgTs ?? healthTs;

  const healthOk =
    String(lt?.connection?.last_health_status || '').toLowerCase() === 'ok' &&
    healthTs != null &&
    !isEpochStale(healthTs);

  return !healthOk && isEpochStale(verifiedMs);
}

export function buildPlatformHealthIssues(opts: {
  healthOk: boolean | null;
  tunnelHealthy: boolean | null;
  tunnelStale: boolean;
  terminalOk: boolean | null;
  sandboxOk?: boolean | null;
  workspaceDrift?: boolean;
}): PlatformHealthIssue[] {
  const issues: PlatformHealthIssue[] = [];
  if (opts.workspaceDrift) {
    issues.push({
      id: 'workspace-drift',
      severity: 'warn',
      label: 'Workspace out of sync',
      fixHref: '/dashboard/settings/workspace',
      fixLabel: 'Workspace',
    });
  }
  if (opts.healthOk === false) {
    issues.push({
      id: 'worker',
      severity: 'error',
      label: 'Worker health failed',
      fixHref: '/dashboard/analytics',
      fixLabel: 'Open analytics',
    });
  }
  if (opts.tunnelStale) {
    issues.push({
      id: 'tunnel-stale',
      severity: 'warn',
      label: 'Local tunnel — re-verify',
      fixHref: '/dashboard/settings/integrations',
      fixLabel: 'Integrations',
    });
  } else if (opts.tunnelHealthy === false) {
    issues.push({
      id: 'tunnel-down',
      severity: 'warn',
      label: 'Tunnel unavailable',
      fixHref: '/dashboard/settings/integrations',
      fixLabel: 'Connect',
    });
  }
  if (opts.terminalOk === false) {
    issues.push({
      id: 'pty',
      severity: 'warn',
      label: 'PTY terminal not ready',
      fixHref: '/dashboard/settings/network',
      fixLabel: 'Network',
    });
  }
  if (opts.sandboxOk === false) {
    issues.push({
      id: 'sandbox',
      severity: 'warn',
      label: 'CF sandbox not ready',
      fixHref: '/dashboard/agent/editor',
      fixLabel: 'Agent editor',
    });
  }
  return issues;
}

export function platformHealthSummary(
  issues: PlatformHealthIssue[],
  healthOk: boolean | null,
): { tone: 'ok' | 'warn' | 'error'; label: string } {
  if (issues.length > 0) {
    const top = issues[0];
    return { tone: top.severity === 'error' ? 'error' : 'warn', label: top.label };
  }
  if (healthOk === true) return { tone: 'ok', label: 'Healthy' };
  if (healthOk === false) return { tone: 'error', label: 'Degraded' };
  return { tone: 'warn', label: 'Checking…' };
}
