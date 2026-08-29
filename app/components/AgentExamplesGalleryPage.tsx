import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { AgentExamplesGalleryEmbed } from './AgentExamplesGalleryEmbed';

type Props = {
  onBack: () => void;
};

/** Full-screen gallery overlay (legacy route redirects to agent home tab). */
export function AgentExamplesGalleryPage({ onBack }: Props) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-[var(--scene-bg)]">
      <div
        className="shrink-0 flex items-center gap-3 px-4 border-b"
        style={{
          height: 44,
          background: 'var(--dashboard-panel)',
          borderColor: 'var(--dashboard-border)',
        }}
      >
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-[12px] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Agent home
        </button>
      </div>
      <AgentExamplesGalleryEmbed />
    </div>
  );
}
