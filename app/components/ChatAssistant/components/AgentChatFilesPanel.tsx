import type { FC } from 'react';
import {
  FileText,
  Database,
  FileCode,
  FileJson,
  File,
  Paperclip,
  ExternalLink,
  Plus,
  X,
  Image,
} from 'lucide-react';
import type { Message, AgentGeneratedFile } from '../types';

type Props = {
  messages: Message[];
  stagedCount: number;
  onAttach: () => void;
  onClose: () => void;
  onOpenFile?: (file: AgentGeneratedFile) => void;
};

function KindIcon({ kind, className }: { kind: AgentGeneratedFile['kind']; className?: string }) {
  const cls = className ?? 'w-4 h-4 text-[var(--dashboard-muted)]';
  switch (kind) {
    case 'md':  return <FileText className={cls} />;
    case 'sql': return <Database className={cls} />;
    case 'ts':
    case 'js':  return <FileCode className={cls} />;
    case 'json': return <FileJson className={cls} />;
    case 'image': return <Image className={cls} />;
    default:    return <File className={cls} />;
  }
}

function extToKind(filename: string): AgentGeneratedFile['kind'] {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'md') return 'md';
  if (ext === 'sql') return 'sql';
  if (ext === 'ts' || ext === 'tsx') return 'ts';
  if (ext === 'js' || ext === 'jsx') return 'js';
  if (ext === 'json') return 'json';
  if (ext === 'txt') return 'txt';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'gif') return 'image';
  return 'other';
}

export const AgentChatFilesPanel: FC<Props> = ({ messages, stagedCount, onAttach, onClose, onOpenFile }) => {
  const uploaded = messages.flatMap((m, mi) =>
    (m.attachmentPreviews || []).map((a, ai) => ({
      key: `up-${mi}-${ai}`,
      name: a.name,
      type: a.type as 'image' | 'file',
      previewUrl: a.previewUrl,
    }))
  );

  const generated = messages.flatMap((m, mi) =>
    (m.agentFiles || []).map((f, fi) => ({
      key: `gen-${mi}-${fi}`,
      file: f,
    }))
  );

  const empty = uploaded.length === 0 && generated.length === 0 && stagedCount === 0;

  return (
    <div className="border-b border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-3 py-2 max-h-[min(40vh,320px)] overflow-y-auto chat-hide-scroll">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)]">
          Chat files
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onAttach}
            className="flex items-center gap-1 text-[11px] font-medium text-[var(--solar-cyan)] hover:underline">
            <Plus className="w-3 h-3" />
            Add file
          </button>
          <button type="button" onClick={onClose}
            className="text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Staged badge */}
      {stagedCount > 0 && (
        <p className="text-[11px] text-[var(--dashboard-muted)] mb-2">
          {stagedCount} file{stagedCount === 1 ? '' : 's'} staged — send to attach.
        </p>
      )}

      {empty ? (
        <p className="text-[12px] text-[var(--dashboard-muted)]">
          No files yet. Attach files in the composer or ask Agent Sam to create one.
        </p>
      ) : (
        <ul className="space-y-1">
          {/* Uploaded attachments */}
          {uploaded.map((f) => (
            <li key={f.key}
              className="flex items-center gap-2 rounded-md border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]/60 px-2 py-1.5">
              {f.previewUrl && f.type === 'image' ? (
                <img src={f.previewUrl} alt="" className="w-7 h-7 rounded object-cover shrink-0" />
              ) : (
                <div className="w-7 h-7 rounded bg-[var(--bg-hover)] flex items-center justify-center shrink-0">
                  <Paperclip className="w-3.5 h-3.5 text-[var(--dashboard-muted)]" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-[var(--dashboard-text)]">{f.name}</p>
                <p className="text-[10px] text-[var(--dashboard-muted)]">Attached</p>
              </div>
            </li>
          ))}

          {/* Agent-generated files */}
          {generated.map(({ key, file }) => {
            const kind = file.kind ?? extToKind(file.filename);
            const isImage = kind === 'image' && Boolean(file.r2Url);
            return (
              <li key={key}
                className="flex items-center gap-2 rounded-md border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]/60 px-2 py-1.5 group">
                {isImage ? (
                  <img
                    src={file.r2Url}
                    alt=""
                    className="w-7 h-7 rounded object-cover shrink-0 border border-[var(--dashboard-border)]"
                  />
                ) : (
                  <div className="w-7 h-7 rounded bg-[var(--bg-hover)] flex items-center justify-center shrink-0">
                    <KindIcon kind={kind} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] text-[var(--dashboard-text)] font-medium">
                    {file.filename}
                  </p>
                  <p className="text-[10px] text-[var(--dashboard-muted)]">
                    {file.staged
                      ? file.stagedUpdated
                        ? 'Staged (updated) — not shipped'
                        : 'Staged — not shipped'
                      : isImage
                        ? 'Generated image'
                        : 'Agent output'}
                  </p>
                </div>
                {onOpenFile && (
                  <button
                    type="button"
                    onClick={() => onOpenFile(file)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] p-0.5 rounded"
                    title={isImage ? 'Open image' : 'Open in editor'}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
