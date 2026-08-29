import React, { useState } from 'react';
import type { EditSession, ExportJob } from '../src/types/moviemode';
import { useWorkspace } from '../src/context/WorkspaceContext';
import { EXEC_LANE_LABELS, tryReadDockExecLane } from '../src/lib/execLane';

type Codec = 'h264' | 'vp9' | 'gif';
type Quality = '480p' | '720p' | '1080p';

type ExportConfig = {
  codec: Codec;
  quality: Quality;
  fps: 24 | 30 | 60;
};

type Props = {
  session: EditSession;
  projectId?: string | null;
  onExportComplete?: (r2Key: string) => void;
  onSaveToDrive?: (r2Key: string) => void;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-2 text-[11px]">
      <span className="block text-muted font-semibold mb-1">{label}</span>
      {children}
    </label>
  );
}

export const ExportPanel: React.FC<Props> = ({
  session,
  projectId = null,
  onExportComplete,
  onSaveToDrive,
}) => {
  const { workspaceId } = useWorkspace();
  const [config, setConfig] = useState<ExportConfig>({ codec: 'h264', quality: '720p', fps: 30 });
  const [job, setJob] = useState<ExportJob | null>(null);
  const [laneError, setLaneError] = useState<string | null>(null);
  const dockLane = tryReadDockExecLane(workspaceId);

  const startExport = async () => {
    setLaneError(null);
    if (!workspaceId) {
      setLaneError('No active workspace');
      return;
    }
    const execLane = tryReadDockExecLane(workspaceId);
    if (!execLane) {
      setLaneError('Pick Local, VM, or Sandbox in the terminal dock before export');
      return;
    }
    const res = await fetch('/api/moviemode/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        session,
        config,
        exec_lane: execLane,
        project_id: projectId || undefined,
      }),
    });
    const data = (await res.json()) as { jobId?: string; error?: string; message?: string };
    if (!data.jobId) {
      setLaneError(data.message || data.error || 'Export failed to start');
      return;
    }
    setJob({ jobId: data.jobId, status: 'queued', progressPercent: 0, renderLane: execLane });
    pollJob(data.jobId);
  };

  const pollJob = (jobId: string) => {
    const iv = window.setInterval(async () => {
      const res = await fetch(`/api/moviemode/export-status/${jobId}`, { credentials: 'include' });
      const data = (await res.json()) as ExportJob;
      setJob(data);
      if (data.status === 'done') {
        window.clearInterval(iv);
        if (data.r2Key) onExportComplete?.(data.r2Key);
      }
      if (data.status === 'error') window.clearInterval(iv);
    }, 1500);
  };

  return (
    <div className="p-2 text-main">
      <h3 className="text-[13px] font-bold mb-2">Export</h3>
      {!job && (
        <>
          <p className="text-[11px] text-muted mb-2">
            Host:{' '}
            {dockLane ? EXEC_LANE_LABELS[dockLane] : 'none — pick Local, VM, or Sandbox in the dock'}
          </p>
          <Field label="Format">
            <select
              className="w-full rounded border border-[var(--dashboard-border)] bg-[var(--bg-input)] px-2 py-1 text-xs"
              value={config.codec}
              onChange={(e) => setConfig({ ...config, codec: e.target.value as Codec })}
            >
              <option value="h264">MP4 (H.264)</option>
              <option value="vp9">WebM (VP9)</option>
              <option value="gif">GIF</option>
            </select>
          </Field>
          <Field label="Quality">
            <select
              className="w-full rounded border border-[var(--dashboard-border)] bg-[var(--bg-input)] px-2 py-1 text-xs"
              value={config.quality}
              onChange={(e) => setConfig({ ...config, quality: e.target.value as Quality })}
            >
              <option value="480p">480p</option>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </Field>
          <Field label="FPS">
            <select
              className="w-full rounded border border-[var(--dashboard-border)] bg-[var(--bg-input)] px-2 py-1 text-xs"
              value={config.fps}
              onChange={(e) => setConfig({ ...config, fps: +e.target.value as ExportConfig['fps'] })}
            >
              <option value={24}>24</option>
              <option value={30}>30</option>
              <option value={60}>60</option>
            </select>
          </Field>
          {laneError ? <p className="text-[11px] text-red-400 mb-2">{laneError}</p> : null}
          <button
            type="button"
            className="mt-2 w-full rounded bg-[var(--solar-cyan)] text-black text-xs font-bold py-2 disabled:opacity-40"
            disabled={!dockLane}
            onClick={() => void startExport()}
          >
            Export via Remotion
          </button>
        </>
      )}
      {job && job.status !== 'done' && job.status !== 'error' && (
        <div className="text-[11px] space-y-1">
          <span className="uppercase opacity-70">{job.status}…</span>
          {job.renderLane ? (
            <span className="block opacity-50">
              {EXEC_LANE_LABELS[job.renderLane as keyof typeof EXEC_LANE_LABELS] || job.renderLane}
            </span>
          ) : null}
          <progress className="w-full" value={job.progressPercent} max={100} />
          <span className="opacity-50">{job.progressPercent}%</span>
        </div>
      )}
      {job?.status === 'done' && job.r2Key && (
        <div className="text-[11px] space-y-1">
          <span className="text-green-400">✓ Exported</span>
          <code className="block text-[9px] break-all opacity-70">{job.r2Key}</code>
          <a
            className="text-[var(--solar-cyan)] underline block"
            href={`/api/r2/serve/${encodeURIComponent(job.r2Key)}`}
            target="_blank"
            rel="noreferrer"
          >
            Download
          </a>
          {onSaveToDrive ? (
            <button
              type="button"
              className="text-[10px] text-main underline"
              onClick={() => onSaveToDrive(job.r2Key!)}
            >
              Save to Google Drive
            </button>
          ) : null}
          <button type="button" className="block text-xs mt-1" onClick={() => setJob(null)}>
            Export again
          </button>
        </div>
      )}
      {job?.status === 'error' && (
        <div className="text-[11px] text-red-400">
          <p>{job.errorMessage || 'Export failed'}</p>
          <button type="button" className="mt-1 text-xs" onClick={() => setJob(null)}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
};
