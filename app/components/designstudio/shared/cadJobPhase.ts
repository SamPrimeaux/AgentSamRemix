import type { CadJobRow } from '../api';
import type { ModePresenceIconKey } from '../../../features/mode-presence/agentModePresenceMap';

export type InlineJobStatus = 'creating' | 'uploading' | 'complete' | 'failed' | 'idle';

export type CadJobPhase = {
  iconKey: ModePresenceIconKey;
  label: string;
  detail: string;
  progress: number;
  status: InlineJobStatus;
  /** Shimmer bar instead of a frozen percent (Meshy GLB polish at ~92%). */
  indeterminate?: boolean;
};

function parseTextureData(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
  } catch {
    return {};
  }
}

const PHASE_SOFT: Record<string, number> = {
  pending: 5,
  queued: 5,
  accepted: 12,
  running: 45,
};

/** Map CAD/Meshy job row → branded inline progress phase. */
export function resolveCadJobPhase(job: CadJobRow | null | undefined): CadJobPhase | null {
  if (!job) return null;

  const status = String(job.status || '').toLowerCase();
  const pctRaw = Number(job.progress_pct);
  const pct = Number.isFinite(pctRaw)
    ? Math.max(0, Math.min(100, Math.round(pctRaw)))
    : PHASE_SOFT[status] ?? 12;
  const engine = String(job.engine || '').toLowerCase();
  const td = parseTextureData(job.texture_data);
  const err = String(job.error || '').trim();

  if (status === 'failed') {
    return {
      iconKey: 'error-signal',
      label: 'Generation stopped',
      detail: err || 'Job failed before completing',
      progress: pct,
      status: 'failed',
    };
  }
  if (status === 'stub') {
    return {
      iconKey: 'error-signal',
      label: 'Meshy not configured',
      detail: err || 'Add API key in Settings → Keys',
      progress: pct,
      status: 'failed',
    };
  }
  if (status === 'done' || status === 'complete') {
    return {
      iconKey: 'done-bloom',
      label: 'Model ready',
      detail: 'Open full studio to view or edit',
      progress: 100,
      status: 'complete',
    };
  }

  if (!['pending', 'running', 'queued', 'accepted'].includes(status)) {
    return null;
  }

  if (engine === 'meshy') {
    if (td.glb_optimize_pending === true) {
      return {
        iconKey: 'skeleton-plan',
        label: 'Meshy polish stage',
        detail: 'Typically 1–3 minutes — compressing GLB for the viewport',
        progress: pct,
        status: 'uploading',
        indeterminate: true,
      };
    }
    if (pct >= 88 || (job.r2_key && !String(job.r2_key).startsWith('b64:'))) {
      return {
        iconKey: 'files',
        label: 'Finalizing model',
        detail: 'Preparing GLB for the viewport',
        progress: pct,
        status: 'uploading',
      };
    }
    if (job.parent_task_id || td.phase === 'refine') {
      return {
        iconKey: 'pixel',
        label: 'Applying textures',
        detail: 'Refining surface and materials',
        progress: pct,
        status: 'creating',
      };
    }
    if (String(job.task_type || '').includes('image')) {
      return {
        iconKey: 'scan',
        label: 'Creating your model',
        detail: 'Building mesh from image',
        progress: pct,
        status: 'creating',
      };
    }
    if (pct < 15) {
      return {
        iconKey: 'agent-spark',
        label: 'Creating your model',
        detail: 'Building mesh from prompt',
        progress: pct,
        status: 'creating',
      };
    }
    return {
      iconKey: 'path',
      label: 'Creating your model',
      detail: 'Sculpting geometry',
      progress: pct,
      status: 'creating',
    };
  }

  if (engine === 'openscad' || engine === 'blender' || engine === 'freecad') {
    if (pct < 25) {
      return {
        iconKey: 'agent-spark',
        label: 'Generating script',
        detail: `${engine} pipeline`,
        progress: pct,
        status: 'creating',
      };
    }
    if (pct < 70) {
      return {
        iconKey: 'terminal',
        label: 'Executing',
        detail: 'Running CAD job on runner',
        progress: pct,
        status: 'creating',
      };
    }
    return {
      iconKey: 'files',
      label: 'Uploading result',
      detail: 'Moving artifact to storage',
      progress: pct,
      status: 'uploading',
    };
  }

  return {
    iconKey: 'agent-spark',
    label: `${engine || 'CAD'} job running`,
    detail: status,
    progress: pct,
    status: 'creating',
  };
}
