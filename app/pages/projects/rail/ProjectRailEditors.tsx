/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure presentational rail editor components peeled from ProjectDetailPage.tsx
 * (B2). No host state — everything is props-driven. Mechanical move only.
 */
import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Check, X } from 'lucide-react';

export type RailEditorKind = 'memory' | 'instructions' | 'cover' | 'files' | 'stats' | 'brand';

export function RailEditorModal({
  open,
  title,
  mobileTitle,
  subtitle,
  onClose,
  onSave,
  saving,
  saveLabel,
  showSave = true,
  isMobile = false,
  children,
}: {
  open: boolean;
  title: string;
  mobileTitle?: string;
  subtitle?: string;
  onClose: () => void;
  onSave?: () => void;
  saving?: boolean;
  saveLabel?: string;
  showSave?: boolean;
  isMobile?: boolean;
  children: React.ReactNode;
}) {
  if (!open) return null;

  const sheetTitle = mobileTitle || title.replace(/^Set project /i, '');

  if (isMobile) {
    return (
      <div
        className="cpd-editor-sheet-backdrop"
        role="presentation"
        onClick={onClose}
      >
        <div
          className="cpd-editor-sheet"
          role="dialog"
          aria-labelledby="cpd-editor-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="cpd-editor-sheet-grab" aria-hidden />
          <div className="cpd-editor-sheet-toolbar">
            <button
              type="button"
              className="cpd-editor-sheet-icon"
              aria-label="Close"
              disabled={saving}
              onClick={onClose}
            >
              <X size={20} strokeWidth={1.75} />
            </button>
            <h2 id="cpd-editor-title" className="cpd-editor-sheet-title">{sheetTitle}</h2>
            {showSave && onSave ? (
              <button
                type="button"
                className="cpd-editor-sheet-icon cpd-editor-sheet-icon--save"
                aria-label={saveLabel || 'Save'}
                disabled={saving}
                onClick={onSave}
              >
                <Check size={20} strokeWidth={2} />
              </button>
            ) : (
              <span className="cpd-editor-sheet-icon-spacer" aria-hidden />
            )}
          </div>
          <div className="cpd-editor-sheet-scroll">
            <div className="cpd-editor-sheet-body">{children}</div>
            {subtitle ? <p className="cpd-editor-sheet-subtitle">{subtitle}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="cpd-modal-backdrop cpd-editor-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="cpd-editor-modal"
        role="dialog"
        aria-labelledby="cpd-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="cpd-editor-title" className="cpd-editor-modal-title">{title}</h2>
        {subtitle ? <p className="cpd-editor-modal-subtitle">{subtitle}</p> : null}
        <div className="cpd-editor-modal-body">{children}</div>
        <div className="cpd-editor-modal-actions">
          <button type="button" className="cpd-btn" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          {showSave && onSave ? (
            <button
              type="button"
              className="cpd-btn cpd-btn--primary"
              disabled={saving}
              onClick={onSave}
            >
              {saving ? 'Saving…' : saveLabel || 'Save'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function RailPreviewCard({
  emptyLabel,
  preview,
  saved,
  onOpen,
}: {
  emptyLabel: string;
  preview: string;
  saved?: boolean;
  onOpen: () => void;
}) {
  const hasContent = Boolean(preview.trim());
  return (
    <button type="button" className="cpd-rail-preview" onClick={onOpen}>
      {hasContent ? (
        <p className="cpd-rail-preview-text">{preview.trim().length <= 220 ? preview.trim() : `${preview.trim().slice(0, 220).trim()}…`}</p>
      ) : (
        <p className="cpd-rail-preview-empty">{emptyLabel}</p>
      )}
      <span className="cpd-rail-preview-foot">
        {hasContent ? (saved ? 'Saved · Click to edit' : 'Unsaved · Click to edit') : 'Click to add'}
      </span>
    </button>
  );
}

export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= breakpoint);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [breakpoint]);
  return isMobile;
}

export function SkeletonRow() {
  return (
    <div className="cpd-chat-row">
      <div style={{ flex: 1 }}>
        <div className="cpd-skel" style={{ height: 14, width: '55%', marginBottom: 6 }} />
        <div className="cpd-skel" style={{ height: 11, width: '30%' }} />
      </div>
    </div>
  );
}

export function RailSection({
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
