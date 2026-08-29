/**
 * Inline architectural sketch preview — editable SVG rendered in chat (no /draw hop).
 */
import React, { useCallback, useId, useMemo, useState } from 'react';

function sanitizeSvgMarkup(raw: string): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/\son\w+\s*=\s*(['"])[\s\S]*?\1/gi, '');
  s = s.replace(/javascript:/gi, '');
  if (!/^<svg[\s>]/i.test(s)) return '';
  return s;
}

export type AgentSvgSketchPreviewProps = {
  source: string;
  title?: string;
};

export function AgentSvgSketchPreview({ source, title }: AgentSvgSketchPreviewProps) {
  const [draft, setDraft] = useState(() => String(source || '').trim());
  const [editing, setEditing] = useState(false);
  const previewId = useId();

  const safeSvg = useMemo(() => sanitizeSvgMarkup(editing ? draft : source), [draft, editing, source]);

  const copySvg = useCallback(async () => {
    const text = editing ? draft : source;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }, [draft, editing, source]);

  if (!safeSvg && !draft.trim()) return null;

  return (
    <div className="my-3 rounded-lg border border-[var(--dashboard-border)] bg-[var(--scene-bg)] overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]">
        <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--dashboard-muted)]">
          {title?.trim() || 'Sketch preview'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-[0.6875rem] px-2 py-0.5 rounded border border-[var(--dashboard-border)] text-[var(--solar-cyan)] hover:bg-[var(--dashboard-border)]/30"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? 'Done' : 'Edit SVG'}
          </button>
          <button
            type="button"
            className="text-[0.6875rem] px-2 py-0.5 rounded border border-[var(--dashboard-border)] text-[var(--dashboard-muted)] hover:bg-[var(--dashboard-border)]/30"
            onClick={() => void copySvg()}
          >
            Copy
          </button>
        </div>
      </div>
      {safeSvg ? (
        <div
          id={previewId}
          className="p-3 overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:mx-auto"
          dangerouslySetInnerHTML={{ __html: safeSvg }}
        />
      ) : (
        <p className="px-3 py-2 text-[0.75rem] text-[var(--dashboard-muted)]">Invalid SVG markup.</p>
      )}
      {editing ? (
        <textarea
          className="w-full min-h-[140px] text-[0.6875rem] font-mono p-3 border-t border-[var(--dashboard-border)] bg-[var(--bg-code-pre)] text-[var(--solar-cyan)] resize-y"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Edit SVG source"
        />
      ) : null}
    </div>
  );
}
