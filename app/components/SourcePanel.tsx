import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Github,
  GitBranch,
  GitCommit,
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCcw,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { SetiFileIcon } from '../src/components/SetiFileIcon';
import { useWorkspace } from '../src/context/WorkspaceContext';
import { bootstrapSupabaseFromSession, getSupabaseClient } from '../src/lib/supabase';

interface GitStatus {
  status: 'live' | 'cached' | 'no_repo' | 'no_workspace';
  branch: string | null;
  repo_full_name: string | null;
  workspace_id: string | null;
  staged?: Array<{ path: string; status: string }>;
  unstaged?: Array<{ path: string; status: string }>;
  commits?: Array<{ hash: string; author: string; date: string; msg: string }>;
}

/** Mirrors src/core/realtime-broadcast.js topicSafe() — keep in sync. */
function topicSafe(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, '-');
}

function looksLikeShellError(value: string | null | undefined): boolean {
  const s = String(value || '').trim();
  if (!s) return false;
  return /fatal:|cannot change to|no such file or directory/i.test(s);
}

/** Safety-net only — the Realtime broadcast in src/api/webhooks/github.js is the
 * primary update path. This covers missed broadcasts (channel drop, webhook not
 * configured for a repo, etc), so it stays long and visibility-gated rather than
 * disappearing entirely. */
const FALLBACK_POLL_MS = 300_000;

export const SourcePanel: React.FC = () => {
  const { workspaceId } = useWorkspace();
  const [data, setData] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const ws = workspaceId?.trim();
      const url = ws
        ? `/api/agent/git/status?workspace_id=${encodeURIComponent(ws)}`
        : '/api/agent/git/status';
      const res = await fetch(url, { credentials: 'same-origin' });
      const json = (await res.json().catch(() => ({}))) as Partial<GitStatus> & { error?: string };
      if (!res.ok) {
        throw new Error(json.error || 'Failed to fetch git status');
      }

      const status =
        json.status === 'live' ||
        json.status === 'cached' ||
        json.status === 'no_repo' ||
        json.status === 'no_workspace'
          ? json.status
          : json.branch == null && !json.repo_full_name
            ? 'no_workspace'
            : 'cached';

      const branch = looksLikeShellError(json.branch) ? null : (json.branch ?? null);

      setData({
        status,
        branch,
        repo_full_name: json.repo_full_name ?? null,
        workspace_id: json.workspace_id ?? ws ?? null,
        staged: Array.isArray(json.staged) ? json.staged : [],
        unstaged: Array.isArray(json.unstaged) ? json.unstaged : [],
        commits: Array.isArray(json.commits) ? json.commits : [],
      });
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch git status');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const fetchStatusRef = useRef(fetchStatus);
  fetchStatusRef.current = fetchStatus;

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const onWs = () => void fetchStatus();
    window.addEventListener('iam_workspace_id', onWs);
    return () => window.removeEventListener('iam_workspace_id', onWs);
  }, [fetchStatus]);

  // Push path: subscribe once we know which repo this workspace points at.
  // Server side, src/api/webhooks/github.js broadcasts on the same topic
  // whenever GitHub delivers a push event for that repo.
  const repoFullName = data?.repo_full_name ?? null;
  useEffect(() => {
    if (!repoFullName) return;

    let cancelled = false;
    let removeChannel: (() => void) | null = null;

    void (async () => {
      const client = getSupabaseClient() ?? (await bootstrapSupabaseFromSession());
      if (cancelled || !client) return;

      const topic = `git-status:${topicSafe(repoFullName)}`;
      const channel = client
        .channel(topic)
        .on('broadcast', { event: 'push' }, () => {
          void fetchStatusRef.current();
        });

      channel.subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[SourcePanel] realtime channel error', topic);
        }
      });

      removeChannel = () => {
        void client.removeChannel(channel);
      };
    })();

    return () => {
      cancelled = true;
      removeChannel?.();
    };
  }, [repoFullName]);

  // Fallback poll — long interval, paused while tab is hidden. Catches
  // anything the broadcast missed rather than being the primary path.
  useEffect(() => {
    let timer: number | null = null;

    const tick = () => void fetchStatusRef.current();

    const start = () => {
      if (timer != null) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      timer = window.setInterval(tick, FALLBACK_POLL_MS);
    };
    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    start();
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center text-muted">
        <AlertCircle size={48} className="mb-4 opacity-20" />
        <p className="text-sm mb-4">{error}</p>
        <button
          type="button"
          onClick={() => void fetchStatus()}
          className="px-4 py-2 bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-lg hover:bg-[var(--bg-app)] transition-colors text-xs"
        >
          Try Again
        </button>
      </div>
    );
  }

  const branchLabel =
    data?.status === 'no_repo'
      ? 'No repo linked'
      : data?.status === 'no_workspace'
        ? 'No workspace'
        : data?.branch || 'HEAD';

  const staged = data?.staged ?? [];
  const unstaged = data?.unstaged ?? [];
  const commits = data?.commits ?? [];

  return (
    <div className="flex flex-col h-full bg-[var(--bg-app)] text-main overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]/50">
        <div className="flex items-center gap-2">
          <Github size={18} className="text-muted" />
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Source Control</h2>
        </div>
        <button
          type="button"
          onClick={() => void fetchStatus()}
          disabled={loading}
          className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-muted transition-colors"
          title="Refresh git status"
        >
          <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-0">
        <div className="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]/30 group cursor-pointer hover:bg-[var(--bg-panel)]/30">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-1.5 rounded bg-[var(--solar-cyan)]/10 text-[var(--solar-cyan)] shrink-0">
              <GitBranch size={14} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-muted uppercase tracking-tighter">Current Branch</div>
              <div className="text-[13px] font-bold truncate" style={{ fontFamily: 'var(--font-mono)' }}>
                {branchLabel}
              </div>
            </div>
          </div>
          {data?.repo_full_name ? (
            <span className="text-[10px] text-muted opacity-50 truncate max-w-[40%] ml-2">
              {data.repo_full_name}
            </span>
          ) : null}
          <ArrowRight size={14} className="text-muted opacity-0 group-hover:opacity-100 transition-all shrink-0" />
        </div>

        {data?.status === 'no_repo' ? (
          <div className="px-4 py-6 text-center text-[11px] text-muted border-b border-[var(--border-subtle)]/30">
            Link a GitHub repo on this workspace in Settings to enable live branch tracking and history.
          </div>
        ) : null}

        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={12} className="text-[var(--solar-cyan)]" />
            <h3 className="text-[11px] font-bold text-muted uppercase">Changes</h3>
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-panel)] text-muted">
              {staged.length + unstaged.length}
            </span>
          </div>
          <div className="space-y-1">
            {staged.map((f, i) => (
              <FileItem key={`staged-${i}`} path={f.path} status={f.status} isStaged />
            ))}
            {unstaged.map((f, i) => (
              <FileItem key={`unstaged-${i}`} path={f.path} status={f.status} />
            ))}
            {staged.length === 0 && unstaged.length === 0 && (
              <div className="py-8 text-center border-2 border-dashed border-[var(--border-subtle)]/30 rounded-xl">
                <CheckCircle2 size={24} className="mx-auto mb-2 text-[var(--solar-green)] opacity-20" />
                <p className="text-[11px] text-muted">
                  {data?.status === 'no_repo' ? 'No local working tree — GitHub API only' : 'Working directory clean'}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 pt-0">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={12} className="text-muted" />
            <h3 className="text-[11px] font-bold text-muted uppercase">Recent History</h3>
          </div>
          <div className="bg-[var(--bg-panel)]/30 rounded-xl border border-[var(--border-subtle)]/30 overflow-hidden divide-y divide-[var(--border-subtle)]/20">
            {commits.length === 0 && (
              <div className="p-4 text-center text-[11px] text-muted opacity-50">
                {data?.status === 'no_repo' ? 'Link a GitHub repo to see history' : 'No commits found'}
              </div>
            )}
            {commits.map((c, i) => (
              <div key={i} className="p-3 hover:bg-[var(--bg-panel)]/50 transition-colors cursor-pointer group">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-[var(--solar-cyan)]" style={{ fontFamily: 'var(--font-mono)' }}>
                    {c.hash}
                  </span>
                  <span className="text-[10px] text-muted opacity-60">{c.date}</span>
                </div>
                <div className="text-[12px] font-medium text-main line-clamp-1 group-hover:text-[var(--solar-cyan)] transition-colors">
                  {c.msg}
                </div>
                <div className="text-[10px] text-muted mt-1 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] opacity-30" />
                  {c.author}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-panel)]/50">
        <div className="flex flex-col gap-2">
          <input
            type="text"
            placeholder="Post-reversion commit message..."
            className="w-full bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-[var(--solar-cyan)] outline-none"
          />
          <button
            type="button"
            className="w-full py-2 bg-[var(--solar-cyan)]/10 hover:bg-[var(--solar-cyan)]/20 text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/30 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
          >
            <GitCommit size={14} />
            Commit Changes
          </button>
        </div>
      </div>
    </div>
  );
};

const FileItem: React.FC<{ path: string; status: string; isStaged?: boolean }> = ({ path, status, isStaged }) => {
  const parts = path.split('/');
  const name = parts.pop();
  const dir = parts.join('/');

  const getStatusColor = () => {
    if (status.includes('M')) return 'text-[#dab98f]';
    if (status.includes('A') || status.includes('?')) return 'text-[var(--solar-green)]';
    if (status.includes('D')) return 'text-[var(--solar-red)]';
    return 'text-muted';
  };

  return (
    <div className="flex items-center gap-3 p-2 hover:bg-[var(--bg-panel)]/50 rounded-lg transition-colors cursor-pointer group">
      <div
        className={`text-[10px] w-4 text-center font-bold ${getStatusColor()}`}
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {status.includes('?') ? 'U' : status[0]}
      </div>
      <div className="p-1 px-1.5 rounded bg-[var(--bg-app)] text-muted border border-[var(--border-subtle)] group-hover:border-[var(--solar-cyan)]/30 transition-colors">
        <SetiFileIcon filename={name} size={13} />
      </div>
      <div className="min-w-0">
        <div
          className="text-[12px] font-medium text-main truncate"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {name}
        </div>
        {dir ? (
          <div
            className="text-[9px] text-muted truncate opacity-50"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {dir}
          </div>
        ) : null}
      </div>
      {isStaged ? (
        <div className="ml-auto flex items-center gap-1 text-[9px] text-[var(--solar-cyan)] opacity-60">
          <Sparkles size={8} />
          STAGED
        </div>
      ) : null}
    </div>
  );
};
