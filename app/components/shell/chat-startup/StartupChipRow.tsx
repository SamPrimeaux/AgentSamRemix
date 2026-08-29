/**
 * StartupChipRow — single reusable chip row for all startup surfaces.
 *
 * Agent, Draw, Design Studio, and Editor all use .iam-chat-startup-chip
 * from chat-startup-center.css. This component owns the chip rendering so
 * there's one place to change layout, spacing, or accessibility.
 */
import type { ElementType } from 'react';

export type StartupChip = {
  /** Stable key — used as React key and data-chip-id. */
  id: string;
  label: string;
  /** Any Lucide-compatible icon component. */
  icon: ElementType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>;
  disabled?: boolean;
  onClick: () => void;
};

type StartupChipRowProps = {
  chips: StartupChip[];
  /** Additional class on the wrapper div. */
  className?: string;
  /** aria-label on the role="group" wrapper. Defaults to "Quick actions". */
  ariaLabel?: string;
  /** When true, every chip in the row is disabled. */
  disabled?: boolean;
};

export function StartupChipRow({
  chips,
  className,
  ariaLabel = 'Quick actions',
  disabled = false,
}: StartupChipRowProps) {
  if (!chips.length) return null;

  return (
    <div
      className={`iam-chat-startup-chips${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={ariaLabel}
    >
      {chips.map((chip) => {
        const Icon = chip.icon;
        const isDisabled = disabled || chip.disabled;
        return (
          <button
            key={chip.id}
            type="button"
            className="iam-chat-startup-chip"
            disabled={isDisabled}
            onClick={chip.onClick}
            data-chip-id={chip.id}
          >
            <Icon size={14} aria-hidden />
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
