import { useCallback, useEffect, useState } from 'react';

export type ComposerTrustTone = 'green' | 'amber' | 'grey' | 'muted';

export type ComposerTrustStatus = {
  tone: ComposerTrustTone;
  line: string;
  detail?: string;
  loading: boolean;
};

type TerminalConfigPayload = {
  terminal_enabled?: boolean;
  terminal_configured?: boolean;
  can_run_pty?: boolean;
  selected_connection_id?: string | null;
  selected_target_type?: string | null;
  error_code?: string | null;
  cwd?: string | null;
};

async function fetchTerminalLane(targetType: string, workspaceId: string | null): Promise<TerminalConfigPayload | null> {
  const q = new URLSearchParams({ target_type: targetType });
  if (workspaceId) q.set('workspace_id', workspaceId);
  const r = await fetch(`/api/agent/terminal/config-status?${q}`, { credentials: 'same-origin' });
  if (!r.ok) return null;
  return (await r.json().catch(() => null)) as TerminalConfigPayload | null;
}

export function useComposerTrustStatus(opts: {
  workspaceId: string | null;
  pendingApprovalCount: number;
  canRunPty?: boolean;
}): ComposerTrustStatus {
  const { workspaceId, pendingApprovalCount, canRunPty = true } = opts;
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [localptyOk, setLocalptyOk] = useState(false);
  const [vmOk, setVmOk] = useState(false);
  const [localConnId, setLocalConnId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const summaryRes = await fetch('/api/integrations/summary', { credentials: 'same-origin' });
      if (summaryRes.ok) {
        const d = (await summaryRes.json()) as { capabilities?: { is_superadmin?: boolean } };
        setIsSuperadmin(!!d.capabilities?.is_superadmin);
      }

      const [localLane, vmLane] = await Promise.all([
        fetchTerminalLane('user_hosted_tunnel', workspaceId),
        fetchTerminalLane('platform_vm', workspaceId),
      ]);

      const localReady =
        !!localLane?.terminal_enabled &&
        !!localLane?.terminal_configured &&
        !localLane?.error_code;
      const vmReady =
        !!vmLane?.terminal_enabled && !!vmLane?.terminal_configured && !vmLane?.error_code;

      setLocalptyOk(localReady);
      setVmOk(vmReady);
      setLocalConnId(
        typeof localLane?.selected_connection_id === 'string'
          ? localLane.selected_connection_id
          : null,
      );
    } catch {
      setLocalptyOk(false);
      setVmOk(false);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  if (pendingApprovalCount > 0) {
    return {
      tone: 'amber',
      line:
        pendingApprovalCount === 1
          ? 'Waiting for approval (1)'
          : `Waiting for approval (${pendingApprovalCount})`,
      detail: 'Confirm in the thread before the next tool runs.',
      loading: false,
    };
  }

  if (loading) {
    return { tone: 'muted', line: 'Checking terminal and integrations…', loading: true };
  }

  if (!canRunPty) {
    return {
      tone: 'grey',
      line: 'Terminal not enabled for this workspace',
      detail: 'Ask an admin to enable PTY in workspace policy.',
      loading: false,
    };
  }

  if (isSuperadmin && vmOk) {
    return {
      tone: 'green',
      line: 'Cloud desk ready · Mac not required',
      detail: 'GCP VM lane for git/shell/wrangler from iPhone or desktop.',
      loading: false,
    };
  }

  if (isSuperadmin && localptyOk) {
    const vmBit = vmOk ? ' · VM lane ready' : '';
    return {
      tone: 'green',
      line: `Platform terminal · localpty connected${vmBit}`,
      detail: localConnId ? `Connection ${localConnId}` : 'Operator workspace lane',
      loading: false,
    };
  }

  if (localptyOk) {
    return {
      tone: 'green',
      line: 'Terminal · local machine connected',
      detail: localConnId ? `Connection ${localConnId}` : undefined,
      loading: false,
    };
  }

  if (vmOk) {
    return {
      tone: 'green',
      line: 'Terminal · platform VM connected',
      loading: false,
    };
  }

  if (isSuperadmin) {
    return {
      tone: 'amber',
      line: 'Platform terminal · checking localpty',
      detail: 'Open Terminal tab if commands fail — no per-customer tunnel required.',
      loading: false,
    };
  }

  return {
    tone: 'grey',
    line: 'Customer workspace · BYOK tunnel may be required',
    detail: 'Connect your tunnel in Settings → Terminal when remote shell is needed.',
    loading: false,
  };
}
