import React, { useState } from 'react';
import { ExecutionEvent } from '../../sdk/types';

interface ExecutionLedgerProps {
  events: ExecutionEvent[];
  isStreaming?: boolean;
}

export const ExecutionLedger: React.FC<ExecutionLedgerProps> = ({ events, isStreaming }) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getEventIcon = (type: string) => {
    if (type.startsWith('image')) return 'image';
    if (type.startsWith('environment')) return 'cloud';
    if (type.startsWith('mission')) return 'flag';
    if (type.startsWith('repository')) return 'travel_explore';
    if (type.startsWith('file')) return 'edit_note';
    if (type.startsWith('terminal')) return 'terminal';
    if (type.startsWith('test')) return 'fact_check';
    if (type.startsWith('browser')) return 'devices';
    if (type.startsWith('verification')) return 'verified';
    return 'hub';
  };

  const getEventBadgeColor = (type: string) => {
    if (type.startsWith('image')) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    if (type.includes('failed')) return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
    if (type.includes('passed') || type.includes('verified') || type.includes('ready')) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    if (type.includes('edited')) return 'text-sky-400 bg-sky-500/10 border-sky-500/20';
    if (type.includes('terminal') || type.includes('test')) return 'text-purple-400 bg-purple-500/10 border-purple-500/20';
    return 'text-zinc-400 bg-zinc-800/60 border-zinc-700/60';
  };

  if (events.length === 0) {
    return (
      <div className="p-8 text-center border border-dashed border-zinc-800 rounded-xl text-zinc-500 text-xs">
        Execution stream idle. Launch an engineering mission to stream typed SDK events.
      </div>
    );
  }

  return (
    <div className="space-y-2 font-sans">
      <div className="flex items-center justify-between px-1 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Execution Ledger</span>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
            {events.length} events
          </span>
          {isStreaming && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-sky-400 font-medium ml-2">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
              <span>Streaming SDK Runtime...</span>
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (expandedIds.size === events.length) setExpandedIds(new Set());
            else setExpandedIds(new Set(events.map(e => e.id)));
          }}
          className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          {expandedIds.size === events.length ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      <div className="space-y-1.5">
        {events.map(event => {
          const isExpanded = expandedIds.has(event.id);
          const icon = getEventIcon(event.type);
          const badgeClass = getEventBadgeColor(event.type);

          return (
            <div
              key={event.id}
              className={`border rounded-xl transition-all overflow-hidden ${
                isExpanded ? 'bg-zinc-900/90 border-zinc-700 shadow-lg' : 'bg-zinc-900/40 border-zinc-800/80 hover:bg-zinc-900/60 hover:border-zinc-700/60'
              }`}
            >
              {/* Compact Event Row Header */}
              <button
                type="button"
                onClick={() => toggleExpand(event.id)}
                className="w-full px-3.5 py-2.5 flex items-center justify-between text-left gap-3 cursor-pointer select-none"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className={`p-1.5 rounded-lg border flex items-center justify-center ${badgeClass}`}>
                    <span className="material-symbols-outlined text-sm">{icon}</span>
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-200 truncate">{event.title}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-950 text-zinc-500 border border-zinc-800">
                        {event.type}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 truncate mt-0.5">{event.summary}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 text-right">
                  <span className="text-[10px] font-mono text-zinc-500">
                    {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={`material-symbols-outlined text-zinc-400 text-sm transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    expand_more
                  </span>
                </div>
              </button>

              {/* Progressive Disclosure: Expanded Details */}
              {isExpanded && (
                <div className="px-4 pb-3.5 pt-1 border-t border-zinc-800/80 text-xs space-y-3 bg-zinc-950/40">
                  {/* Meta / Environment Info */}
                  <div className="flex flex-wrap gap-4 text-[11px] text-zinc-400 pt-2 border-b border-zinc-800/40 pb-2">
                    <div><strong>Event ID:</strong> <code className="font-mono text-zinc-300">{event.id}</code></div>
                    <div><strong>Environment:</strong> <span className="font-mono text-sky-400">{event.environmentId}</span></div>
                    {event.durationMs && <div><strong>Duration:</strong> <span className="font-mono text-emerald-400">{event.durationMs}ms</span></div>}
                  </div>

                  {/* Metadata JSON Viewer */}
                  {event.metadata && (
                    <div>
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Execution Payload / Details</span>
                      <pre className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-[11px] text-zinc-300 overflow-x-auto max-h-48">
                        {typeof event.metadata === 'string' ? event.metadata : JSON.stringify(event.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
