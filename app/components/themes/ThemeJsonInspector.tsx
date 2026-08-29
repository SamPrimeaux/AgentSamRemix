import React from 'react';

export type ThemeJsonInspectorProps = {
  open: boolean;
  title: string;
  data: unknown;
  onClose: () => void;
};

export function ThemeJsonInspector({
  open,
  title,
  data,
  onClose,
}: ThemeJsonInspectorProps): React.ReactElement | null {
  if (!open) return null;

  let text = '';
  try {
    text = JSON.stringify(data, null, 2);
  } catch {
    text = String(data);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50" role="dialog">
      <div className="bg-[var(--dashboard-panel)] border border-[var(--dashboard-border)] rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--dashboard-border)]">
          <h4 className="text-sm font-semibold text-main">{title}</h4>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded-md bg-[var(--bg-hover)] text-main"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <pre className="text-[11px] leading-relaxed overflow-auto p-4 font-mono text-main whitespace-pre">
          {text}
        </pre>
      </div>
    </div>
  );
}
