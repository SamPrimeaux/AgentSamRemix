import React, { useEffect } from 'react';
import { Download, ExternalLink, FileWarning } from 'lucide-react';
import type { FileKind } from '../lib/fileKind';

export type FilePreviewProps = {
  kind: FileKind;
  name: string;
  url: string;
  contentType?: string | null;
  size?: number | null;
  message?: string | null;
  onRevokeObjectUrl?: () => void;
};

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

function PreviewShell({
  name,
  contentType,
  size,
  children,
}: {
  name: string;
  contentType?: string | null;
  size?: number | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full w-full bg-[var(--scene-bg)]">
      <div className="h-8 flex items-center justify-between px-3 border-b border-[var(--dashboard-border)] shrink-0 text-[10px] uppercase tracking-widest text-muted">
        <span className="truncate font-mono">{name}</span>
        <span className="opacity-60 shrink-0 ml-2">
          {contentType || 'media'} · {formatBytes(size)}
        </span>
      </div>
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

export const FilePreview: React.FC<FilePreviewProps> = ({
  kind,
  name,
  url,
  contentType,
  size,
  message,
  onRevokeObjectUrl,
}) => {
  useEffect(() => {
    return () => {
      onRevokeObjectUrl?.();
    };
  }, [onRevokeObjectUrl]);

  const hasUrl = Boolean(url?.trim());

  const openExternal = () => {
    if (!hasUrl) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const download = () => {
    if (!hasUrl) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (kind === 'image') {
    return (
      <PreviewShell name={name} contentType={contentType} size={size}>
        <div className="flex-1 flex items-center justify-center p-6 min-h-0 overflow-auto">
          <img
            src={url}
            alt={name}
            className="max-w-full max-h-full object-contain rounded border border-[var(--dashboard-border)] shadow-lg"
          />
        </div>
      </PreviewShell>
    );
  }

  if (kind === 'video') {
    return (
      <PreviewShell name={name} contentType={contentType} size={size}>
        <div className="flex-1 flex items-center justify-center p-6 min-h-0">
          <video
            src={url}
            controls
            preload="metadata"
            className="max-w-full max-h-full rounded border border-[var(--dashboard-border)] bg-black"
          />
        </div>
      </PreviewShell>
    );
  }

  if (kind === 'audio') {
    return (
      <PreviewShell name={name} contentType={contentType} size={size}>
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
          <audio src={url} controls preload="metadata" className="w-full max-w-lg" />
        </div>
      </PreviewShell>
    );
  }

  if (kind === 'pdf') {
    return (
      <PreviewShell name={name} contentType={contentType} size={size}>
        <iframe
          src={url}
          title={name}
          className="flex-1 w-full min-h-0 border-0 bg-[var(--dashboard-panel)]"
        />
      </PreviewShell>
    );
  }

  return (
    <PreviewShell name={name} contentType={contentType} size={size}>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md w-full rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] p-6 text-center space-y-4">
          <FileWarning size={40} className="mx-auto text-[var(--solar-yellow)] opacity-80" />
          <h3 className="text-sm font-semibold text-[var(--solar-base0)] truncate">{name}</h3>
          <p className="text-xs text-muted">
            {message || 'Binary file — preview not available in the editor.'}
          </p>
          <dl className="text-left text-[11px] text-muted space-y-1 font-mono">
            <div>
              <dt className="inline opacity-60">Type: </dt>
              <dd className="inline">{contentType || 'unknown'}</dd>
            </div>
            <div>
              <dt className="inline opacity-60">Size: </dt>
              <dd className="inline">{formatBytes(size)}</dd>
            </div>
          </dl>
          {hasUrl ? (
            <div className="flex gap-2 justify-center pt-2">
              <button
                type="button"
                onClick={download}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-[var(--dashboard-border)] hover:border-[var(--solar-cyan)]"
              >
                <Download size={14} />
                Download
              </button>
              <button
                type="button"
                onClick={openExternal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[var(--solar-cyan)] text-black font-semibold"
              >
                <ExternalLink size={14} />
                Open
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </PreviewShell>
  );
};
