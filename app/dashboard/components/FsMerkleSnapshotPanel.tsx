/**
 * Minimal Snapshot data panel for AgentSamFilesystem (Swarm B data hook).
 * Swarm A owns mode tabs; this component only renders inside the Snapshot slot.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  listFsMerkleSnapshots,
  canUseFsMerkleSnapshot,
} from '../src/lib/fsMerkleSnapshot';
import { persistLocalFsMerkleSnapshot, walkLocalDirectoryHandle } from '../src/lib/fsMerkleLocal';

export type FsMerkleSnapshotPanelProps = {
  workspaceId?: string | null;
  source: string;
  repository?: string | null;
  /** Connected FSA root handle when source=local. */
  localDirectoryHandle?: FileSystemDirectoryHandle | null;
};

type SnapshotRow = {
  snapshot_id: string;
  root_hash: string;
  source: string;
  leaf_hash_domain: string;
  resolved_commit_sha: string | null;
  reference_label: string | null;
  created_at: number;
};

export const FsMerkleSnapshotPanel: React.FC<FsMerkleSnapshotPanelProps> = ({
  workspaceId,
  source,
  repository,
  localDirectoryHandle = null,
}) => {
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRoot, setLastRoot] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [compareSummary, setCompareSummary] = useState<string | null>(null);

  const usable = canUseFsMerkleSnapshot({
    source,
    repository,
    hasLocalDirectoryHandle: Boolean(localDirectoryHandle),
  });

  const refresh = useCallback(async () => {
    const wid = workspaceId?.trim();
    if (!wid) return;
    try {
      const list = await listFsMerkleSnapshots({ workspaceId: wid, limit: 20 });
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'list_failed');
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const buildGithub = useCallback(async () => {
    const wid = workspaceId?.trim();
    const repo = repository?.trim();
    if (!wid || !repo) {
      setError('repository_and_workspace_required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/merkle/build', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-IAM-Workspace-Id': wid,
        },
        body: JSON.stringify({
          source: 'github',
          workspace_id: wid,
          repository: repo,
          reference: 'HEAD',
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        root_hash?: string;
        snapshot_id?: string;
      };
      if (!res.ok || !body.ok) throw new Error(body.error || `build_failed:${res.status}`);
      setLastRoot(body.root_hash || null);
      setCurrentId(body.snapshot_id || null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'build_failed');
    } finally {
      setBusy(false);
    }
  }, [workspaceId, repository, refresh]);

  const buildLocal = useCallback(async () => {
    const wid = workspaceId?.trim();
    if (!wid || !localDirectoryHandle) {
      setError('local_directory_handle_required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (typeof crypto?.subtle?.digest !== 'function') {
        throw new Error('local_merkle_webcrypto_unavailable');
      }
      // Prove SHA-1 (git blob) works in this browser — no silent stub hash domain.
      try {
        await crypto.subtle.digest('SHA-1', new Uint8Array([0]));
      } catch {
        throw new Error('local_merkle_sha1_unavailable');
      }
      const walked = await walkLocalDirectoryHandle(localDirectoryHandle, {
        hashMode: 'git_blob_sha1',
      });
      if (!walked.entries.length) {
        throw new Error('local_merkle_empty_tree');
      }
      const saved = await persistLocalFsMerkleSnapshot({
        workspaceId: wid,
        reference: localDirectoryHandle.name || 'local',
        entries: walked.entries,
        leafHashDomain: 'git_blob_sha1',
      });
      setLastRoot(saved.root_hash);
      setCurrentId(saved.snapshot_id);
      if (walked.truncated) {
        setError(`truncated_at_${walked.fileCount}_files`);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'local_build_failed');
    } finally {
      setBusy(false);
    }
  }, [workspaceId, localDirectoryHandle, refresh]);

  const runCompare = useCallback(async () => {
    const wid = workspaceId?.trim();
    if (!wid || !currentId || !baselineId) {
      setError('select_current_and_baseline');
      return;
    }
    setBusy(true);
    setError(null);
    setCompareSummary(null);
    try {
      const res = await fetch('/api/agent/merkle/compare', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-IAM-Workspace-Id': wid,
        },
        body: JSON.stringify({
          workspace_id: wid,
          current_snapshot_id: currentId,
          baseline_snapshot_id: baselineId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        base_domain?: string;
        head_domain?: string;
        comparison?: { equal?: boolean; changedPaths?: unknown[]; currentRoot?: string; baselineRoot?: string };
      };
      if (body.error === 'merkle_incompatible_hash_domain') {
        setCompareSummary(
          `Refused: merkle_incompatible_hash_domain (base=${body.base_domain}, head=${body.head_domain})`,
        );
        return;
      }
      if (!res.ok || !body.ok || !body.comparison) {
        throw new Error(body.error || `compare_failed:${res.status}`);
      }
      const n = body.comparison.changedPaths?.length ?? 0;
      setCompareSummary(
        body.comparison.equal
          ? `Equal roots ${body.comparison.currentRoot}`
          : `${n} changed path(s); current ${body.comparison.currentRoot?.slice(0, 12)}… vs baseline ${body.comparison.baselineRoot?.slice(0, 12)}…`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'compare_failed');
    } finally {
      setBusy(false);
    }
  }, [workspaceId, currentId, baselineId]);

  if (!usable) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 text-center">
        <p className="text-[11px] text-muted max-w-[240px]">
          Snapshot needs a GitHub repo (github/react) or a connected local folder (FSA).
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col px-2 py-2 gap-2 text-[10px] font-mono overflow-auto">
      <div className="flex flex-wrap gap-1">
        {source === 'github' && (
          <button
            type="button"
            disabled={busy || !repository}
            onClick={() => void buildGithub()}
            className="px-2 py-1 rounded border border-[var(--solar-cyan)]/40 text-[var(--solar-cyan)] disabled:opacity-40"
          >
            Build GitHub tip
          </button>
        )}
        {source === 'local' && (
          <button
            type="button"
            disabled={busy || !localDirectoryHandle}
            onClick={() => void buildLocal()}
            className="px-2 py-1 rounded border border-[var(--solar-cyan)]/40 text-[var(--solar-cyan)] disabled:opacity-40"
          >
            Build local Snapshot
          </button>
        )}
        <button
          type="button"
          disabled={busy || !currentId || !baselineId}
          onClick={() => void runCompare()}
          className="px-2 py-1 rounded border border-[var(--border-subtle)] text-main disabled:opacity-40"
        >
          Compare
        </button>
      </div>
      {lastRoot ? (
        <p className="text-muted break-all">
          root_hash <span className="text-main">{lastRoot}</span>
        </p>
      ) : null}
      {compareSummary ? <p className="text-main">{compareSummary}</p> : null}
      {error ? <p className="text-red-400 break-all">{error}</p> : null}
      <div className="flex flex-col gap-1">
        <p className="text-muted uppercase tracking-wide">Snapshots</p>
        {rows.length === 0 ? (
          <p className="text-muted">No persisted snapshots yet.</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.snapshot_id}
              className="rounded border border-[var(--border-subtle)]/40 px-2 py-1 flex flex-col gap-0.5"
            >
              <span className="text-main truncate">{row.root_hash}</span>
              <span className="text-muted">
                {row.source} · {row.leaf_hash_domain}
                {row.resolved_commit_sha ? ` · ${row.resolved_commit_sha.slice(0, 12)}` : ''}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-[var(--solar-cyan)]"
                  onClick={() => setCurrentId(row.snapshot_id)}
                >
                  {currentId === row.snapshot_id ? 'current ✓' : 'set current'}
                </button>
                <button
                  type="button"
                  className="text-[var(--solar-cyan)]"
                  onClick={() => setBaselineId(row.snapshot_id)}
                >
                  {baselineId === row.snapshot_id ? 'baseline ✓' : 'set baseline'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
