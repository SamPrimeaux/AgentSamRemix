/**
 * User-facing tool trace titles (Claude-style: "Agentsam terminal local").
 */

import type { AgentToolTraceRow } from '../components/ChatAssistant/execution/types';

function simplifyToolName(raw: string): string {
  const t = String(raw || '').trim();
  if (!t) return 'working';
  return t.replace(/^agentsam_/i, '').replace(/_/g, ' ').toLowerCase();
}

function formatBrand(label?: string | null): string {
  const s = String(label || 'Agent Sam').trim();
  if (/^agent\s*sam$/i.test(s)) return 'Agentsam';
  return s;
}

function connectionSuffix(row: Pick<AgentToolTraceRow, 'connectionResolution' | 'execHost' | 'toolName'>): string {
  const tn = String(row.toolName || '').toLowerCase();
  if (/terminal_local|shell_local/.test(tn)) return 'local';
  if (/terminal_remote|shell_remote/.test(tn)) return 'remote';
  const res = String(row.connectionResolution || row.execHost || '').toLowerCase();
  if (res.includes('localpty') || res.includes('mac_local') || res.includes('local')) return 'local';
  if (res.includes('tunnel') || res.includes('remote') || res.includes('gcp')) return 'remote';
  return '';
}

export function formatToolTraceDisplayTitle(
  row: Pick<AgentToolTraceRow, 'toolName' | 'integrationLabel' | 'connectionResolution' | 'execHost'>,
): string {
  const brand = formatBrand(row.integrationLabel);
  const tool = simplifyToolName(row.toolName);
  const conn = connectionSuffix(row);
  if (/terminal|shell|pty/.test(String(row.toolName || '').toLowerCase())) {
    if (conn && !tool.includes(conn)) return `${brand} ${tool}`.replace(/\s+/g, ' ').trim();
    return `${brand} ${tool}`.replace(/\s+/g, ' ').trim();
  }
  return `${brand} ${tool}`.replace(/\s+/g, ' ').trim();
}

export function resolveToolTraceCommand(row: AgentToolTraceRow): string | null {
  const raw = String(row.detailsJson || '').trim();
  if (raw) {
    try {
      const p = JSON.parse(raw) as Record<string, unknown>;
      const cmd =
        p.command ?? p.cmd ?? p.shell_command ?? p.shell ?? p.query ?? p.sql ?? p.statement;
      if (cmd != null && String(cmd).trim()) return String(cmd).trim();
    } catch {
      /* ignore */
    }
  }
  for (const line of row.lines) {
    const m = line.match(/^(?:command|cmd|query|sql):\s*(.+)$/i);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

export function resolveToolTraceMetaLabel(row: AgentToolTraceRow, command: string | null): string {
  if (row.status === 'running') {
    if (command) return command.length > 96 ? `${command.slice(0, 94)}…` : command;
    return 'Running…';
  }
  if (row.status === 'error') return 'Failed';
  return 'Result';
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return `${t.slice(0, Math.max(1, n - 1))}…`;
}

/** One human sentence for a tool row — used in the folded loader line. */
export function formatToolTraceActivitySentence(row: AgentToolTraceRow): string {
  const tn = String(row.toolName || '').toLowerCase();
  const cmd = resolveToolTraceCommand(row);
  const failed = row.status === 'error';
  const running = row.status === 'running';

  if (/codebase_retrieve|code_search|ast_rag|symbol_search/.test(tn)) {
    const q = cmd ? clip(cmd, 48) : '';
    if (failed) return q ? `Codebase search failed for “${q}”` : 'Codebase search failed';
    if (running) return q ? `Searching codebase for “${q}”…` : 'Searching codebase…';
    return q ? `Searched codebase for “${q}”` : 'Searched codebase';
  }
  if (/terminal|shell|pty/.test(tn)) {
    const c = cmd ? clip(cmd, 56) : '';
    if (failed) return c ? `Command failed: ${c}` : 'Terminal command failed';
    if (running) return c ? `Running ${c}` : 'Running terminal…';
    return c ? `Ran ${c}` : 'Ran terminal command';
  }
  if (/d1_query|d1_write|sql/.test(tn)) {
    if (failed) return 'Database query failed';
    if (running) return cmd ? `Querying database…` : 'Running database query…';
    return 'Database query finished';
  }
  if (/github_/.test(tn)) {
    if (failed) {
      const errLine = row.lines.find((l) => /fail|error|not defined|required/i.test(l));
      if (errLine) return `GitHub tool failed: ${clip(errLine.replace(/^\[[^\]]+\]\s*/, ''), 72)}`;
      return 'GitHub tool failed';
    }
    if (running) return 'Working with GitHub…';
    return 'GitHub step finished';
  }

  // Codemode / raw `{"code":...}` must never become the fold title (user-visible leak).
  if (tn === 'codemode' || /^\s*\{\s*"code"\s*:/.test(String(row.lines?.[0] || ''))) {
    if (failed) return 'Codemode sandbox failed';
    if (running) return 'Running Codemode sandbox…';
    return 'Codemode sandbox';
  }

  const title = formatToolTraceDisplayTitle(row);
  const rawLine = row.lines?.[0] ? String(row.lines[0]) : '';
  // Suppress accidental JSON dumps in the first summary line.
  const line =
    rawLine && !/^\s*\{/.test(rawLine) && !/^code\s*:/i.test(rawLine)
      ? clip(rawLine, 120)
      : '';
  if (failed) return line || `${title} failed`;
  if (running) return line ? `${line}` : `${title}…`;
  return line || title;
}

/** Single folded summary for the whole tool stack. */
export function formatExecutionTimelineSummary(rows: AgentToolTraceRow[]): string {
  if (!rows.length) return 'Working…';
  const running = rows.filter((r) => r.status === 'running' && !r.cadJobLive);
  const failed = rows.filter((r) => r.status === 'error');
  if (running.length) {
    const last = running[running.length - 1];
    const base = formatToolTraceActivitySentence(last);
    if (rows.length === 1) return base;
    return `${base} · ${rows.length} steps`;
  }
  if (failed.length) {
    const last = failed[failed.length - 1];
    const base = formatToolTraceActivitySentence(last);
    if (failed.length === 1 && rows.length === 1) return base;
    return `${base} · ${failed.length} failed`;
  }
  if (rows.length === 1) return formatToolTraceActivitySentence(rows[0]);
  const names = Array.from(
    new Set(rows.map((r) => simplifyToolName(r.toolName || '')).filter(Boolean)),
  ).slice(0, 3);
  return `Finished ${rows.length} tools${names.length ? ` · ${names.join(', ')}` : ''}`;
}
