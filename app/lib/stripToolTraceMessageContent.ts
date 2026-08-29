/**
 * Strip tool-duplicate fences from assistant markdown and reorder prose above remaining fences.
 */

import type { AgentToolTraceRow } from '../components/ChatAssistant/execution/types';
import { resolveToolTraceCommand } from './formatToolTraceDisplayTitle';
import {
  buildToolTraceRequestText,
  resolveSqlResultTable,
} from './toolTracePreview';

const SQL_FENCE_LANGS = new Set([
  'sql',
  'postgres',
  'postgresql',
  'mysql',
  'sqlite',
  'plpgsql',
]);

const CODE_BLOCK_RE = /```(\w+)?\n([\s\S]*?)\n```/g;

function isSqlToolRow(row: AgentToolTraceRow): boolean {
  if (row.isSql) return true;
  const t = String(row.toolName || '').toLowerCase();
  return t.includes('d1') || t.includes('sql') || t.endsWith('_query');
}

function jsonEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function jsonFenceMatchesToolOutput(code: string, toolTraceRows: AgentToolTraceRow[]): boolean {
  const trimmed = code.trim();
  if (!trimmed) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }

  for (const row of toolTraceRows) {
    const table = resolveSqlResultTable(row);
    if (table?.rows?.length) {
      if (jsonEqual(parsed, table.rows)) return true;
      if (table.rows.length === 1 && jsonEqual(parsed, table.rows[0])) return true;
    }

    const raw = String(row.outputDetailsJson || '').trim();
    if (!raw) continue;
    try {
      const out = JSON.parse(raw) as Record<string, unknown>;
      if (jsonEqual(parsed, out)) return true;
      if (Array.isArray(out.rows)) {
        if (jsonEqual(parsed, out.rows)) return true;
        if (out.rows.length === 1 && jsonEqual(parsed, out.rows[0])) return true;
      }
    } catch {
      /* ignore */
    }
  }

  return false;
}

function shouldStripSqlFence(lang: string, code: string, toolTraceRows: AgentToolTraceRow[]): boolean {
  if (!toolTraceRows.some(isSqlToolRow)) return false;
  const langLower = String(lang || '').toLowerCase();
  if (SQL_FENCE_LANGS.has(langLower)) return true;

  const normalized = code.replace(/\s+/g, ' ').trim();
  for (const row of toolTraceRows) {
    if (!isSqlToolRow(row)) continue;
    const command = resolveToolTraceCommand(row);
    const request = buildToolTraceRequestText(row, command);
    const sqlText = request?.text || command;
    if (sqlText && sqlText.replace(/\s+/g, ' ').trim() === normalized) return true;
  }
  return false;
}

/** Remove SQL / tool-result JSON fences already shown in the execution timeline. */
export function stripToolDuplicateFences(
  content: string,
  toolTraceRows: AgentToolTraceRow[],
): string {
  if (!content.trim() || !toolTraceRows.length) return content;

  let next = content;
  CODE_BLOCK_RE.lastIndex = 0;
  const removals: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_RE.exec(content)) !== null) {
    const lang = match[1] || '';
    const code = match[2];
    const fence = match[0];
    const langLower = lang.toLowerCase();

    if (shouldStripSqlFence(lang, code, toolTraceRows)) {
      removals.push(fence);
      continue;
    }
    if (langLower === 'json' && jsonFenceMatchesToolOutput(code, toolTraceRows)) {
      removals.push(fence);
    }
  }

  for (const fence of removals) {
    next = next.replace(fence, '');
  }

  return next.replace(/\n{3,}/g, '\n\n').trim();
}

/** Move non-fenced prose above any remaining code fences (Claude-style answer-first). */
export function reorderProseBeforeFences(content: string): string {
  if (!content.trim()) return content;

  const proseParts: string[] = [];
  const codeParts: string[] = [];
  let lastIndex = 0;
  CODE_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CODE_BLOCK_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.substring(lastIndex, match.index).trim();
      if (text) proseParts.push(text);
    }
    codeParts.push(match[0]);
    lastIndex = CODE_BLOCK_RE.lastIndex;
  }

  if (lastIndex < content.length) {
    const tail = content.substring(lastIndex).trim();
    if (tail) proseParts.push(tail);
  }

  const prose = proseParts.join('\n\n').trim();
  const codes = codeParts.join('\n\n').trim();
  if (!prose) return codes || content;
  if (!codes) return prose;
  return `${prose}\n\n${codes}`;
}

export function prepareAssistantMessageWithToolTrace(
  content: string,
  toolTraceRows: AgentToolTraceRow[],
): string {
  if (!toolTraceRows.length) return content;
  return reorderProseBeforeFences(stripToolDuplicateFences(content, toolTraceRows));
}
