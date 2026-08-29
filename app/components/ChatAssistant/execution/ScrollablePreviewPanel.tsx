/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Contained scroll region for trace previews — avoids scroll chaining / page jump
 * when expanding rows (overscroll-behavior: contain; no scrollIntoView).
 */

import React from 'react';

export type ScrollablePreviewPanelProps = {
  children: React.ReactNode;
  /** Max height of the scroll box (Tailwind class or raw px). */
  className?: string;
  'aria-label'?: string;
};

export const ScrollablePreviewPanel: React.FC<ScrollablePreviewPanelProps> = ({
  children,
  className = 'max-h-[min(40vh,220px)]',
  'aria-label': ariaLabel = 'Output preview',
}) => (
  <div
    role="region"
    aria-label={ariaLabel}
    className={`overflow-auto overscroll-contain rounded-md border border-[var(--dashboard-border)]/80 bg-[var(--bg-code-pre)] text-[0.6875rem] font-mono leading-snug ${className}`}
    onWheel={(e) => e.stopPropagation()}
  >
    {children}
  </div>
);
