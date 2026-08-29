/**
 * CMS hub — drag-and-drop theme import (Shopify .zip / .tar.gz).
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

export function CmsHubImportStrip({
  projectSlug,
  onReady,
  compact = false,
}: {
  projectSlug: string;
  onReady?: (packageId: string) => void;
  /** Footreprint under Active Site card — drop zone still works. */
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'inventory' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState('');

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
        setStatus('inventory');
        setMessage('Unpacking theme — nothing goes live until you review…');

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
            setMessage(`Ready — ${inv.package?.sections_found ?? 0} sections indexed. Open theme editor to apply.`);
            onReady?.(id);
            return;
          }
        }
        setStatus('ready');
        setMessage('Upload queued — open theme editor when inventory finishes.');
        onReady?.(id);
      } catch (e) {
        setStatus('error');
        setMessage(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setBusy(false);
      }
    },
    [projectSlug, onReady],
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
    <section
      className={`iam-cms-import-strip${compact ? ' iam-cms-import-strip--compact' : ''}`}
      aria-label="Theme import"
    >
      {!compact ? (
        <div className="iam-cms-import-strip__label">
          <FileArchive size={15} aria-hidden />
          Import theme
        </div>
      ) : null}
      <label
        className={`iam-cms-import-strip__drop${dragOver ? ' is-dragover' : ''}${busy ? ' is-busy' : ''}`}
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
      >
        <Upload size={15} aria-hidden />
        {busy
          ? 'Working…'
          : compact
            ? 'Import theme (.zip)'
            : 'Drop Shopify .zip / .tar.gz here or tap to browse'}
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
          className={`iam-cms-import-strip__status${status === 'error' ? ' is-error' : status === 'ready' ? ' is-ok' : ''}`}
          title={message}
        >
          {status === 'error' ? <AlertCircle size={13} /> : status === 'ready' ? <Check size={13} /> : null}
          <span>{message}</span>
        </div>
      ) : null}
    </section>
  );
}

export default CmsHubImportStrip;
