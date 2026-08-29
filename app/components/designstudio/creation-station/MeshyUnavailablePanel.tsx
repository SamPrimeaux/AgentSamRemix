/**
 * Placeholder for Meshy rail tools that are not yet wired to Worker routes.
 * Not an error state — intentional "coming soon" copy until API handlers ship.
 */
import React from 'react';

type Props = {
  title: string;
  body: string;
};

export function MeshyUnavailablePanel({ title, body }: Props) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold text-main">{title}</p>
      <div
        className="rounded-xl p-4 text-[12px] leading-relaxed text-muted"
        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}
      >
        {body}
      </div>
    </div>
  );
}
