export type CmsThemeTokens = {
  id: string;
  label: string;
  fonts: { sans: string; mono: string };
  colors: {
    background: string;
    elevated: string;
    text: string;
    muted: string;
    line: string;
    accent: string;
    accentText: string;
  };
  radius: { sm: string; md: string; lg: string; xl: string };
  shadow: { card: string; floating: string };
};

export const iamClassyTheme: CmsThemeTokens = {
  id: 'iam-classy',
  label: 'IAM Classy',
  fonts: {
    sans: 'Nunito, system-ui, -apple-system, sans-serif',
    mono: 'JetBrains Mono, SFMono-Regular, Menlo, monospace',
  },
  colors: {
    background: '#fcfcfb',
    elevated: '#f7f7f5',
    text: '#151515',
    muted: '#6b6b68',
    line: 'rgba(20,20,20,0.10)',
    accent: '#5a7df7',
    accentText: '#ffffff',
  },
  radius: { sm: '6px', md: '10px', lg: '16px', xl: '24px' },
  shadow: {
    card: '0 1px 2px rgba(0,0,0,0.04), 0 12px 32px rgba(0,0,0,0.06)',
    floating: '0 18px 48px rgba(0,0,0,0.14)',
  },
};

export const cmsThemes = [iamClassyTheme] as const;

export function themeToCssVariables(theme: CmsThemeTokens): Record<string, string> {
  return {
    '--cms-font-sans': theme.fonts.sans,
    '--cms-font-mono': theme.fonts.mono,
    '--cms-background': theme.colors.background,
    '--cms-elevated': theme.colors.elevated,
    '--cms-text': theme.colors.text,
    '--cms-muted': theme.colors.muted,
    '--cms-line': theme.colors.line,
    '--cms-accent': theme.colors.accent,
    '--cms-accent-text': theme.colors.accentText,
    '--cms-radius-sm': theme.radius.sm,
    '--cms-radius-md': theme.radius.md,
    '--cms-radius-lg': theme.radius.lg,
    '--cms-radius-xl': theme.radius.xl,
    '--cms-shadow-card': theme.shadow.card,
    '--cms-shadow-floating': theme.shadow.floating,
  };
}
