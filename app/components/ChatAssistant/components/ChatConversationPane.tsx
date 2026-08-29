import React from 'react';

type Props = {
  title: string;
  focused: boolean;
  onFocus: () => void;
  onClose?: () => void;
  children: React.ReactNode;
};

/** Thin chrome around a conversation pane in split view. */
export function ChatConversationPane({ title, focused, onFocus, onClose, children }: Props) {
  return (
    <div
      className={`flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden border ${
        focused
          ? 'border-[var(--solar-cyan)]/45'
          : 'border-transparent'
      }`}
      onClick={onFocus}
    >
      <div className="flex items-center gap-2 px-2 py-1 shrink-0 border-b border-[var(--dashboard-border)]/60">
        <span
          className={`text-[0.6875rem] font-medium truncate ${
            focused ? 'text-[var(--solar-cyan)]' : 'text-[var(--dashboard-muted)]'
          }`}
        >
          {title}
        </span>
        <span className="flex-1" />
        {onClose ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="text-[0.625rem] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] px-1.5 py-0.5"
            aria-label="Close split pane"
          >
            Close
          </button>
        ) : null}
      </div>
      <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">{children}</div>
    </div>
  );
}
