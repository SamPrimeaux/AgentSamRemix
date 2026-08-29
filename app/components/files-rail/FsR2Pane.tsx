import React from 'react';
import { ChevronRight, Folder, Loader2, Search, Trash2 } from 'lucide-react';
import { SetiFileIcon } from '../../src/components/SetiFileIcon';
import type { R2FilesController } from '../../hooks/useR2FilesPane';
import type { ActiveFile } from '../../types';

export type FsR2PaneProps = {
  r2: R2FilesController;
  onOpenInEditor?: (file: ActiveFile) => void;
};

export const FsR2Pane: React.FC<FsR2PaneProps> = ({ r2, onOpenInEditor }) => {
  const {
    displayR2Buckets, selectedR2Bucket, setSelectedR2Bucket, setR2PrefixByBucket,
    setR2SearchMode, r2PrefixByBucket, r2PrefixesByBucket, r2ObjectsByBucket,
    r2ListCursorByBucket, r2ListTruncatedByBucket, r2Loading, r2Err, r2SearchQ,
    r2SearchMode, setR2SearchQ, setR2Prefix, parentR2Prefix, loadR2List,
    loadMoreR2List, runR2Search, clearR2Search, openR2Key, deleteR2Key,
    r2AddOpen, setR2AddMode, r2AddMode, r2AddName, setR2AddName, r2AddBusy,
    connectR2Bucket, createR2Bucket,
  } = r2;
  const r2Bucket = selectedR2Bucket;
  const r2Prefix = r2Bucket ? (r2PrefixByBucket[r2Bucket] ?? '') : '';
  const r2Prefs = r2Bucket ? (r2PrefixesByBucket[r2Bucket] || []) : [];
  const r2Objs = r2Bucket ? (r2ObjectsByBucket[r2Bucket] || []) : [];
  const r2SearchOn = r2Bucket ? !!r2SearchMode[r2Bucket] : false;
  const shortR2Name = (full: string) => r2Prefix && full.startsWith(r2Prefix) ? full.slice(r2Prefix.length) : full;
  return (
          <div className="flex-1 min-h-0 flex flex-col px-2 py-1 font-mono text-[11px] overflow-hidden">
            {r2AddOpen ? (
              <div className="shrink-0 mb-2 rounded border border-[var(--border-subtle)]/50 bg-[var(--bg-app)]/80 p-2 flex flex-col gap-2 text-[10px]">
                {!r2AddMode ? (
                  <>
                    <button
                      type="button"
                      className="text-left px-2 py-1 rounded hover:bg-[var(--bg-hover)]"
                      onClick={() => setR2AddMode('connect')}
                    >
                      Connect existing bucket
                    </button>
                    <button
                      type="button"
                      className="text-left px-2 py-1 rounded hover:bg-[var(--bg-hover)]"
                      onClick={() => setR2AddMode('create')}
                    >
                      Create new bucket
                    </button>
                  </>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <input
                      value={r2AddName}
                      onChange={(e) => setR2AddName(e.target.value)}
                      placeholder={r2AddMode === 'create' ? 'new-bucket-name' : 'bucket-name'}
                      className="bg-[var(--bg-app)] border border-[var(--border-subtle)]/50 rounded px-2 py-1 text-[10px] outline-none"
                    />
                    <button
                      type="button"
                      disabled={r2AddBusy || !r2AddName.trim()}
                      className="py-1 rounded bg-[var(--solar-cyan)]/20 text-[var(--solar-cyan)] disabled:opacity-50"
                      onClick={() => void (r2AddMode === 'create' ? createR2Bucket() : connectR2Bucket())}
                    >
                      {r2AddBusy ? 'Working…' : r2AddMode === 'create' ? 'Create' : 'Connect'}
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            {displayR2Buckets.length > 0 ? (
              <label className="shrink-0 flex items-center gap-2 text-[10px] text-muted mb-1">
                <span className="uppercase shrink-0">Bucket</span>
                <select
                  value={selectedR2Bucket}
                  onChange={(e) => {
                    const b = e.target.value;
                    setSelectedR2Bucket(b);
                    setR2PrefixByBucket((prev) => ({ ...prev, [b]: prev[b] ?? '' }));
                    setR2SearchMode((m) => ({ ...m, [b]: false }));
                  }}
                  className="flex-1 min-w-0 bg-[var(--bg-app)] border border-[var(--border-subtle)]/50 rounded px-1 py-0.5 text-[10px] text-main"
                >
                  {displayR2Buckets.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-[10px] text-muted px-1 py-4">No R2 buckets connected. Use + to add one.</p>
            )}

            {r2Err ? <p className="shrink-0 text-[10px] text-[var(--solar-orange)] px-1">{r2Err}</p> : null}

            {r2Bucket ? (
              <>
                <div className="shrink-0 flex items-center gap-1 mb-1 px-1">
                  <Search size={10} className="text-muted shrink-0" />
                  <input
                    type="search"
                    value={r2SearchQ[r2Bucket] || ''}
                    onChange={(e) => setR2SearchQ((prev) => ({ ...prev, [r2Bucket]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && void runR2Search(r2Bucket)}
                    placeholder="Search keys…"
                    className="flex-1 min-w-0 bg-[var(--bg-app)] border border-[var(--border-subtle)]/50 rounded px-1.5 py-0.5 text-[10px] outline-none"
                  />
                  <button
                    type="button"
                    className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-hover)]"
                    onClick={() => void runR2Search(r2Bucket)}
                  >
                    Go
                  </button>
                  {r2SearchOn ? (
                    <button
                      type="button"
                      className="text-[9px] text-[var(--solar-cyan)]"
                      onClick={() => clearR2Search(r2Bucket)}
                    >
                      List
                    </button>
                  ) : null}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                  {r2Loading && r2Objs.length === 0 && r2Prefs.length === 0 ? (
                    <div className="flex items-center gap-1 py-2 text-[10px] text-muted px-1">
                      <Loader2 size={12} className="animate-spin" /> Loading…
                    </div>
                  ) : null}

                  {!r2SearchOn &&
                    r2Prefs.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setR2Prefix(r2Bucket, p)}
                        className="flex items-center gap-1.5 w-full px-2 py-1 hover:bg-[var(--bg-hover)] rounded text-left"
                      >
                        <Folder size={13} className="text-[var(--solar-blue)] shrink-0" />
                        <span className="truncate">{shortR2Name(p)}</span>
                        <ChevronRight size={11} className="ml-auto text-muted shrink-0" />
                      </button>
                    ))}

                  {r2Objs.map((o) => (
                    <div
                      key={o.key}
                      className="flex items-center gap-0.5 px-2 py-1 hover:bg-[var(--bg-hover)] rounded group"
                    >
                      <button
                        type="button"
                        className="flex flex-1 min-w-0 items-center gap-1.5 text-left"
                        onClick={() => onOpenInEditor && void openR2Key(r2Bucket, o.key)}
                      >
                        <SetiFileIcon filename={o.key} size={13} />
                        <span className="truncate">{r2SearchOn ? o.key : shortR2Name(o.key)}</span>
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        className="p-0.5 opacity-0 group-hover:opacity-100 text-muted hover:text-[var(--solar-orange)] shrink-0"
                        onClick={() => void deleteR2Key(r2Bucket, o.key)}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}

                  {!r2Loading && !r2SearchOn && r2Prefs.length === 0 && r2Objs.length === 0 ? (
                    <p className="text-[10px] italic text-muted px-2 py-2">No objects at this prefix.</p>
                  ) : null}

                  {!r2SearchOn && r2ListTruncatedByBucket[r2Bucket] && r2ListCursorByBucket[r2Bucket] ? (
                    <button
                      type="button"
                      className="mt-1 w-full text-[10px] py-1.5 rounded bg-[var(--bg-hover)] text-[var(--solar-cyan)]"
                      onClick={() => loadMoreR2List(r2Bucket)}
                      disabled={r2Loading}
                    >
                      Load more…
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
);
};
