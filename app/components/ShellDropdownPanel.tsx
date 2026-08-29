import React from 'react';

/** Uniform shell dropdown width — matches Cursor quick-input-widget (600px). */
export const SHELL_DROPDOWN_WIDTH_PX = 600;
export const SHELL_DROPDOWN_LIST_MAX_HEIGHT_PX = 440;
export const SHELL_DROPDOWN_MAX_HEIGHT = 'min(520px, 70vh)';
export const SHELL_DROPDOWN_RADIUS_PX = 6;

type ShellDropdownPanelProps = {
  title?: React.ReactNode;
  /** Rich header content (search input, chips, etc). Takes precedence over `title` when both are set — renders without title's text-truncation wrapper so inputs/chips lay out normally. */
  header?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** `floating` = App portal; `anchored` = absolute under trigger, flush, no gap */
  variant?: 'floating' | 'anchored';
  className?: string;
  role?: string;
  'aria-label'?: string;
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Merged over the panel's default surface styles — e.g. mobile background opacity override. */
  style?: React.CSSProperties;
};

export const ShellDropdownPanel = React.forwardRef<HTMLDivElement, ShellDropdownPanelProps>(
  function ShellDropdownPanel(
    {
      title,
      header,
      children,
      footer,
      variant = 'floating',
      className = '',
      role = 'dialog',
      'aria-label': ariaLabel,
      onMouseDown,
      style,
    },
    ref,
  ) {
    const position = variant === 'anchored' ? 'absolute top-full left-0 z-[70]' : '';
    const radius =
      variant === 'anchored'
        ? 'rounded-b-[var(--shell-dropdown-radius,6px)] rounded-t-none'
        : 'rounded-[var(--shell-dropdown-radius,6px)]';

    return (
      <div
        ref={ref}
        role={role}
        aria-label={ariaLabel}
        onMouseDown={onMouseDown}
        className={`iam-shell-dropdown flex flex-col overflow-hidden shadow-2xl ${radius} ${position} ${className}`}
        style={{
          width: 'var(--shell-dropdown-width, 600px)',
          maxWidth: 'min(var(--shell-dropdown-width, 600px), 92vw)',
          maxHeight: 'var(--shell-dropdown-max-height, min(520px, 70vh))',
          // Flush attach: zero offset from trigger, panel reads as one continuous surface.
          marginTop: variant === 'anchored' ? 0 : undefined,
          // Frosted glass: translucent dark fill + blur, not an opaque card.
          background: 'rgba(12, 19, 26, 0.82)',
          backdropFilter: 'blur(16px) saturate(140%)',
          WebkitBackdropFilter: 'blur(16px) saturate(140%)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          ...style,
        }}
      >
        {header != null ? (
          <div
            className="iam-shell-dropdown__header shrink-0 px-3.5 py-2.5 space-y-2 font-[var(--font-sans)]"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            {header}
          </div>
        ) : title != null ? (
          <div
            className="iam-shell-dropdown__header shrink-0 px-3.5 py-2.5 text-[0.75rem] font-semibold text-main truncate font-[var(--font-sans)]"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            {title}
          </div>
        ) : null}
        <div className="iam-shell-dropdown__body flex flex-col flex-1 min-h-0 overflow-hidden">{children}</div>
        {footer != null ? (
          <div
            className="iam-shell-dropdown__footer shrink-0"
            style={{
              borderTop: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(0,0,0,0.18)',
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    );
  },
);

type ShellDropdownRowProps = {
  /** Optional leading icon node (file-type glyph, branch icon, etc). */
  icon?: React.ReactNode;
  label: string;
  /** Secondary line under the label — path, commit message, etc. */
  hint?: string;
  /** Right-aligned muted meta text — "recently opened", "3 months ago", etc. */
  meta?: string;
  badge?: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
};

export function ShellDropdownRow({
  icon,
  label,
  hint,
  meta,
  badge,
  active = false,
  onClick,
  disabled,
}: ShellDropdownRowProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`iam-shell-dropdown__row w-full text-left px-3.5 py-2 flex items-center gap-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        active ? 'bg-[#2d5a7a]/90' : 'hover:bg-white/[0.06]'
      }`}
    >
      {icon ? <span className="shrink-0 w-4 h-4 flex items-center justify-center text-[11px]">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-[0.75rem] text-main font-medium truncate font-[var(--font-sans)]">
            {label}
          </span>
          {hint ? (
            <span className="text-[10.5px] text-muted truncate font-[var(--font-sans)]">{hint}</span>
          ) : null}
        </span>
      </span>
      {meta ? (
        <span className="shrink-0 text-[10.5px] text-muted font-[var(--font-sans)]">{meta}</span>
      ) : null}
      {badge ? (
        <span className="shrink-0 text-[0.5625rem] font-semibold text-muted uppercase tracking-wide">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export function ShellDropdownLinkRow({
  label,
  href,
  onNavigate,
}: {
  label: string;
  href: string;
  onNavigate?: () => void;
}) {
  return (
    <a
      href={href}
      onClick={() => onNavigate?.()}
      className="iam-shell-dropdown__row block w-full text-left px-3.5 py-2 text-[0.75rem] text-[var(--solar-cyan)] hover:bg-white/[0.06] font-[var(--font-sans)]"
    >
      {label}
    </a>
  );
}

/** Thin section divider — barely-visible hairline, matches the reference UI's command/result split. */
export function ShellDropdownDivider() {
  return <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />;
}

/** Keyboard-hint footer strip — "↑↓ to navigate · ↵ to select" */
export function ShellDropdownKeyHint() {
  return (
    <div
      className="px-3.5 py-1.5 text-[10px] text-muted flex items-center gap-3 font-[var(--font-sans)]"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
    >
      <span>↑↓ to navigate</span>
      <span>↵ to select</span>
    </div>
  );
}
