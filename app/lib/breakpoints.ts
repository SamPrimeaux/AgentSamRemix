// Canonical viewport breakpoints for IAM dashboard
// iPhone 13 Pro = 390px logical CSS width @ 3x scale
// Pro Max = 428px — phone cap is 430px to cover both with slack
export const BREAKPOINTS = {
  PHONE_MAX: 430, // max-width for phone shell
  TABLET_MIN: 431, // min-width where tablet/desktop behaviors start
  DESKTOP_MIN: 769, // min-width for full desktop shell
} as const;

export const PHONE_MQ = `(max-width: ${BREAKPOINTS.PHONE_MAX}px)`;
export const TABLET_MQ = `(min-width: ${BREAKPOINTS.TABLET_MIN}px) and (max-width: 768px)`;

export function isPhoneViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= BREAKPOINTS.PHONE_MAX;
}
