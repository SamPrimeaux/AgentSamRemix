// app/components/finance/panels/CsvImportZone.tsx

import React, { useRef, useState, useCallback } from 'react';
import { cn } from '../../../lib/utils';
import { importCsv } from '../hooks/useFinanceData';

interface Props {
  onSuccess: (count: number) => void;
}

const EXPECTED_COLS = ['date', 'description', 'amount', 'direction'];

export function CsvImportZone({ onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<
    | { s: 'idle' }
    | { s: 'preview'; filename: string; csv: string; rows: number; headers: string[] }
    | { s: 'importing' }
    | { s: 'done'; imported: number }
    | { s: 'error'; message: string }
  >({ s: 'idle' });

  const readFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv')) {
      setState({ s: 'error', message: 'File must be a .csv' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const csv = e.target?.result as string;
      const lines = csv.trim().split('\n');
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      setState({
        s: 'preview',
        filename: file.name,
        csv,
        rows: lines.length - 1,
        headers,
      });
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) readFile(file);
    },
    [readFile]
  );

  async function handleImport() {
    if (state.s !== 'preview') return;
    setState({ s: 'importing' });
    try {
      const result = await importCsv(state.csv, state.filename);
      setState({ s: 'done', imported: result.imported });
      onSuccess(result.imported);
    } catch (e: any) {
      setState({ s: 'error', message: e.message });
    }
  }

  const missingCols =
    state.s === 'preview'
      ? EXPECTED_COLS.filter((c) => !state.headers.includes(c))
      : [];

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all select-none',
          dragging
            ? 'border-violet-400 bg-violet-500/10'
            : 'border-white/10 hover:border-white/25 hover:bg-white/[0.02]'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }}
        />
        <div className="text-3xl mb-3 opacity-40">⬆</div>
        <p className="text-sm text-slate-300 font-medium">
          Drop a CSV file here or <span className="text-violet-400 underline underline-offset-2">browse</span>
        </p>
        <p className="text-xs text-slate-500 mt-2">
          Required columns: <code className="text-slate-400">date, description, amount, direction</code>
        </p>
      </div>

      {/* Preview */}
      {state.s === 'preview' && (
        <div className="bg-[#0d2128] border border-white/[0.06] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">{state.filename}</p>
              <p className="text-xs text-slate-400 mt-0.5">{state.rows} rows detected</p>
            </div>
            {missingCols.length > 0 && (
              <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                Missing: <code>{missingCols.join(', ')}</code>
              </div>
            )}
          </div>

          {/* Detected headers */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Detected columns</p>
            <div className="flex flex-wrap gap-1.5">
              {state.headers.map((h) => (
                <span
                  key={h}
                  className={cn(
                    'text-[11px] rounded-full px-2.5 py-0.5 font-mono',
                    EXPECTED_COLS.includes(h)
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                      : 'bg-white/[0.05] text-slate-400 border border-white/[0.06]'
                  )}
                >
                  {h}
                </span>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleImport}
              disabled={missingCols.length > 0}
              className="px-4 py-2 text-sm font-medium bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              Import {state.rows} rows
            </button>
            <button
              onClick={() => setState({ s: 'idle' })}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.s === 'importing' && (
        <div className="text-center py-8 text-slate-400 text-sm animate-pulse">Importing…</div>
      )}

      {state.s === 'done' && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-5 py-4 text-sm text-emerald-400 font-medium">
          ✓ Imported {state.imported} transactions successfully.
          <button
            onClick={() => setState({ s: 'idle' })}
            className="ml-3 underline text-emerald-300 hover:text-white"
          >
            Import another
          </button>
        </div>
      )}

      {state.s === 'error' && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-5 py-4 text-sm text-rose-400">
          {state.message}
          <button
            onClick={() => setState({ s: 'idle' })}
            className="ml-3 underline hover:text-white"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
