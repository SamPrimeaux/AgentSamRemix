type MobileNavHamburgerProps = {
  open: boolean;
  /** Morph lines into a left chevron — active conversation back affordance. */
  backMode?: boolean;
  onClick: () => void;
};

/** Glassmorphic circular hamburger — mobile shell only (CSS lines, no icon lib). */
export function MobileNavHamburger({ open, backMode = false, onClick }: MobileNavHamburgerProps) {
  const ariaLabel = backMode
    ? 'Back to agent home'
    : open
      ? 'Close navigation menu'
      : 'Open navigation menu';

  return (
    <button
      type="button"
      className="iam-mobile-nav-hamburger"
      data-open={open ? 'true' : 'false'}
      data-back={backMode ? 'true' : 'false'}
      aria-label={ariaLabel}
      aria-expanded={backMode ? undefined : open}
      onClick={onClick}
    >
      <span className="iam-mobile-nav-hamburger__lines" aria-hidden>
        <span className="iam-mobile-nav-hamburger__line iam-mobile-nav-hamburger__line--1" />
        <span className="iam-mobile-nav-hamburger__line iam-mobile-nav-hamburger__line--2" />
        <span className="iam-mobile-nav-hamburger__line iam-mobile-nav-hamburger__line--3" />
      </span>
    </button>
  );
}
