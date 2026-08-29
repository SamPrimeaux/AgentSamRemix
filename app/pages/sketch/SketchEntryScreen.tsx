/**
 * Sketch entry — startup center for /dashboard/sketch.
 */
import React from 'react';
import { LayoutTemplate, PenLine, Ruler } from 'lucide-react';
import { StartupChipRow } from '../../components/shell/chat-startup/StartupChipRow';
import '../../components/ChatAssistant/chat-startup-center.css';
import '../../styles/agentHomeGlow.css';
import '../draw/draw-entry.css';

export type SketchEntryScreenProps = {
  onOpenSketch: () => void;
  onOpenLayout: () => void;
  onOpenBlueprint: () => void;
  onComposerHost?: (el: HTMLDivElement | null) => void;
  onMessagesHost?: (el: HTMLDivElement | null) => void;
};

export function SketchEntryScreen({
  onOpenSketch,
  onOpenLayout,
  onOpenBlueprint,
  onComposerHost,
  onMessagesHost,
}: SketchEntryScreenProps) {
  return (
    <div className="draw-entry iam-chat-startup-center" role="main" aria-label="Sketch">
      <div className="iam-chat-startup-stack draw-entry__stack">
        <header className="iam-chat-startup-greeting draw-entry__hero">
          <div className="draw-entry__brand" aria-hidden>
            <span className="draw-entry__brand-word">Sketch</span>
          </div>
          <p className="text-[15px] font-semibold text-[var(--dashboard-text)]">Concept, layout, or blueprint?</p>
          <p className="text-[12px] text-[var(--dashboard-muted)] leading-relaxed max-w-sm">
            Quick architectural drafts, Figma-like UI blocks, and reusable templates — refine with Agent Sam in-app.
          </p>
        </header>

        <div ref={onMessagesHost} className="draw-entry__messages-host" aria-label="Agent Sam conversation" />

        <div className="draw-entry__composer-wrap">
          <div className="iam-agent-home-glow iam-agent-home-glow--subtle" aria-hidden="true" />
          <div ref={onComposerHost} className="draw-entry__composer-host" aria-label="Agent Sam command input" />
        </div>

        <StartupChipRow
          ariaLabel="Sketch quick actions"
          chips={[
            { id: 'sketch', label: 'Sketch', icon: PenLine, onClick: onOpenSketch },
            { id: 'layout', label: 'Layout', icon: LayoutTemplate, onClick: onOpenLayout },
            { id: 'blueprint', label: 'Blueprint', icon: Ruler, onClick: onOpenBlueprint },
          ]}
        />
      </div>
    </div>
  );
}
