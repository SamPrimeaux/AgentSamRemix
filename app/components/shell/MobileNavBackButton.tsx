import { ChevronLeft } from 'lucide-react';

type MobileNavBackButtonProps = {
  label?: string | null;
  onClick: () => void;
};

export function MobileNavBackButton({ label, onClick }: MobileNavBackButtonProps) {
  return (
    <button
      type="button"
      className="iam-mobile-nav-back"
      onClick={onClick}
      title={label ? `Back — ${label}` : 'Back to editor'}
      aria-label={label ? `Back to ${label}` : 'Back to editor'}
    >
      <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
      {label ? (
        <span className="iam-mobile-nav-back__label" title={label}>
          {label}
        </span>
      ) : null}
    </button>
  );
}
