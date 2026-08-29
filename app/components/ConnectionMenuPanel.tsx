import React, { useMemo, useRef, useState, useEffect } from 'react';
import { ShellDropdownLinkRow, ShellDropdownPanel, ShellDropdownRow } from './ShellDropdownPanel';

export const LOCAL_PTY_HOST = 'localpty.inneranimalmedia.com';
export const CLOUD_TERMINAL_HOST = 'terminal.inneranimalmedia.com';

export type ConnectionMenuAction =
  | 'local_pty'
  | 'cloud_terminal'
  | 'gcp_vm'
  | 'ssh_config'
  | 'pty_setup_wizard'
  | 'configure_terminal';

export type ConnectionMenuPanelProps = {
  open: boolean;
  onClose: () => void;
  onAction: (action: ConnectionMenuAction) => void;
  variant?: 'floating' | 'anchored';
  className?: string;
};

type Row = {
  label: string;
  hint?: string;
  badge?: string;
  action: ConnectionMenuAction;
  isLink?: boolean;
  href?: string;
};

const MAIN_ROWS: Row[] = [
  { label: 'Connect to Local PTY…', hint: LOCAL_PTY_HOST, action: 'local_pty' },
  { label: 'Connect to Cloud Terminal…', hint: CLOUD_TERMINAL_HOST, action: 'cloud_terminal' },
  { label: 'Connect to GCP VM…', hint: 'Remote-SSH', badge: 'Remote-SSH', action: 'gcp_vm' },
  { label: 'Open SSH Configuration…', action: 'ssh_config', isLink: true, href: '/dashboard/settings/network' },
];

const FOOTER_ROWS: Row[] = [
  { label: 'PTY Setup Wizard', action: 'pty_setup_wizard' },
  { label: 'Configure Terminal Settings', action: 'configure_terminal' },
];

export function ConnectionMenuPanel({
  open,
  onClose,
  onAction,
  variant = 'floating',
  className = '',
}: ConnectionMenuPanelProps) {
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!filter.trim()) return MAIN_ROWS;
    const q = filter.toLowerCase();
    return MAIN_ROWS.filter(
      (r) => r.label.toLowerCase().includes(q) || r.hint?.toLowerCase().includes(q),
    );
  }, [filter]);

  useEffect(() => {
    if (open) {
      setFilter('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (active >= filtered.length) setActive(Math.max(0, filtered.length - 1));
  }, [filtered, active]);

  if (!open) return null;

  const run = (action: ConnectionMenuAction) => {
    onAction(action);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = filtered[active];
      if (row) run(row.action);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <ShellDropdownPanel
      variant={variant}
      className={className}
      title="Select a connection option"
      aria-label="Terminal connection options"
      footer={
        <>
          <div className="px-3 py-1.5 text-[10px] text-muted border-b border-[var(--border-subtle)]/30 flex items-center gap-3">
            <span>↑↓ to navigate</span>
            <span>↵ to select</span>
          </div>
          {FOOTER_ROWS.map((row) => (
            <ShellDropdownRow
              key={row.action}
              label={row.label}
              onClick={() => run(row.action)}
            />
          ))}
        </>
      }
    >
      <div className="px-2 pt-2 pb-1 shrink-0 border-b border-[var(--border-subtle)]/30">
        <input
          ref={inputRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Filter connections…"
          className="w-full bg-transparent text-[0.6875rem] text-main placeholder:text-muted outline-none px-1 py-1 font-[var(--font-sans)]"
        />
      </div>
      <div className="py-1 overflow-y-auto flex-1 min-h-0">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-[0.6875rem] text-muted text-center">
            No matches
          </div>
        ) : (
          filtered.map((row, i) =>
            row.isLink && row.href ? (
              <ShellDropdownLinkRow
                key={row.action}
                label={row.label}
                href={row.href}
                onNavigate={() => onClose()}
              />
            ) : (
              <div
                key={row.action}
                className={i === active ? 'bg-[var(--bg-hover)]' : ''}
              >
                <ShellDropdownRow
                  label={row.label}
                  hint={row.hint}
                  badge={row.badge}
                  onClick={() => run(row.action)}
                />
              </div>
            ),
          )
        )}
      </div>
    </ShellDropdownPanel>
  );
}
