/**
 * Chat Veo turn: poll job status until local playable URL (or Stream watch) is ready.
 * Default destination is local; optional Save to Hosted Videos via Stream from-url.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CloudUpload, Download, ExternalLink, Loader2 } from 'lucide-react';
import { copyStreamFromUrl } from './videos/videosApi';
import type { VideoGenerationState } from './ChatAssistant/types';
import { StreamPlayerEmbed, streamCustomerCodeFromHost } from './videos/StreamPlayerEmbed';

export type AgentVideoGenerationCardProps = {
  state: VideoGenerationState;
  workspaceId?: string | null;
  onStatePatch?: (patch: Partial<VideoGenerationState>) => void;
};

function titleFromPrompt(prompt?: string): string {
  const raw = String(prompt || '')
    .replace(/^generate a video of\s*/i, '')
    .replace(/^create a video of\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return 'Generated video';
  const words = raw.split(' ').slice(0, 8).join(' ');
  return words.length > 56 ? `${words.slice(0, 53)}…` : words;
}

function customerHostFromHls(hls?: string | null): string | null {
  const u = String(hls || '').trim();
  if (!u) return null;
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
}

async function fetchVeoJob(jobId: string, workspaceId?: string | null) {
  const qs = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  const r = await fetch(`/api/moviemode/veo-jobs/${encodeURIComponent(jobId)}${qs}`, {
    credentials: 'same-origin',
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false as const, error: d.error || `HTTP ${r.status}` };
  return { ok: true as const, job: d.job as Record<string, unknown> };
}

export function AgentVideoGenerationCard({
  state,
  workspaceId,
  onStatePatch,
}: AgentVideoGenerationCardProps) {
  const [busySave, setBusySave] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [local, setLocal] = useState(state);

  useEffect(() => {
    setLocal(state);
  }, [state]);

  const patch = useCallback(
    (p: Partial<VideoGenerationState>) => {
      setLocal((prev) => ({ ...prev, ...p }));
      onStatePatch?.(p);
    },
    [onStatePatch],
  );

  useEffect(() => {
    const jobId = local.jobId;
    if (!jobId) return;
    if (local.phase === 'completed' || local.phase === 'failed') return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const res = await fetchVeoJob(jobId, workspaceId);
      if (cancelled) return;
      if (!res.ok) {
        patch({
          phase: 'failed',
          failed: true,
          message: res.error || 'Status check failed',
          progress: 100,
        });
        return;
      }
      const job = res.job || {};
      const status = String(job.status || '').toLowerCase();
      const playable =
        (typeof job.playable_url === 'string' && job.playable_url) ||
        (typeof job.watch_url === 'string' && job.watch_url) ||
        (typeof job.public_url === 'string' && job.public_url) ||
        '';
      const streamUid = typeof job.stream_uid === 'string' ? job.stream_uid : local.streamUid;

      if (status === 'failed') {
        patch({
          phase: 'failed',
          failed: true,
          message:
            typeof job.error === 'string'
              ? job.error
              : job.error
                ? JSON.stringify(job.error).slice(0, 200)
                : 'Video generation failed',
          progress: 100,
          playableUrl: playable || undefined,
          streamUid: streamUid || undefined,
        });
        return;
      }

      if (status === 'done' && playable) {
        patch({
          phase: 'completed',
          failed: false,
          progress: 100,
          message: streamUid ? 'Saved to Hosted Videos' : 'Video ready',
          playableUrl: playable,
          publicUrl: typeof job.public_url === 'string' ? job.public_url : playable,
          streamUid: streamUid || undefined,
          watchUrl: typeof job.watch_url === 'string' ? job.watch_url : undefined,
          hls: typeof job.hls === 'string' ? job.hls : undefined,
          destination:
            String(job.destination || local.destination || 'local') === 'stream'
              ? 'stream'
              : 'local',
          status: streamUid ? 'saved' : 'draft',
          artifactId: typeof job.artifact_id === 'string' ? job.artifact_id : undefined,
          assetId: typeof job.asset_id === 'string' ? job.asset_id : undefined,
        });
        return;
      }

      patch({
        phase: status === 'running' ? 'generating' : 'queued',
        progress: status === 'running' ? 55 : 20,
        message: status === 'running' ? 'Rendering video…' : 'Queued…',
        destination:
          String(job.destination || local.destination || 'local') === 'stream'
            ? 'stream'
            : 'local',
      });
      timer = setTimeout(tick, 8000);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [local.jobId, local.phase, local.destination, local.streamUid, workspaceId, patch]);

  const title = useMemo(() => titleFromPrompt(local.prompt), [local.prompt]);
  const playable = local.playableUrl || local.watchUrl || local.publicUrl;
  const isComplete = local.phase === 'completed' && Boolean(playable);
  const isFailed = local.phase === 'failed';
  const isDraft = isComplete && (local.status === 'draft' || !local.streamUid);
  const customerHost = customerHostFromHls(local.hls);
  const customerCode = streamCustomerCodeFromHost(customerHost);

  const onSaveToStream = useCallback(async () => {
    const url = local.publicUrl || local.playableUrl;
    if (!url) {
      setActionMsg('No local video URL to save');
      return;
    }
    setBusySave(true);
    setActionMsg(null);
    try {
      const out = await copyStreamFromUrl({ url, name: title });
      if (!out.ok || !out.video?.uid) {
        setActionMsg(out.error || 'Save to Hosted Videos failed');
        return;
      }
      const uid = out.video.uid;
      patch({
        streamUid: uid,
        watchUrl: out.video.watch_url || undefined,
        playableUrl: out.video.watch_url || out.video.hls || url,
        hls: out.video.hls || undefined,
        status: 'saved',
        destination: 'stream',
        message: 'Saved to Hosted Videos',
      });
      setActionMsg('Saved to Hosted Videos');
    } catch (e: unknown) {
      setActionMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusySave(false);
    }
  }, [local.publicUrl, local.playableUrl, title, patch]);

  return (
    <div
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden max-w-xl"
      data-veo-job={local.jobId || undefined}
    >
      <div className="px-3 py-2 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)]">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate text-[var(--text-main)]">{title}</div>
          <div className="text-[11px] text-[var(--text-muted)] truncate">
            Agent / Videos / {isDraft ? 'Local' : 'Hosted'} /{' '}
            {String(local.jobId || '').slice(0, 14) || 'job'}
          </div>
        </div>
        {!isComplete && !isFailed ? (
          <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)] shrink-0" aria-hidden />
        ) : null}
      </div>

      <div className="p-3 space-y-3">
        {isFailed ? (
          <div className="text-sm text-red-400">{local.message || 'Generation failed'}</div>
        ) : null}

        {!isComplete && !isFailed ? (
          <div className="text-sm text-[var(--text-muted)]">
            {local.message || 'Generating video…'} ({Math.round(local.progress || 0)}%)
          </div>
        ) : null}

        {isComplete && playable ? (
          local.streamUid && customerCode ? (
            <StreamPlayerEmbed
              src={local.streamUid}
              customerSubdomain={customerHost}
              title={title}
              className="w-full aspect-video rounded-lg overflow-hidden bg-black"
            />
          ) : (
            <video
              src={playable}
              controls
              playsInline
              className="w-full max-h-[360px] rounded-lg bg-black"
            />
          )
        ) : null}

        {isComplete ? (
          <div className="flex flex-wrap gap-2">
            {playable ? (
              <a
                href={playable}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open
              </a>
            ) : null}
            {local.publicUrl ? (
              <a
                href={local.publicUrl}
                download
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </a>
            ) : null}
            {isDraft ? (
              <button
                type="button"
                disabled={busySave}
                onClick={() => void onSaveToStream()}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                <CloudUpload className="w-3.5 h-3.5" />
                {busySave ? 'Saving…' : 'Save to Hosted Videos'}
              </button>
            ) : null}
          </div>
        ) : null}

        {actionMsg ? <div className="text-[11px] text-[var(--text-muted)]">{actionMsg}</div> : null}
      </div>
    </div>
  );
}
