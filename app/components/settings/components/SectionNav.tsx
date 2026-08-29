import React from 'react';
import type { NavSectionItem } from '../types';

export type SectionNavProps = {
  sections: NavSectionItem[];
  activeSection: string;
  onSelect: (id: string) => void;
  collapsed?: boolean;
};

export function SectionNav({
  sections,
  activeSection,
  onSelect,
  collapsed = false,
}: SectionNavProps) {
  return (
    <div className="flex-1 overflow-y-auto py-1 custom-scrollbar">
      {sections.map((item) => (
        <button
          key={item.id}
          type="button"
          title={item.id}
          onClick={() => onSelect(item.id)}
          className={`w-full flex items-center text-[12px] transition-colors text-left ${
            collapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-3 py-2'
          } ${
            activeSection === item.id
              ? collapsed
                ? 'text-[var(--solar-cyan)] bg-[var(--solar-cyan)]/10'
                : 'bg-[var(--solar-cyan)]/10 text-[var(--solar-cyan)] border-r-2 border-[var(--solar-cyan)]'
              : 'text-muted hover:text-main hover:bg-[var(--bg-hover)]'
          }`}
        >
          <span className="shrink-0">{item.icon}</span>
          {!collapsed ? item.id : null}
        </button>
      ))}
    </div>
  );
}
