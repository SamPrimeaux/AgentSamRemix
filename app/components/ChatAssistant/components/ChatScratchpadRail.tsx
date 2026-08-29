import { useState, type FC } from 'react';
import {
  ChevronRight,
  Paperclip,
  FileText,
  Database,
  FileCode,
  FileJson,
  File,
  ExternalLink,
  Image,
  PanelRightClose,
  StickyNote,
} from 'lucide-react';
import type { Message, AgentGeneratedFile } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type UploadedFile = {
  key: string;
  name: string;
  type: 'image' | 'file';
  previewUrl: string | null;
};

type GeneratedFile = {
  key: string;
  file: AgentGeneratedFile;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extToKind(filename: string): AgentGeneratedFile['kind'] {
  const ext = String(filename || '').split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'md') return 'md';
  if (ext === 'sql') return 'sql';
  if (ext === 'ts' || ext === 'tsx') return 'ts';
  if (ext === 'js' || ext === 'jsx') return 'js';
  if (ext === 'json') return 'json';
  if (ext === 'txt') return 'txt';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'gif') return 'image';
  return 'other';
}

function KindIcon({ kind, size = 14 }: { kind: AgentGeneratedFile['kind']; size?: number }) {
  const cls = `text-[var(--dashboard-muted)] shrink-0`;
  switch (kind) {
    case 'md':   return <FileText size={size} className={cls} />;
    case 'sql':  return <Database size={size} className={cls} />;
    case 'ts':
    case 'js':   return <FileCode size={size} className={cls} />;
    case 'json': return <FileJson size={size} className={cls} />;
    case 'image': return <Image size={size} className={cls} />;
    default:     return <File size={size} className={cls} />;
  }
}

// ─── Section ─────────────────────────────────────────────────────────────────

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors select-none"
      >
        <ChevronRight
          size={11}
          className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        {label}
        <span className="ml-auto font-normal normal-case tracking-normal text-[10px] text-[var(--dashboard-muted)]">
          {count}
        </span>
      </button>
      {open ? <div className="pb-1">{children}</div> : null}
    </div>
  );
}

// ─── File rows ───────────────────────────────────────────────────────────────

function UploadedRow({ f }: { f: UploadedFile }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md mx-2 hover:bg-[var(--bg-hover)] group transition-colors">
      {f.previewUrl && f.type === 'image' ? (
        <img
          src={f.previewUrl}
          alt=""
          className="w-6 h-6 rounded object-cover shrink-0 border border-[var(--dashboard-border)]"
        />
      ) : f.type === 'image' ? (
        <Image size={14} className="text-[var(--dashboard-muted)] shrink-0" />
      ) : (
        <Paperclip size={14} className="text-[var(--dashboard-muted)] shrink-0" />
      )}
      <span className="truncate text-[12px] text-[var(--dashboard-text)] flex-1 min-w-0">
        {f.name}
      </span>
    </div>
  );
}

function GeneratedRow({
  g,
  onOpen,
}: {
  g: GeneratedFile;
  onOpen?: (file: AgentGeneratedFile) => void;
}) {
  const kind = g.file.kind ?? extToKind(g.file.filename);
  const isImage = kind === 'image' && Boolean(g.file.r2Url);
  const open = () => onOpen?.(g.file);
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-md mx-2 hover:bg-[var(--bg-hover)] group transition-colors ${
        onOpen ? 'cursor-pointer' : ''
      }`}
      onClick={onOpen ? open : undefined}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
              }
            }
          : undefined
      }
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
    >
      {isImage ? (
        <img
          src={g.file.r2Url}
          alt=""
          className="w-8 h-8 rounded object-cover shrink-0 border border-[var(--dashboard-border)]"
        />
      ) : (
        <KindIcon kind={kind} />
      )}
      <span className="truncate text-[12px] text-[var(--dashboard-text)] flex-1 min-w-0">
        {g.file.filename}
      </span>
      {onOpen ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          title={isImage ? 'Open image' : 'Open in editor'}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] p-0.5 rounded"
        >
          <ExternalLink size={12} />
        </button>
      ) : null}
    </div>
  );
}

// ─── Rail ────────────────────────────────────────────────────────────────────

type Props = {
  messages: Message[];
  onOpenFile?: (file: AgentGeneratedFile) => void;
  /** Close control in the rail header (desktop rail has no other obvious dismiss). */
  onClose?: () => void;
};

export const ChatScratchpadRail: FC<Props> = ({ messages, onOpenFile, onClose }) => {
  const uploaded: UploadedFile[] = messages.flatMap((m, mi) =>
    (m.attachmentPreviews ?? []).map((a, ai) => ({
      key: `up-${mi}-${ai}`,
      name: a.name,
      type: a.type as 'image' | 'file',
      previewUrl: a.previewUrl,
    })),
  );

  const generated: GeneratedFile[] = messages.flatMap((m, mi) => {
    const fromAgent = (m.agentFiles ?? []).map((f, fi) => ({
      key: `gen-${mi}-${fi}`,
      file: f,
    }));
    if (fromAgent.length) return fromAgent;
    // Fallback: derive from image card frames when stamp path missed a slot.
    const frames = (m.imageGenerationState?.previewFrames ?? []).filter((f) => f.previewUrl);
    return frames.map((f, fi) => {
      const path = String(f.previewUrl || '').split('?')[0];
      const match = path.match(/\.(png|jpe?g|webp|gif|svg)$/i);
      const ext = match ? (match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()) : 'png';
      const filename = `variation-${f.frameIndex + 1}.${ext}`;
      return {
        key: `ig-${mi}-${fi}`,
        file: {
          filename,
          r2Url: f.previewUrl,
          workspacePath: `images/${filename}`,
          kind: 'image' as const,
        },
      };
    });
  });

  const empty = uploaded.length === 0 && generated.length === 0;

  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-[var(--dashboard-panel)] border-l border-[var(--dashboard-border)]">
      {/* Rail header */}
      <div className="flex items-center gap-2 px-3 h-9 min-h-9 shrink-0 border-b border-[var(--dashboard-border)]">
        <StickyNote size={13} className="text-[var(--dashboard-muted)] shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--dashboard-muted)] truncate flex-1">
          Scratchpad
        </span>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)] transition-colors"
            title="Close scratchpad"
            aria-label="Close scratchpad"
          >
            <PanelRightClose size={14} strokeWidth={1.75} />
          </button>
        ) : null}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto py-2 chat-hide-scroll">
        {empty ? (
          <div className="px-3 py-4 text-center">
            <StickyNote size={20} className="mx-auto mb-2 text-[var(--dashboard-muted)] opacity-40" />
            <p className="text-[11px] text-[var(--dashboard-muted)] leading-relaxed">
              Files you attach or Agent Sam creates will appear here.
            </p>
          </div>
        ) : (
          <>
            {uploaded.length > 0 && (
              <Section label="Attachments" count={uploaded.length}>
                {uploaded.map((f) => (
                  <UploadedRow key={f.key} f={f} />
                ))}
              </Section>
            )}
            {generated.length > 0 && (
              <Section label="Agent output" count={generated.length}>
                {generated.map((g) => (
                  <GeneratedRow key={g.key} g={g} onOpen={onOpenFile} />
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
};
