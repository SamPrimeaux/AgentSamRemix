/** Terminal Problems panel row (XTermShell). */
export type TerminalProblemRow = {
  file: string;
  line: number;
  msg: string;
  severity: 'error' | 'warning';
  ts?: string;
  id?: string;
};

type ErrorLogRow = {
  id?: string;
  error_type?: string;
  error_message?: string;
  error_code?: string;
  source?: string;
  context_json?: string;
  created_at?: number | string;
};

type ProblemsApiPayload = {
  agentsam_error_log?: ErrorLogRow[];
};

function formatProblemTimestamp(ts: number | string | null | undefined): string {
  if (ts == null || ts === '') return '';
  const n = Number(ts);
  if (Number.isFinite(n) && n > 1e9 && n < 1e12) {
    try {
      return new Date(n * 1000).toISOString().slice(0, 19).replace('T', ' ');
    } catch {
      return String(ts);
    }
  }
  return String(ts);
}

function problemFileLabel(source: string, row: ErrorLogRow): string {
  const s = source || 'agentsam_error_log';
  if (s === 'agentsam_tool_chain' || s === 'agentsam_tool_call_log') {
    let tool = '';
    try {
      const ctx = row.context_json != null ? JSON.parse(String(row.context_json)) : null;
      if (ctx && typeof ctx === 'object' && ctx.tool_key != null) tool = String(ctx.tool_key);
    } catch {
      /* ignore */
    }
    return tool ? `tool · ${tool}` : 'tool';
  }
  const code = row.error_code != null ? String(row.error_code) : '';
  return code ? `${s} · ${code}` : s;
}

function mapErrorLogRow(row: ErrorLogRow): TerminalProblemRow {
  const severityRaw = String(row.error_type || 'error').toLowerCase();
  const severity = severityRaw.includes('warn') ? 'warning' : 'error';
  const source = String(row.source || 'agentsam_error_log');
  return {
    file: problemFileLabel(source, row),
    line: 0,
    msg: String(row.error_message || 'Unknown error').slice(0, 500),
    severity,
    ts: formatProblemTimestamp(row.created_at),
    id: row.id != null ? String(row.id) : undefined,
  };
}

/** Map GET /api/agent/problems — agentsam_error_log rows only. */
export function mapProblemsApiPayload(data: ProblemsApiPayload | null | undefined): TerminalProblemRow[] {
  if (!data || !Array.isArray(data.agentsam_error_log)) return [];
  return data.agentsam_error_log.map(mapErrorLogRow);
}

export function countProblemSeverities(rows: TerminalProblemRow[]) {
  let errors = 0;
  let warnings = 0;
  for (const p of rows) {
    if (p.severity === 'warning') warnings += 1;
    else errors += 1;
  }
  return { errors, warnings };
}
