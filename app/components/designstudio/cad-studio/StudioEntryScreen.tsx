/**
 * StudioEntryScreen — Design Studio startup center (matches /dashboard/agent layout).
 * Agent Sam composer is portaled here from App (same pattern as AgentHome).
 */
import React, { useRef, useState } from 'react';
import { Loader2, LayoutGrid } from 'lucide-react';
import { StudioEntryGallery } from './StudioEntryGallery';
import { StudioStartupChips } from './StudioStartupChips';
import '../../../components/ChatAssistant/chat-startup-center.css';
import '../../../styles/agentHomeGlow.css';
import './cad-studio.css';

export type StudioEntryScreenProps = {
  onOpenStudio: () => void;
  onImportGlb?: (file: File) => void;
  generating?: boolean;
  progressPct?: number;
  statusLabel?: string;
  error?: string | null;
  /** Full studio bundle is loading after user chose to enter. */
  mode?: 'idle' | 'generating' | 'loading-studio';
  /** Latest generation finished on the entry screen. */
  jobReady?: boolean;
  onSpawnStock?: (name: string, url: string, scale: number) => void;
  onCancelJob?: (cadJobId: string) => void;
  onLoadBimExample?: () => void;
  activeProgressPct?: number;
  activeJobId?: string | null;
  onComposerHost?: (el: HTMLDivElement | null) => void;
  onMessagesHost?: (el: HTMLDivElement | null) => void;
};

export function StudioEntryScreen({
  onOpenStudio,
  onImportGlb,
  generating = false,
  progressPct = 0,
  statusLabel,
  error,
  mode = 'idle',
  jobReady = false,
  onSpawnStock,
  onCancelJob,
  onLoadBimExample,
  activeProgressPct,
  activeJobId,
  onComposerHost,
  onMessagesHost,
}: StudioEntryScreenProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const busy = generating || mode === 'loading-studio';

  return (
    <div className="studio-entry iam-chat-startup-center" role="main" aria-label="Design Studio">
      <div className="iam-chat-startup-stack studio-entry__stack">
        <header className="iam-chat-startup-greeting studio-entry__hero">
          <div className="studio-entry__brand" aria-hidden>
            <span className="studio-entry__brand-word">Design</span>
            <span className="studio-entry__brand-word studio-entry__brand-word--accent">Studio</span>
          </div>
          <p className="text-[15px] font-semibold text-[var(--dashboard-text)]">What should we build?</p>
          <p className="text-[12px] text-[var(--dashboard-muted)] leading-relaxed max-w-sm">
            Describe a model, import a GLB, or open the editor to get started.
          </p>
        </header>

        <div
          ref={onMessagesHost}
          className="studio-entry__messages-host"
          aria-label="Agent Sam conversation"
        />

        <div className="studio-entry__composer-wrap">
          <div className="iam-agent-home-glow iam-agent-home-glow--subtle" aria-hidden="true" />
          <div
            ref={onComposerHost}
            className="studio-entry__composer-host"
            aria-label="Agent Sam command input"
          />
        </div>

        <StudioStartupChips
          disabled={busy}
          onOpenStudio={onOpenStudio}
          onImportGlb={() => fileRef.current?.click()}
          onBrowseLibrary={() => setLibraryOpen(true)}
          onLoadBimExample={onLoadBimExample}
        />

        <input
          ref={fileRef}
          type="file"
          accept=".glb"
          className="studio-entry__file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportGlb?.(file);
            e.target.value = '';
          }}
        />

        {(error || statusLabel || jobReady) ? (
          <div className="studio-entry__feedback">
            {error ? <p className="studio-entry__error">{error}</p> : null}
            {statusLabel ? (
              <div className="studio-entry__status">
                {busy ? <Loader2 size={13} className="studio-entry__spin" aria-hidden /> : null}
                <span>{statusLabel}</span>
                {generating && progressPct > 0 ? (
                  <div className="studio-entry__progress">
                    <div
                      className="studio-entry__progress-fill"
                      style={{ width: `${Math.min(100, progressPct)}%` }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            {jobReady ? (
              <button type="button" className="iam-chat-startup-chip" onClick={onOpenStudio}>
                <LayoutGrid size={14} aria-hidden />
                View in full studio
              </button>
            ) : null}
          </div>
        ) : null}

        <StudioEntryGallery
          libraryOpen={libraryOpen}
          onLibraryOpenChange={setLibraryOpen}
          onSpawnStock={onSpawnStock}
          onCancelJob={onCancelJob}
          generating={generating}
          activeJobLabel={statusLabel}
          activeProgressPct={activeProgressPct ?? progressPct}
          activeJobId={activeJobId}
        />
      </div>
    </div>
  );
}
