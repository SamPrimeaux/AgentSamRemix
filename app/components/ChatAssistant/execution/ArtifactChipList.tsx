/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { AgentPreviewArtifact } from '../types';
import type { ArtifactChipListProps } from './types';

export const ArtifactChipList: React.FC<ArtifactChipListProps> = ({
  artifacts,
  onOpenArtifact,
  onOpenImageUrl,
}) => {
  if (!artifacts.length) return null;
  const extFor = (a: AgentPreviewArtifact) =>
    a.kind === 'sql' ? 'sql' : a.kind === 'diff' ? 'diff' : a.language || 'txt';

  return (
    <div className="mb-2 flex flex-wrap gap-2" aria-label="Generated artifacts">
      {artifacts.map((a) =>
        a.kind === 'image' && a.imageUrl ? (
          <button
            key={a.id}
            type="button"
            onClick={() =>
              onOpenImageUrl
                ? onOpenImageUrl(a.imageUrl!)
                : window.open(a.imageUrl, '_blank', 'noopener,noreferrer')
            }
            className="group relative overflow-hidden rounded-lg border border-[var(--dashboard-border)] bg-[var(--scene-bg)] max-h-28 max-w-[160px]"
            title={a.title || 'Image preview'}
          >
            <img src={a.imageUrl} alt="" className="max-h-28 w-full object-contain" />
          </button>
        ) : (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpenArtifact(a)}
            className="rounded-lg border border-[var(--dashboard-border)]/90 bg-[var(--scene-bg)]/90 px-2.5 py-1.5 text-[11px] font-medium text-[var(--dashboard-muted)] hover:border-[var(--solar-cyan)]/35 hover:text-[var(--solar-cyan)]"
            title={a.title || a.kind}
          >
            {a.title || `${a.kind} · ${extFor(a)}`}
          </button>
        ),
      )}
    </div>
  );
};
