/**
 * DrawEntryScreen — startup center for /dashboard/draw (matches Agent / Design Studio).
 * Agent Sam composer is portaled here from App.
 */
import React from 'react';
import { DrawStartupChips } from './DrawStartupChips';
import { DrawLibraryPanel } from './DrawLibraryPanel';
import '../../components/ChatAssistant/chat-startup-center.css';
import '../../styles/agentHomeGlow.css';
import './draw-entry.css';

export type DrawEntryScreenProps = {
  onOpenCanvas: () => void;
  onNewSketch: () => void;
  libraryPanelOpen: boolean;
  onLibraryPanelOpenChange: (open: boolean) => void;
  onLibrariesApply: (enabledSlugs: string[]) => void;
  onComposerHost?: (el: HTMLDivElement | null) => void;
  onMessagesHost?: (el: HTMLDivElement | null) => void;
};

export function DrawEntryScreen({
  onOpenCanvas,
  onNewSketch,
  libraryPanelOpen,
  onLibraryPanelOpenChange,
  onLibrariesApply,
  onComposerHost,
  onMessagesHost,
}: DrawEntryScreenProps) {
  return (
    <div className="draw-entry iam-chat-startup-center" role="main" aria-label="Draw">
      <div className="iam-chat-startup-stack draw-entry__stack">
        <header className="iam-chat-startup-greeting draw-entry__hero">
          <div className="draw-entry__brand" aria-hidden>
            <span className="draw-entry__brand-word">Draw</span>
          </div>
          <p className="text-[15px] font-semibold text-[var(--dashboard-text)]">What should we sketch?</p>
          <p className="text-[12px] text-[var(--dashboard-muted)] leading-relaxed max-w-sm">
            Diagrams, flowcharts, and plan maps — with Agent Sam and Excalidraw shape libraries.
          </p>
        </header>

        <div
          ref={onMessagesHost}
          className="draw-entry__messages-host"
          aria-label="Agent Sam conversation"
        />

        <div className="draw-entry__composer-wrap">
          <div className="iam-agent-home-glow iam-agent-home-glow--subtle" aria-hidden="true" />
          <div
            ref={onComposerHost}
            className="draw-entry__composer-host"
            aria-label="Agent Sam command input"
          />
        </div>

        <DrawStartupChips
          onOpenCanvas={onOpenCanvas}
          onBrowseLibraries={() => onLibraryPanelOpenChange(true)}
          onNewSketch={onNewSketch}
        />

        <DrawLibraryPanel
          open={libraryPanelOpen}
          onClose={() => onLibraryPanelOpenChange(false)}
          onApply={(slugs) => {
            onLibrariesApply(slugs);
            onOpenCanvas();
          }}
        />
      </div>
    </div>
  );
}
