import React from 'react';
import { Copy, X } from 'lucide-react';

type Props = {
  request: string;
  response: string;
  open: boolean;
  onToggle: () => void;
};

export function ApiInspector({ request, response, open, onToggle }: Props) {
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  if (!open) return null;

  return (
    <aside className="flex flex-col flex-1 min-h-0 w-full bg-[var(--bg-panel)]">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-subtle)]">
        <span className="text-[11px] font-semibold text-muted">API</span>
        <button type="button" onClick={onToggle} className="p-1 text-muted hover:text-main">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-4">
        <section>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold uppercase text-muted">Request</span>
            {request ? (
              <button type="button" onClick={() => copy(request)} className="text-muted hover:text-[var(--solar-cyan)]">
                <Copy size={12} />
              </button>
            ) : null}
          </div>
          <pre
            className="text-[10px] leading-relaxed whitespace-pre-wrap break-all rounded-lg p-3 border max-h-[40vh] overflow-y-auto font-mono"
            style={{
              color: 'var(--solar-cyan)',
              background: 'var(--bg-hover)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            {request || 'Run a generation to see the cURL request.'}
          </pre>
        </section>
        <section>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold uppercase text-muted">Response</span>
            {response ? (
              <button type="button" onClick={() => copy(response)} className="text-muted hover:text-[var(--solar-cyan)]">
                <Copy size={12} />
              </button>
            ) : null}
          </div>
          <pre
            className="text-[10px] leading-relaxed whitespace-pre-wrap break-all rounded-lg p-3 border max-h-[40vh] overflow-y-auto font-mono"
            style={{
              color: 'var(--solar-violet)',
              background: 'var(--bg-hover)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            {response || '{}'}
          </pre>
        </section>
      </div>
    </aside>
  );
}
