/**
 * Sandbox file browser — Cloudflare Container is billable from the first fetch()
 * that wakes a sleeping instance. Do not probe /health or /tree on mount.
 * Connect is an explicit click; agentsam_terminal_sandbox remains the agent I/O path.
 */
import React, { useCallback, useState } from 'react';
import { ChevronRight, Folder, Loader2, RefreshCw } from 'lucide-react';
import { SetiFileIcon } from '../src/components/SetiFileIcon';

type SandboxEntry = {
  name: string;
  dir: boolean;
  path: string;
};

type TreeResponse = {
  ok?: boolean;
  error?: string;
  root?: string;
  path?: string;
  entries?: { name: string; dir?: boolean; path: string }[];
};

export const ContainerExplorer: React.FC<{ embedded?: boolean }> = ({ embedded = true }) => {
  const [relPath, setRelPath] = useState('');
  const [rootLabel, setRootLabel] = useState('/mnt/workspace');
  const [entries, setEntries] = useState<SandboxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [connected, setConnected] = useState(false);

  const loadTree = useCallback(async (path: string) => {
    setLoading(true);
    setErr(null);
    try {
      const qs = path.trim() ? `?path=${encodeURIComponent(path.trim())}` : '';
      const r = await fetch(`/api/sandbox/v1/workspace/tree${qs}`, { credentials: 'same-origin' });
      const data = (await r.json().catch(() => ({}))) as TreeResponse;
      if (!r.ok || data.ok === false) {
        throw new Error(data.error || r.statusText || 'Sandbox tree unavailable');
      }
      if (typeof data.root === 'string' && data.root.trim()) setRootLabel(data.root.trim());
      setRelPath(typeof data.path === 'string' ? data.path : path);
      setEntries(
        (data.entries || []).map((e) => ({
          name: e.name,
          dir: e.dir === true,
          path: e.path,
        })),
      );
      setReady(true);
    } catch (e) {
      setErr(String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const connect = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/sandbox/health', { credentials: 'same-origin' });
      const d = r.ok ? ((await r.json().catch(() => null)) as { ok?: boolean } | null) : null;
      const ok = d?.ok === true;
      setReady(ok);
      if (ok) {
        setConnected(true);
        await loadTree('');
      } else {
        setConnected(false);
        setErr('Sandbox container is not ready. Use the Sandbox terminal lane or agentsam_terminal_sandbox when you need it.');
      }
    } catch (e) {
      setReady(false);
      setConnected(false);
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [loadTree]);

  const parentPath = (() => {
    const p = relPath.replace(/\/+$/, '');
    if (!p) return '';
    const i = p.lastIndexOf('/');
    return i <= 0 ? '' : p.slice(0, i);
  })();

  if (!connected) {
    return (
      <div
        className={`flex flex-col min-h-0 overflow-hidden ${embedded ? 'h-full bg-transparent' : ''}`}
      >
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-4">
          <p className="text-[10px] text-muted leading-relaxed mb-3">
            Opening this panel is free. Browsing sandbox files starts the Cloudflare container and
            bills memory until it sleeps (~2 min idle). Agents still use{' '}
            <code className="font-mono text-[var(--solar-cyan)]">agentsam_terminal_sandbox</code>{' '}
            when they actually need I/O.
          </p>
          {err ? (
            <p className="text-[10px] text-[var(--solar-orange)] font-mono mb-3">{err}</p>
          ) : null}
          <button
            type="button"
            disabled={loading}
            onClick={() => void connect()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-[var(--solar-cyan)] border border-[var(--solar-cyan)]/40 bg-[var(--solar-cyan)]/10 hover:bg-[var(--solar-cyan)]/15 disabled:opacity-40"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : null}
            {loading ? 'Starting sandbox…' : 'Connect to sandbox'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col min-h-0 overflow-hidden ${embedded ? 'h-full bg-transparent' : ''}`}
    >
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border-subtle)]/30">
        {relPath ? (
          <button
            type="button"
            className="text-[10px] text-[var(--solar-cyan)] hover:underline px-1"
            onClick={() => void loadTree(parentPath)}
          >
            Up
          </button>
        ) : null}
        <span className="text-[10px] text-muted truncate flex-1 font-mono" title={`${rootLabel}/${relPath}`}>
          {relPath ? `${rootLabel}/${relPath}` : rootLabel}
        </span>
        <button
          type="button"
          title="Refresh"
          className="p-1 rounded hover:bg-[var(--bg-hover)] text-muted"
          onClick={() => void loadTree(relPath)}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {ready === false ? (
        <p className="px-3 py-4 text-[10px] text-[var(--solar-orange)] leading-relaxed">
          Sandbox container is not ready. Check status bar or run a command in the CF sandbox terminal lane.
        </p>
      ) : null}

      {err ? (
        <p className="px-3 py-2 text-[10px] text-[var(--solar-orange)] font-mono">{err}</p>
      ) : null}

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-1 py-1 font-mono text-[11px]">
        {loading && entries.length === 0 ? (
          <div className="flex items-center gap-1.5 px-2 py-2 text-muted">
            <Loader2 size={12} className="animate-spin" /> Loading sandbox tree…
          </div>
        ) : null}

        {entries.map((e) => (
          <button
            key={e.path || e.name}
            type="button"
            className="flex items-center gap-1.5 w-full px-2 py-1 hover:bg-[var(--bg-hover)] rounded text-left"
            onClick={() => {
              if (e.dir) void loadTree(e.path);
            }}
            disabled={!e.dir}
            title={e.dir ? `Open ${e.name}` : e.name}
          >
            {e.dir ? (
              <>
                <Folder size={13} className="text-[var(--solar-blue)] shrink-0" />
                <span className="truncate flex-1">{e.name}</span>
                <ChevronRight size={11} className="text-muted shrink-0" />
              </>
            ) : (
              <>
                <SetiFileIcon filename={e.name} size={13} />
                <span className="truncate flex-1 text-muted">{e.name}</span>
              </>
            )}
          </button>
        ))}

        {!loading && !err && entries.length === 0 && ready !== false ? (
          <p className="text-[10px] italic text-muted px-2 py-2">Empty directory.</p>
        ) : null}
      </div>
    </div>
  );
};

export default ContainerExplorer;
