import React from 'react';
import { Download, Trash2 } from 'lucide-react';

export type ImageBatchBarProps = {
  selectedCount: number;
  onExport: () => void;
  onDelete: () => void;
  exportDisabled?: boolean;
  deleteDisabled?: boolean;
  disabled?: boolean;
};

export function ImageBatchBar({
  selectedCount,
  onExport,
  onDelete,
  exportDisabled,
  deleteDisabled,
  disabled,
}: ImageBatchBarProps) {
  if (selectedCount <= 0) return null;

  const baseBtn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 12px',
    borderRadius: 8,
    border: '1px solid var(--border-subtle)',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '10px 14px',
        borderRadius: 10,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        marginBottom: 12,
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 4 }}>
        {selectedCount} selected
      </span>
      <button
        type="button"
        disabled={disabled || exportDisabled}
        onClick={onExport}
        style={{
          ...baseBtn,
          background: 'var(--bg-panel)',
          color: 'var(--text-main)',
          opacity: disabled || exportDisabled ? 0.45 : 1,
          cursor: disabled || exportDisabled ? 'not-allowed' : 'pointer',
        }}
      >
        <Download size={13} />
        Export
      </button>
      <button
        type="button"
        disabled={disabled || deleteDisabled}
        onClick={onDelete}
        style={{
          ...baseBtn,
          background: 'color-mix(in srgb, #f87171 12%, var(--bg-panel))',
          color: '#f87171',
          borderColor: 'color-mix(in srgb, #f87171 35%, var(--border-subtle))',
          opacity: disabled || deleteDisabled ? 0.45 : 1,
          cursor: disabled || deleteDisabled ? 'not-allowed' : 'pointer',
        }}
      >
        <Trash2 size={13} />
        Delete
      </button>
    </div>
  );
}

export default ImageBatchBar;
