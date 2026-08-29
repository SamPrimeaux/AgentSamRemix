/**
 * Provider/model-aware chip colors — derived from live model_key, never preset labels.
 */

export type ModelRunChipStyle = {
  provider: string;
  shortLabel: string;
  dotColor: string;
  borderColor: string;
  textColor: string;
};

function inferProvider(modelKey: string): string {
  const m = modelKey.trim().toLowerCase();
  if (!m || m === 'auto') return 'auto';
  if (m.includes('claude') || m.includes('anthropic') || m.includes('opus') || m.includes('sonnet') || m.includes('haiku')) {
    return 'anthropic';
  }
  if (m.includes('gpt') || m.includes('openai') || m.includes('o1')) {
    return 'openai';
  }
  if (m.includes('gemini') || m.includes('google')) return 'google';
  if (m.includes('workers') || m.includes('@cf/') || m.includes('llama') || m.includes('mistral')) {
    return 'workers-ai';
  }
  if (m.includes('deepseek')) return 'deepseek';
  return 'other';
}

function shortModelLabel(modelKey: string): string {
  const m = modelKey.trim();
  if (!m || m.toLowerCase() === 'auto') return 'auto';
  return m
    .replace(/^claude-/i, '')
    .replace(/^openai\//i, '')
    .replace(/^anthropic\//i, '')
    .replace(/^google\//i, '');
}

const PROVIDER_STYLES: Record<string, Omit<ModelRunChipStyle, 'provider' | 'shortLabel'>> = {
  anthropic: {
    dotColor: '#d97757',
    borderColor: 'color-mix(in srgb, #d97757 35%, var(--dashboard-border))',
    textColor: 'color-mix(in srgb, #d97757 88%, var(--dashboard-text))',
  },
  openai: {
    dotColor: '#10a37f',
    borderColor: 'color-mix(in srgb, #10a37f 32%, var(--dashboard-border))',
    textColor: 'color-mix(in srgb, #10a37f 85%, var(--dashboard-text))',
  },
  google: {
    dotColor: '#4285f4',
    borderColor: 'color-mix(in srgb, #4285f4 32%, var(--dashboard-border))',
    textColor: 'color-mix(in srgb, #4285f4 88%, var(--dashboard-text))',
  },
  'workers-ai': {
    dotColor: '#f6821f',
    borderColor: 'color-mix(in srgb, #f6821f 32%, var(--dashboard-border))',
    textColor: 'color-mix(in srgb, #f6821f 88%, var(--dashboard-text))',
  },
  deepseek: {
    dotColor: '#4f46e5',
    borderColor: 'color-mix(in srgb, #4f46e5 32%, var(--dashboard-border))',
    textColor: 'color-mix(in srgb, #4f46e5 88%, var(--dashboard-text))',
  },
  auto: {
    dotColor: 'var(--solar-cyan)',
    borderColor: 'color-mix(in srgb, var(--solar-cyan) 28%, var(--dashboard-border))',
    textColor: 'var(--dashboard-text)',
  },
  other: {
    dotColor: 'var(--solar-yellow)',
    borderColor: 'color-mix(in srgb, var(--solar-yellow) 28%, var(--dashboard-border))',
    textColor: 'var(--dashboard-text)',
  },
};

export function deriveModelRunChipStyle(modelKey?: string | null): ModelRunChipStyle {
  const key = modelKey?.trim() || '';
  const provider = inferProvider(key);
  const palette = PROVIDER_STYLES[provider] ?? PROVIDER_STYLES.other;
  return {
    provider,
    shortLabel: key ? shortModelLabel(key) : '…',
    ...palette,
  };
}

export function formatRunElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}
