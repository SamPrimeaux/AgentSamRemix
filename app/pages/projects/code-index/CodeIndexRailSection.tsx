/** Collapsible rail section used by CodeIndexPanel (B1). */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function CodeIndexRailSection({
  title,
  badge,
  action,
  children,
  defaultOpen = true,
}: {
  title: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="cpd-rail-section">
      <div className="cpd-rail-section-header">
        <button
          type="button"
          className="cpd-rail-section-title"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {title}
          {badge}
          <span className="cpd-rail-chevron" aria-hidden>
            {open ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}
          </span>
        </button>
        {action ? (
          <div className="cpd-rail-section-action" onClick={(e) => e.stopPropagation()}>
            {action}
          </div>
        ) : null}
      </div>
      {open ? <div className="cpd-rail-section-body">{children}</div> : null}
    </div>
  );
}
