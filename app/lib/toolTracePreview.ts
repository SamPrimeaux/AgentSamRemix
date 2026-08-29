/**
 * Tool trace mini-window text: request/result bodies, syntax highlight, Monaco handoff heuristics.
 */

import type { AgentToolTraceRow } from '../components/ChatAssistant/execution/types';

export type ToolTracePreviewLang = 'json' | 'shell' | 'diff' | 'text';

/** MCP / D1 envelope fields — hide from tabular result; optional debug row only. */
export const TOOL_TRACE_RESULT_META_KEYS = new Set([
  'scope_enforced',
  'workspace_id',
  'tenant_id',
  'truncated',
  'limit_applied',
  'mode',
  'meta',
  'data_plane',
  'ok',
  'error',
  'user_message',
  'smoke_debug',
]);

/** ~9 lines at 11px / 1.45 line-height — viewport, not truncation. */
export const TOOL_TRACE_VIEWPORT_MAX_LINES = 9;

export const TOOL_TRACE_MONACO_MIN_LINES = TOOL_TRACE_VIEWPORT_MAX_LINES + 1;
export const TOOL_TRACE_MONACO_MIN_CHARS = 720;

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function detectToolTraceLang(text: string, hint?: ToolTracePreviewLang): ToolTracePreviewLang {
  if (hint) return hint;
  const t = String(text || '').trim();
  if (!t) return 'text';
  if (/^diff --git/m.test(t) || /^---\s/m.test(t) || /^\+\+\+\s/m.test(t)) return 'diff';
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      JSON.parse(t);
      return 'json';
    } catch {
      /* fall through */
    }
  }
  if (/^(npm|git|curl|cd|bash|sh|python|node|wrangler)\b/m.test(t)) return 'shell';
  return 'text';
}

export function highlightToolTraceCode(raw: string, lang?: ToolTracePreviewLang): string {
  const t = String(raw || '');
  const resolved = detectToolTraceLang(t, lang);
  if (resolved === 'json') return highlightJson(t);
  if (resolved === 'shell') return highlightShell(t);
  if (resolved === 'diff') return highlightDiff(t);
  return escapeHtml(t);
}

function highlightJson(raw: string): string {
  let pretty = raw;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return highlightShell(raw);
  }
  return escapeHtml(pretty)
    .replace(
      /("(?:\\.|[^"\\])*")(\s*:)/g,
      '<span class="tool-trace-k">$1</span><span class="tool-trace-p">$2</span>',
    )
    .replace(/: ("(?:\\.|[^"\\])*")/g, ': <span class="tool-trace-s">$1</span>')
    .replace(/\b(true|false|null)\b/g, '<span class="tool-trace-n">$1</span>')
    .replace(/: (-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, ': <span class="tool-trace-n">$1</span>');
}

function highlightShell(raw: string): string {
  return escapeHtml(raw)
    .replace(/('([^'\\]|\\.)*'|"([^"\\]|\\.)*")/g, '<span class="tool-trace-s">$1</span>')
    .replace(
      /\b(npm|git|curl|cd|node|python3?|bash|sh|wrangler|sudo|grep|find|cat|ls|mkdir|rm|cp|mv)\b/g,
      '<span class="tool-trace-k">$1</span>',
    )
    .replace(/(\/\S+)/g, '<span class="tool-trace-path">$1</span>');
}

function highlightDiff(raw: string): string {
  return escapeHtml(raw)
    .split('\n')
    .map((line) => {
      if (line.startsWith('+++') || line.startsWith('---')) {
        return `<span class="tool-trace-diff-meta">${line}</span>`;
      }
      if (line.startsWith('+')) return `<span class="tool-trace-diff-add">${line}</span>`;
      if (line.startsWith('-')) return `<span class="tool-trace-diff-del">${line}</span>`;
      if (line.startsWith('@@')) return `<span class="tool-trace-diff-hunk">${line}</span>`;
      return line;
    })
    .join('\n');
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}

export function shouldOfferMonacoHandoff(text: string, lang?: ToolTracePreviewLang): boolean {
  const t = String(text || '');
  if (!t.trim()) return false;
  const lines = countLines(t);
  if (lines > TOOL_TRACE_MONACO_MIN_LINES) return true;
  if (t.length > TOOL_TRACE_MONACO_MIN_CHARS) return true;
  const resolved = detectToolTraceLang(t, lang);
  return resolved === 'diff';
}

export function monacoHandoffFilename(
  row: Pick<AgentToolTraceRow, 'id' | 'toolName'>,
  kind: 'request' | 'result',
  lang: ToolTracePreviewLang,
): string {
  const slug = String(row.toolName || 'tool')
    .replace(/^agentsam_/i, '')
    .replace(/[^\w.-]+/g, '-')
    .slice(0, 32);
  const ext =
    lang === 'json' ? 'json' : lang === 'diff' ? 'diff' : lang === 'shell' ? 'sh' : 'txt';
  return `tool-trace-${slug}-${kind}-${row.id.slice(0, 8)}.${ext}`;
}

function isD1ToolRow(row: AgentToolTraceRow): boolean {
  if (row.isSql) return true;
  const t = String(row.toolName || '').toLowerCase();
  return t.includes('d1') || t.includes('sql') || t.endsWith('_query');
}

/** Image tools own the AgentImageGenerationCard — never a SQL/result table or wait-game. */
export function isImageGenerationToolName(toolName?: string | null): boolean {
  const t = String(toolName || '').toLowerCase();
  return (
    t.includes('imgx_') ||
    t.includes('generate_image') ||
    t.includes('image_generation') ||
    t === 'imgx_generate_image'
  );
}

/** Veo / video gen tools own AgentVideoGenerationCard. */
export function isVideoGenerationToolName(toolName?: string | null): boolean {
  const t = String(toolName || '').toLowerCase();
  return t === 'veo_generate_video' || t.includes('veo_generate');
}

/** Extract D1 tabular rows from sqlRows or tool output JSON. */
export function resolveSqlResultTable(
  row: AgentToolTraceRow,
): { rows: Record<string, unknown>[]; rowCount: number } | null {
  // imgx returns { status, generation_id, image_url } — not a query result.
  if (isImageGenerationToolName(row.toolName)) return null;
  if (isVideoGenerationToolName(row.toolName)) return null;

  if (row.sqlRows?.length) {
    return { rows: row.sqlRows, rowCount: row.sqlRows.length };
  }

  const raw = String(row.outputDetailsJson || '').trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(parsed.rows)) {
      const rows = parsed.rows.filter(
        (r): r is Record<string, unknown> => r != null && typeof r === 'object' && !Array.isArray(r),
      );
      if (rows.length) return { rows, rowCount: rows.length };
    }

    const dataKeys = Object.keys(parsed).filter((k) => !TOOL_TRACE_RESULT_META_KEYS.has(k) && k !== 'rows');
    if (dataKeys.length && !('rows' in parsed)) {
      const row: Record<string, unknown> = {};
      for (const k of dataKeys) row[k] = parsed[k];
      if (Object.keys(row).length) return { rows: [row], rowCount: 1 };
    }
  } catch {
    /* ignore */
  }

  return null;
}

export function buildToolTraceRequestText(
  row: AgentToolTraceRow,
  command: string | null,
): { text: string; lang: ToolTracePreviewLang } | null {
  const raw = String(row.detailsJson || '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (isD1ToolRow(row)) {
        const sql = parsed.sql ?? parsed.query ?? parsed.statement ?? command;
        if (sql != null && String(sql).trim()) {
          return { text: String(sql).trim(), lang: 'text' };
        }
      }
      return { text: JSON.stringify(parsed, null, 2), lang: 'json' };
    } catch {
      return { text: raw, lang: detectToolTraceLang(raw) };
    }
  }
  if (command) {
    if (isD1ToolRow(row)) return { text: command, lang: 'text' };
    return { text: JSON.stringify({ command }, null, 2), lang: 'json' };
  }
  return null;
}

export function buildToolTraceResultText(row: AgentToolTraceRow): { text: string; lang: ToolTracePreviewLang } | null {
  if (isD1ToolRow(row) && resolveSqlResultTable(row)) return null;

  const rawOut = String(row.outputDetailsJson || '').trim();
  if (rawOut && isD1ToolRow(row)) {
    try {
      const parsed = JSON.parse(rawOut) as Record<string, unknown>;
      if (Array.isArray(parsed.rows)) return null;
    } catch {
      /* ignore */
    }
  }

  if (rawOut) {
    try {
      const parsed = JSON.parse(rawOut) as Record<string, unknown>;
      const dataOnly: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (!TOOL_TRACE_RESULT_META_KEYS.has(k)) dataOnly[k] = v;
      }
      return { text: JSON.stringify(dataOnly, null, 2), lang: 'json' };
    } catch {
      return { text: rawOut, lang: detectToolTraceLang(rawOut) };
    }
  }

  const lines = row.lines.map((l) => String(l || '').trim()).filter(Boolean);
  if (!lines.length) return null;
  const text = lines.join('\n');
  return { text, lang: detectToolTraceLang(text) };
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

export function extractToolTraceDebugMeta(row: AgentToolTraceRow): Record<string, unknown> | null {
  const raw = String(row.outputDetailsJson || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const meta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (TOOL_TRACE_RESULT_META_KEYS.has(k)) meta[k] = v;
    }
    return Object.keys(meta).length ? meta : null;
  } catch {
    return null;
  }
}

export function resolveToolTraceBlocks(row: AgentToolTraceRow): {
  command: string | null;
  request: { text: string; lang: ToolTracePreviewLang } | null;
  result: { text: string; lang: ToolTracePreviewLang } | null;
} {
  const command = resolveToolTraceCommand(row);
  const request = buildToolTraceRequestText(row, command);
  const result = buildToolTraceResultText(row);
  return { command, request, result };
}
