/**
 * CAD / Meshy tool trace helpers — job id extraction and in-flight detection for chat SSE.
 */
import type { AgentToolTraceRow } from '../components/ChatAssistant/execution/types';

export function isCadToolName(toolName: string): boolean {
  const t = String(toolName || '').trim();
  if (!t) return false;
  return (
    /^(meshyai_|designstudio_|cad_)/i.test(t) ||
    /openscad|blender|freecad|meshy/i.test(t)
  );
}

export function extractCadJobIdFromToolOutput(
  toolName: string,
  outputPreview?: string | null,
): string | null {
  if (!outputPreview?.trim()) return null;
  if (!isCadToolName(toolName)) return null;
  try {
    const parsed = JSON.parse(outputPreview) as Record<string, unknown>;
    const id = parsed.job_id ?? parsed.cad_job_id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  } catch {
    const quoted = outputPreview.match(/"job_id"\s*:\s*"([^"]+)"/i);
    if (quoted?.[1]?.trim()) return quoted[1].trim();
    const cadj = outputPreview.match(/\bcadj_[a-f0-9]{8,}\b/i);
    if (cadj?.[0]) return cadj[0];
  }
  return null;
}

/** Priority: explicit SSE fields → output_preview → streamed chunk. */
export function resolveCadJobIdFromSse(
  toolName: string,
  payload: {
    job_id?: unknown;
    cad_job_id?: unknown;
    output_preview?: string | null;
    chunk?: string | null;
  },
): string | null {
  const direct = payload.job_id ?? payload.cad_job_id;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const fromPreview = extractCadJobIdFromToolOutput(toolName, payload.output_preview);
  if (fromPreview) return fromPreview;
  if (payload.chunk) return extractCadJobIdFromToolOutput(toolName, payload.chunk);
  return null;
}

export function cadJobOutputLooksInFlight(toolName: string, output?: string | null): boolean {
  if (!isCadToolName(toolName)) return false;
  if (!output?.trim()) return true;
  try {
    const p = JSON.parse(output) as Record<string, unknown>;
    if (p.pending_polish === true) return true;
    const st = String(p.status || '').toLowerCase();
    if (['pending', 'running', 'queued', 'accepted'].includes(st)) return true;
    const pct = Number(p.progress_pct ?? p.progress);
    if (Number.isFinite(pct) && pct > 0 && pct < 100) return true;
    if (p.job_id && st !== 'done' && st !== 'complete' && st !== 'failed') return true;
  } catch {
    return Boolean(extractCadJobIdFromToolOutput(toolName, output));
  }
  return false;
}

export function traceRowCadJobLive(row: AgentToolTraceRow): boolean {
  return Boolean(row.cadJobLive || (row.cadJobId && row.status === 'running'));
}

/** Keep in-flight CAD trace rows when clearing the timeline or starting a new turn. */
export function preserveLiveCadTraceRows(rows: AgentToolTraceRow[]): AgentToolTraceRow[] {
  return rows.filter(traceRowCadJobLive);
}

export function patchTraceRowCadJob(
  row: AgentToolTraceRow,
  toolName: string,
  opts: {
    jobId?: string | null;
    outputPreview?: string | null;
    cadJobLive?: boolean;
  },
): AgentToolTraceRow {
  const jobId =
    opts.jobId ||
    (opts.outputPreview ? extractCadJobIdFromToolOutput(toolName, opts.outputPreview) : null) ||
    row.cadJobId;
  if (!jobId) return row;

  const inFlight =
    opts.cadJobLive ??
    (opts.outputPreview != null
      ? cadJobOutputLooksInFlight(toolName, opts.outputPreview)
      : row.cadJobLive);

  return {
    ...row,
    cadJobId: jobId,
    cadJobLive: inFlight,
    status: inFlight ? 'running' : row.status,
  };
}
