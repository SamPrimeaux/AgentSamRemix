/**
 * Lightweight unified-diff view for ToolApprovalModal / ToolApprovalCard.
 * Gutter +/- (not inline signs); emerald/red riskStyle tints; line-through on deletes.
 */

import React, { useMemo } from 'react';

export type UnifiedDiffLineKind = 'add' | 'del' | 'ctx' | 'meta' | 'hunk';

export type UnifiedDiffLine = {
  kind: UnifiedDiffLineKind;
  gutter: string;
  content: string;
};

/** Prefer this over SQL detection — a SQL patch must render as a diff. */
export function looksLikeUnifiedDiff(text: string): boolean {
  const t = String(text || '');
  if (!t.trim()) return false;
  if (/^diff --git /m.test(t)) return true;
  if (/^--- .+\n\+\+\+ /m.test(t)) return true;
  if (/^@@ [^\n]+ @@/m.test(t)) return true;
  const lines = t.split('\n');
  let plus = 0;
  let minus = 0;
  for (const ln of lines) {
    if (ln.startsWith('+++') || ln.startsWith('---')) continue;
    if (ln.startsWith('+')) plus += 1;
    else if (ln.startsWith('-')) minus += 1;
  }
  return plus + minus >= 2 && plus > 0 && minus > 0;
}

export function parseUnifiedDiffLines(text: string): UnifiedDiffLine[] {
  const raw = String(text || '').split('\n');
  const out: UnifiedDiffLine[] = [];
  for (const ln of raw) {
    if (ln.startsWith('@@')) {
      out.push({ kind: 'hunk', gutter: ' ', content: ln });
      continue;
    }
    if (
      ln.startsWith('diff --git') ||
      ln.startsWith('index ') ||
      ln.startsWith('---') ||
      ln.startsWith('+++') ||
      ln.startsWith('new file') ||
      ln.startsWith('deleted file') ||
      ln.startsWith('similarity index') ||
      ln.startsWith('rename from') ||
      ln.startsWith('rename to')
    ) {
      out.push({ kind: 'meta', gutter: ' ', content: ln });
      continue;
    }
    if (ln.startsWith('+')) {
      out.push({ kind: 'add', gutter: '+', content: ln.slice(1) });
      continue;
    }
    if (ln.startsWith('-')) {
      out.push({ kind: 'del', gutter: '-', content: ln.slice(1) });
      continue;
    }
    if (ln.startsWith('\\')) {
      out.push({ kind: 'meta', gutter: ' ', content: ln });
      continue;
    }
    // Context lines often start with a single space in unified diff.
    const content = ln.startsWith(' ') ? ln.slice(1) : ln;
    out.push({ kind: 'ctx', gutter: ' ', content });
  }
  return out;
}

function lineClass(kind: UnifiedDiffLineKind): string {
  switch (kind) {
    case 'add':
      return 'bg-emerald-500/10 text-emerald-200/95';
    case 'del':
      return 'bg-red-500/15 text-red-300/95 line-through';
    case 'hunk':
      return 'bg-sky-500/8 text-sky-300/80';
    case 'meta':
      return 'text-[var(--dashboard-muted)]/85';
    default:
      return 'text-[var(--dashboard-text)]/90';
  }
}

function gutterClass(kind: UnifiedDiffLineKind): string {
  switch (kind) {
    case 'add':
      return 'text-emerald-300/90';
    case 'del':
      return 'text-red-300/90';
    case 'hunk':
      return 'text-sky-300/70';
    default:
      return 'text-[var(--dashboard-muted)]/50';
  }
}

export type ApprovalUnifiedDiffProps = {
  text: string;
  truncated?: boolean;
  className?: string;
};

export function ApprovalUnifiedDiff({ text, truncated = false, className = '' }: ApprovalUnifiedDiffProps) {
  const lines = useMemo(() => parseUnifiedDiffLines(text), [text]);
  return (
    <div className={`font-mono text-[0.6875rem] leading-relaxed ${className}`.trim()} style={{ tabSize: 2 }}>
      {lines.map((ln, i) => (
        <div
          key={i}
          className={`flex min-w-0 whitespace-pre [overflow-wrap:anywhere] ${lineClass(ln.kind)}`}
        >
          <span
            aria-hidden
            className={`w-4 shrink-0 select-none text-center font-semibold ${gutterClass(ln.kind)}`}
          >
            {ln.gutter}
          </span>
          <span className="min-w-0 flex-1">{ln.content === '' ? '\u00A0' : ln.content}</span>
        </div>
      ))}
      {truncated ? (
        <div className="mt-2 text-[0.65rem] text-[var(--dashboard-muted)] border-t border-white/[0.06] pt-2 no-underline">
          Truncated — open in editor for the full diff.
        </div>
      ) : null}
    </div>
  );
}
