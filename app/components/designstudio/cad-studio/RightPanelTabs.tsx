import React from 'react';
import { X } from 'lucide-react';
import type { RightPanelTab } from './cadStudioTypes';

export type RightPanelTabsProps = {
  active: RightPanelTab;
  onChange: (tab: RightPanelTab) => void;
  onClose?: () => void;
  children: React.ReactNode;
};

export function RightPanelTabs({ active, onChange, onClose, children }: RightPanelTabsProps) {
  const tabs: { id: RightPanelTab; label: string }[] = [
    { id: 'outliner', label: 'Outliner' },
    { id: 'properties', label: 'Properties' },
  ];

  return (
    <aside className="cad-editor cad-editor--right-tabs">
      <div className="cad-right-tabs__head" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            className={`cad-right-tabs__tab${active === t.id ? ' active' : ''}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
        {onClose ? (
          <button
            type="button"
            className="cad-right-tabs__close"
            onClick={onClose}
            title="Close panel"
            aria-label="Close Outliner and Properties"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      <div className="cad-right-tabs__body">{children}</div>
    </aside>
  );
}
