import { MoreHorizontal, MessageSquare, Code2, ExternalLink } from 'lucide-react';
import type { ArtifactRecord } from '../../client-api/artifacts';
import { relativeTime } from '../settings/settingsUi';
import { ArtifactTypeIcon } from './ArtifactTypeIcon';
import { continueArtifactInChat, isCodeArtifact, openArtifactInBuilder } from '../../lib/artifactChat';

type Props = {
  artifact: ArtifactRecord;
  onDetails: () => void;
};

export function ArtifactHomeCard({ artifact, onDetails }: Props) {
  const thumb = artifact.thumbnail_url || artifact.preview_url;
  const edited = artifact.updated_at_display || artifact.updated_at;
  const isCode = isCodeArtifact(artifact);

  const handlePrimaryClick = () => {
    if (isCode) {
      openArtifactInBuilder(artifact);
    } else {
      continueArtifactInChat(artifact);
    }
  };

  const handleContinueInChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    continueArtifactInChat(artifact);
  };

  const handleOpenInBuilder = (e: React.MouseEvent) => {
    e.stopPropagation();
    openArtifactInBuilder(artifact);
  };

  const handleOpenPublic = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = artifact.public_url || artifact.preview_url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="iam-artifact-home-card group relative w-full rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] overflow-hidden transition-colors hover:border-[color-mix(in_srgb,var(--solar-cyan)_35%,var(--dashboard-border))]">
      {/* Thumbnail — clickable, takes primary action */}
      <button
        type="button"
        onClick={handlePrimaryClick}
        className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--solar-cyan)] focus-visible:ring-inset touch-manipulation"
        aria-label={`${isCode ? 'Open in builder' : 'Continue in chat'}: ${artifact.name}`}
      >
        <div className="aspect-[16/10] w-full bg-[var(--dashboard-canvas)] border-b border-[var(--dashboard-border)]/80 overflow-hidden relative">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              className="h-full w-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
              loading="lazy"
            />
          ) : (
            <ArtifactTypeIcon artifact={artifact} className="h-full w-full" />
          )}

          {/* Hover overlay — quick action buttons */}
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
            <button
              type="button"
              onClick={handleContinueInChat}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--dashboard-panel)] border border-[var(--dashboard-border)] text-[var(--text-primary)] text-xs font-medium hover:bg-[var(--bg-hover)] transition-colors"
              title="Continue in chat"
            >
              <MessageSquare size={13} /> Chat
            </button>
            {isCode ? (
              <button
                type="button"
                onClick={handleOpenInBuilder}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--dashboard-panel)] border border-[color-mix(in_srgb,var(--solar-cyan)_40%,var(--dashboard-border))] text-[var(--solar-cyan)] text-xs font-medium hover:bg-[var(--bg-hover)] transition-colors"
                title="Open in builder"
              >
                <Code2 size={13} /> Builder
              </button>
            ) : null}
            {artifact.public_url || artifact.preview_url ? (
              <button
                type="button"
                onClick={handleOpenPublic}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--dashboard-panel)] border border-[var(--dashboard-border)] text-muted text-xs font-medium hover:bg-[var(--bg-hover)] transition-colors"
                title="Open URL"
              >
                <ExternalLink size={13} />
              </button>
            ) : null}
          </div>
        </div>
      </button>

      {/* Card footer */}
      <div className="flex items-start justify-between gap-2 p-3.5 sm:p-4 min-w-0">
        <button
          type="button"
          onClick={handlePrimaryClick}
          className="min-w-0 flex-1 text-left focus:outline-none touch-manipulation"
        >
          <div className="text-sm font-medium text-[var(--text-primary)] leading-snug line-clamp-2">
            {artifact.name}
          </div>
          <div className="mt-1 text-xs text-muted">
            {edited ? relativeTime(edited) : 'No date'}
          </div>
        </button>

        {/* Details overflow */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDetails(); }}
          className="shrink-0 p-1 -mr-1 rounded-md text-muted hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          title="Details"
          aria-label="View artifact details"
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  );
}
