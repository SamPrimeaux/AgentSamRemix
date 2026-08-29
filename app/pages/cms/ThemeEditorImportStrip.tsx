/**
 * Theme editor — drop Shopify .zip / .tar.gz without waiting for the iframe bundle.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Upload, FileArchive, Check, AlertCircle } from 'lucide-react';

const ACCEPT = '.zip,.tar,.tar.gz,.tgz';
const MAX_MB = 80;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isArchive(name: string) {
  const n = name.toLowerCase();
  return n.endsWith('.zip') || n.endsWith('.tar') || n.endsWith('.tar.gz') || n.endsWith('.tgz');
}

export function ThemeEditorImportStrip({
  projectSlug,
  onNavigatePath,
}: {
  projectSlug: string;
  onNavigatePath?: (path: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'inventory' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [packageId, setPackageId] = useState<string | null>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file || !isArchive(file.name)) {
        setStatus('error');
        setMessage('Use a .zip or .tar.gz theme archive');
        return;
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        setStatus('error');
        setMessage(`File must be under ${MAX_MB} MB`);
        return;
      }
      setBusy(true);
      setStatus('uploading');
      setMessage('Uploading theme…');
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('import_name', `${projectSlug} theme`);
        fd.append('project_slug', projectSlug);
        const res = await fetch(`/api/cms/liquid-imports/upload?project_slug=${encodeURIComponent(projectSlug)}`, {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        });
        const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string; message?: string };
        if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
        const id = data.id;
        if (!id) throw new Error('No package id returned');
        setPackageId(id);
        setStatus('inventory');
        setMessage('Unpacking theme (inventory only — nothing live yet)…');

        for (let i = 0; i < 45; i++) {
          await sleep(2000);
          const poll = await fetch(`/api/cms/site-packages/${encodeURIComponent(id)}/inventory`, {
            credentials: 'same-origin',
          });
          if (!poll.ok) continue;
          const inv = (await poll.json().catch(() => ({}))) as {
            ready?: boolean;
            package?: { status?: string; error_log?: string; sections_found?: number };
          };
          if (inv.package?.status === 'failed') {
            throw new Error(inv.package.error_log || 'Import failed');
          }
          if (inv.ready) {
            setStatus('ready');
            setMessage(
              `Package ready — ${inv.package?.sections_found ?? 0} sections indexed. Proceed from Imports or Agent Sam.`,
            );
            return;
          }
        }
        setStatus('ready');
        setMessage('Upload queued — open Imports to review when ready.');
      } catch (e) {
        setStatus('error');
        setMessage(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setBusy(false);
      }
    },
    [projectSlug],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) void uploadFile(f);
    },
    [uploadFile],
  );

  return (
    <div
      className="shrink-0 border-b border-[#e8e4dc] bg-white/95 backdrop-blur-sm px-3 py-2 flex items-center gap-3 z-10"
      style={{ minHeight: 44 }}
    >
      <div className="flex items-center gap-2 text-[12px] font-medium text-stone-700 shrink-0">
        <FileArchive size={14} className="text-teal-700" aria-hidden />
        Theme import
      </div>
      <label
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex-1 flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-[12px] cursor-pointer transition-colors ${
          dragOver ? 'border-teal-600 bg-teal-50 text-teal-900' : 'border-stone-300 text-stone-600 hover:border-teal-500/60 hover:bg-stone-50'
        }`}
      >
        <Upload size={14} aria-hidden />
        {busy ? 'Working…' : 'Drop Shopify .zip / .tar.gz here or tap to browse'}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadFile(f);
            e.target.value = '';
          }}
        />
      </label>
      {status !== 'idle' ? (
        <div
          className={`flex items-center gap-1.5 text-[11px] max-w-[40%] truncate shrink-0 ${
            status === 'error' ? 'text-red-600' : status === 'ready' ? 'text-teal-800' : 'text-stone-500'
          }`}
          title={message}
        >
          {status === 'error' ? <AlertCircle size={13} /> : status === 'ready' ? <Check size={13} /> : null}
          <span className="truncate">{message}</span>
        </div>
      ) : null}
      {status === 'ready' && packageId ? (
        <button
          type="button"
          className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-md bg-teal-700 text-white hover:bg-teal-800"
          onClick={() =>
            onNavigatePath?.(
              `/dashboard/cms/imports?site=${encodeURIComponent(projectSlug)}&package=${encodeURIComponent(packageId)}`,
            )
          }
        >
          Review
        </button>
      ) : null}
    </div>
  );
}

export default ThemeEditorImportStrip;
