/** Small chrome leaves peeled from App.tsx (Wave 2 E1). */
import React from 'react';
import { X as XIcon } from 'lucide-react';

export type LucideLike = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

export const MobileMoreRow: React.FC<{ icon: LucideLike; label: string; onClick: () => void }> = ({ icon: Icon, label, onClick }) => (
  <button
    type="button"
    className="flex w-full items-center gap-3 min-h-[44px] rounded-lg px-3 text-left text-[13px] text-main hover:bg-[var(--bg-hover)] transition-colors border border-transparent hover:border-[var(--dashboard-border)]"
    onClick={onClick}
  >
    <Icon size={20} strokeWidth={1.5} className="shrink-0 text-muted" />
    <span>{label}</span>
  </button>
);

export const Tab: React.FC<{ title: React.ReactNode, icon: React.ReactNode, active: boolean, onClick: () => void, onClose?: (e: React.MouseEvent) => void }> = ({ title, icon, active, onClick, onClose }) => (
    <div 
        onClick={onClick}
        className={`h-full flex items-center gap-1.5 pl-3 pr-2 text-[12px] select-none cursor-pointer border-r border-[var(--dashboard-border)] relative group whitespace-nowrap shrink-0 ${
            active 
                ? 'bg-[var(--dashboard-canvas)] text-[var(--solar-cyan)]' 
                : 'bg-[var(--dashboard-panel)] text-muted hover:bg-[var(--bg-hover)]'
        }`}
    >
        {active && <div className="absolute top-0 left-0 right-0 h-[2px] bg-[var(--solar-cyan)]" />}
        {icon}
        <span className="max-w-[120px] truncate">{title}</span>
        {onClose && (
            <button
                onClick={onClose}
                className={`ml-1 p-0.5 rounded transition-all hover:bg-[var(--solar-red)]/20 hover:text-[var(--solar-red)] ${
                    active ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-50 hover:!opacity-100'
                }`}
                title="Close tab"
            >
                <XIcon size={11} />
            </button>
        )}
        {!active && <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-[var(--dashboard-border)]" />}
    </div>
);

export const QuickOpen: React.FC<{ label: string, onClick: () => void }> = ({ label, onClick }) => (
    <button
        onClick={onClick}
        className="text-[10px] px-2 py-0.5 rounded text-muted hover:text-[var(--solar-cyan)] hover:bg-[var(--bg-hover)] transition-colors border border-transparent hover:border-[var(--dashboard-border)] font-sans"
        title={`Open ${label}`}
    >
        + {label}
    </button>
);
