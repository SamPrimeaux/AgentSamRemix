export interface ThemePalette {
  id: string;
  name: string;
  tagline: string;
  category: 'dark' | 'light' | 'neon';
  previewColors: {
    bg: string;
    surface: string;
    accent: string;
    text: string;
  };
  variables: Record<string, string>;
}

export interface AppSettings {
  themeId: string;
  customAccent: string | null;
  uiDensity: 'compact' | 'comfortable' | 'spacious';
  borderRadius: 'sharp' | 'medium' | 'rounded';
  enableGlassmorphism: boolean;
  enableGlowEffects: boolean;
  backgroundPattern: 'minimal' | 'dots' | 'grid' | 'vignette';
  fontFamily: 'google-sans' | 'mono' | 'system' | 'inter';
  // AI preferences
  geminiModel: string;
  autoGrounding: boolean;
  temperature: number;
  // Audio / TTS
  ttsRate: number;
  ttsPitch: number;
  ttsAutoplay: boolean;
  // Window shell
  showWindowControls: boolean;
  showFpsTelemetry: boolean;
  showLiveTokens: boolean;
}

export const THEME_PALETTES: ThemePalette[] = [
  {
    id: 'midnight-titanium',
    name: 'Midnight Titanium',
    tagline: 'Refined dark slate with deep titanium finishes and sapphire accents',
    category: 'dark',
    previewColors: {
      bg: '#0c0d10',
      surface: '#181a20',
      accent: '#8ab4f8',
      text: '#e8eaed',
    },
    variables: {
      '--app-bg': '#000000',
      '--app-canvas-bg': '#0c0d10',
      '--app-surface-1': '#181a20',
      '--app-surface-2': '#22252c',
      '--app-surface-3': '#2e323b',
      '--app-border': '#2d313b',
      '--app-border-hover': '#434957',
      '--app-border-focus': '#8ab4f8',
      '--app-text-primary': '#ffffff',
      '--app-text-secondary': '#c4c7cc',
      '--app-text-muted': '#80868b',
      '--app-accent': '#8ab4f8',
      '--app-accent-rgb': '138, 180, 248',
      '--app-accent-glow': 'rgba(138, 180, 248, 0.35)',
      '--app-accent-hover': '#1a73e8',
      '--app-success': '#81c995',
      '--app-warning': '#fbbc04',
      '--app-error': '#f28b82',
      '--app-tab-bg': '#1e2025',
      '--app-tab-active': '#2c2f37',
      '--app-omnibar-bg': '#16181e',
      '--app-omnibar-focus': '#22252c',
      '--app-shadow': '0 8px 32px rgba(0, 0, 0, 0.65)',
    },
  },
  {
    id: 'cyber-obsidian',
    name: 'Cyber Obsidian',
    tagline: 'OLED pitch black with electric cyan & emerald terminal glow',
    category: 'neon',
    previewColors: {
      bg: '#000000',
      surface: '#0d1117',
      accent: '#00f2fe',
      text: '#f0f6fc',
    },
    variables: {
      '--app-bg': '#000000',
      '--app-canvas-bg': '#020408',
      '--app-surface-1': '#0b0f17',
      '--app-surface-2': '#131b26',
      '--app-surface-3': '#1d2737',
      '--app-border': '#1d2a3d',
      '--app-border-hover': '#2f4360',
      '--app-border-focus': '#00f2fe',
      '--app-text-primary': '#f0f6fc',
      '--app-text-secondary': '#8b949e',
      '--app-text-muted': '#586069',
      '--app-accent': '#00f2fe',
      '--app-accent-rgb': '0, 242, 254',
      '--app-accent-glow': 'rgba(0, 242, 254, 0.45)',
      '--app-accent-hover': '#00c3ff',
      '--app-success': '#00ff88',
      '--app-warning': '#ffbe0b',
      '--app-error': '#ff0055',
      '--app-tab-bg': '#0c121c',
      '--app-tab-active': '#162233',
      '--app-omnibar-bg': '#070b12',
      '--app-omnibar-focus': '#111a28',
      '--app-shadow': '0 0 24px rgba(0, 242, 254, 0.25)',
    },
  },
  {
    id: 'deepmind-sapphire',
    name: 'DeepMind Sapphire',
    tagline: 'Google AI Studio cobalt blue atmosphere with crisp luminescent accents',
    category: 'dark',
    previewColors: {
      bg: '#080d1a',
      surface: '#0f172a',
      accent: '#38bdf8',
      text: '#f8fafc',
    },
    variables: {
      '--app-bg': '#030712',
      '--app-canvas-bg': '#070e1e',
      '--app-surface-1': '#0f172a',
      '--app-surface-2': '#1e293b',
      '--app-surface-3': '#334155',
      '--app-border': '#1e3a5f',
      '--app-border-hover': '#2563eb',
      '--app-border-focus': '#38bdf8',
      '--app-text-primary': '#ffffff',
      '--app-text-secondary': '#94a3b8',
      '--app-text-muted': '#64748b',
      '--app-accent': '#38bdf8',
      '--app-accent-rgb': '56, 189, 248',
      '--app-accent-glow': 'rgba(56, 189, 248, 0.4)',
      '--app-accent-hover': '#0284c7',
      '--app-success': '#4ade80',
      '--app-warning': '#facc15',
      '--app-error': '#fb7185',
      '--app-tab-bg': '#0d182e',
      '--app-tab-active': '#172554',
      '--app-omnibar-bg': '#081021',
      '--app-omnibar-focus': '#1e293b',
      '--app-shadow': '0 8px 32px rgba(14, 165, 233, 0.2)',
    },
  },
  {
    id: 'solar-amber',
    name: 'Solar Amber',
    tagline: 'Warm golden hues and cozy dusk slate, easy on the eyes',
    category: 'dark',
    previewColors: {
      bg: '#121110',
      surface: '#1d1917',
      accent: '#f59e0b',
      text: '#fef3c7',
    },
    variables: {
      '--app-bg': '#0c0a09',
      '--app-canvas-bg': '#141210',
      '--app-surface-1': '#1c1917',
      '--app-surface-2': '#292524',
      '--app-surface-3': '#44403c',
      '--app-border': '#3d342c',
      '--app-border-hover': '#574838',
      '--app-border-focus': '#f59e0b',
      '--app-text-primary': '#fef3c7',
      '--app-text-secondary': '#d6d3d1',
      '--app-text-muted': '#a8a29e',
      '--app-accent': '#f59e0b',
      '--app-accent-rgb': '245, 158, 11',
      '--app-accent-glow': 'rgba(245, 158, 11, 0.35)',
      '--app-accent-hover': '#d97706',
      '--app-success': '#84cc16',
      '--app-warning': '#fb923c',
      '--app-error': '#f87171',
      '--app-tab-bg': '#191614',
      '--app-tab-active': '#292524',
      '--app-omnibar-bg': '#13110f',
      '--app-omnibar-focus': '#26221f',
      '--app-shadow': '0 8px 30px rgba(245, 158, 11, 0.15)',
    },
  },
  {
    id: 'matrix-terminal',
    name: 'Matrix Phosphor',
    tagline: 'Authentic cyberpunk terminal aesthetics with phosphor emerald glow',
    category: 'neon',
    previewColors: {
      bg: '#050a06',
      surface: '#0a160d',
      accent: '#10b981',
      text: '#d1fae5',
    },
    variables: {
      '--app-bg': '#020503',
      '--app-canvas-bg': '#050c07',
      '--app-surface-1': '#09150d',
      '--app-surface-2': '#0f2416',
      '--app-surface-3': '#163823',
      '--app-border': '#153820',
      '--app-border-hover': '#1f5230',
      '--app-border-focus': '#10b981',
      '--app-text-primary': '#ecfdf5',
      '--app-text-secondary': '#a7f3d0',
      '--app-text-muted': '#6ee7b7',
      '--app-accent': '#10b981',
      '--app-accent-rgb': '16, 185, 129',
      '--app-accent-glow': 'rgba(16, 185, 129, 0.45)',
      '--app-accent-hover': '#059669',
      '--app-success': '#34d399',
      '--app-warning': '#fbbf24',
      '--app-error': '#f87171',
      '--app-tab-bg': '#07120a',
      '--app-tab-active': '#0e2315',
      '--app-omnibar-bg': '#040a06',
      '--app-omnibar-focus': '#0d1f13',
      '--app-shadow': '0 0 24px rgba(16, 185, 129, 0.25)',
    },
  },
  {
    id: 'sunset-velvet',
    name: 'Sunset Velvet',
    tagline: 'Deep rich purple canvas with vibrant neon coral and rose accents',
    category: 'dark',
    previewColors: {
      bg: '#0f0814',
      surface: '#1a0f24',
      accent: '#f43f5e',
      text: '#ffe4e6',
    },
    variables: {
      '--app-bg': '#08040b',
      '--app-canvas-bg': '#0d0713',
      '--app-surface-1': '#190e24',
      '--app-surface-2': '#271538',
      '--app-surface-3': '#3b2054',
      '--app-border': '#3d1d54',
      '--app-border-hover': '#5c2d7e',
      '--app-border-focus': '#f43f5e',
      '--app-text-primary': '#fff1f2',
      '--app-text-secondary': '#fbcfe8',
      '--app-text-muted': '#a855f7',
      '--app-accent': '#f43f5e',
      '--app-accent-rgb': '244, 63, 94',
      '--app-accent-glow': 'rgba(244, 63, 94, 0.4)',
      '--app-accent-hover': '#e11d48',
      '--app-success': '#4ade80',
      '--app-warning': '#fbbf24',
      '--app-error': '#f43f5e',
      '--app-tab-bg': '#150c1f',
      '--app-tab-active': '#2b173e',
      '--app-omnibar-bg': '#100818',
      '--app-omnibar-focus': '#221233',
      '--app-shadow': '0 8px 30px rgba(244, 63, 94, 0.2)',
    },
  },
  {
    id: 'nordic-frost',
    name: 'Nordic Frost',
    tagline: 'Arctic charcoal with glacial cyan highlights and crisp clarity',
    category: 'dark',
    previewColors: {
      bg: '#0b1118',
      surface: '#131e2b',
      accent: '#38bdf8',
      text: '#e2e8f0',
    },
    variables: {
      '--app-bg': '#060a0f',
      '--app-canvas-bg': '#0a1017',
      '--app-surface-1': '#111c29',
      '--app-surface-2': '#192b3f',
      '--app-surface-3': '#243b56',
      '--app-border': '#22364e',
      '--app-border-hover': '#325073',
      '--app-border-focus': '#38bdf8',
      '--app-text-primary': '#f8fafc',
      '--app-text-secondary': '#cbd5e1',
      '--app-text-muted': '#64748b',
      '--app-accent': '#38bdf8',
      '--app-accent-rgb': '56, 189, 248',
      '--app-accent-glow': 'rgba(56, 189, 248, 0.35)',
      '--app-accent-hover': '#0284c7',
      '--app-success': '#34d399',
      '--app-warning': '#fbbf24',
      '--app-error': '#f87171',
      '--app-tab-bg': '#0e1722',
      '--app-tab-active': '#17273a',
      '--app-omnibar-bg': '#090f17',
      '--app-omnibar-focus': '#152335',
      '--app-shadow': '0 8px 32px rgba(56, 189, 248, 0.18)',
    },
  },
  {
    id: 'daybreak-studio',
    name: 'Daybreak Studio',
    tagline: 'Pristine architectural light theme with ultra-clean contrast',
    category: 'light',
    previewColors: {
      bg: '#f1f5f9',
      surface: '#ffffff',
      accent: '#2563eb',
      text: '#0f172a',
    },
    variables: {
      '--app-bg': '#e2e8f0',
      '--app-canvas-bg': '#f8fafc',
      '--app-surface-1': '#ffffff',
      '--app-surface-2': '#f1f5f9',
      '--app-surface-3': '#e2e8f0',
      '--app-border': '#cbd5e1',
      '--app-border-hover': '#94a3b8',
      '--app-border-focus': '#2563eb',
      '--app-text-primary': '#0f172a',
      '--app-text-secondary': '#334155',
      '--app-text-muted': '#64748b',
      '--app-accent': '#2563eb',
      '--app-accent-rgb': '37, 99, 235',
      '--app-accent-glow': 'rgba(37, 99, 235, 0.25)',
      '--app-accent-hover': '#1d4ed8',
      '--app-success': '#16a34a',
      '--app-warning': '#d97706',
      '--app-error': '#dc2626',
      '--app-tab-bg': '#e2e8f0',
      '--app-tab-active': '#ffffff',
      '--app-omnibar-bg': '#f1f5f9',
      '--app-omnibar-focus': '#ffffff',
      '--app-shadow': '0 8px 32px rgba(0, 0, 0, 0.08)',
    },
  },
];

export const ACCENT_SWATCHES = [
  { name: 'Google Blue', hex: '#8ab4f8' },
  { name: 'Neon Cyan', hex: '#00f2fe' },
  { name: 'Matrix Emerald', hex: '#10b981' },
  { name: 'Solar Amber', hex: '#f59e0b' },
  { name: 'Neon Coral', hex: '#f43f5e' },
  { name: 'Violet Nebula', hex: '#a855f7' },
  { name: 'Pure White', hex: '#ffffff' },
];

export const DEFAULT_APP_SETTINGS: AppSettings = {
  themeId: 'midnight-titanium',
  customAccent: null,
  uiDensity: 'comfortable',
  borderRadius: 'medium',
  enableGlassmorphism: true,
  enableGlowEffects: true,
  backgroundPattern: 'vignette',
  fontFamily: 'google-sans',
  geminiModel: 'gemini-3.7-flash',
  autoGrounding: false,
  temperature: 0.7,
  ttsRate: 1.0,
  ttsPitch: 1.0,
  ttsAutoplay: false,
  showWindowControls: true,
  showFpsTelemetry: false,
  showLiveTokens: true,
};

const SETTINGS_STORAGE_KEY = 'agentsam_app_settings_v3';

export function loadStoredSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_APP_SETTINGS, ...parsed };
  } catch (err) {
    console.warn('Failed to load stored settings, using defaults:', err);
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveStoredSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Failed to save settings to localStorage:', err);
  }
}

export function applyThemeToDocument(settings: AppSettings): void {
  const root = document.documentElement;
  const palette = THEME_PALETTES.find(t => t.id === settings.themeId) || THEME_PALETTES[0];

  // Apply all palette CSS variables
  Object.entries(palette.variables).forEach(([key, val]) => {
    root.style.setProperty(key, val);
  });

  // Apply custom accent if specified
  if (settings.customAccent) {
    root.style.setProperty('--app-accent', settings.customAccent);
    root.style.setProperty('--app-border-focus', settings.customAccent);
    root.style.setProperty('--app-accent-glow', `${settings.customAccent}55`);
  }

  // Border radius variables
  const radii = {
    sharp: { base: '4px', card: '6px', pill: '8px' },
    medium: { base: '10px', card: '16px', pill: '24px' },
    rounded: { base: '16px', card: '24px', pill: '999px' },
  }[settings.borderRadius];

  root.style.setProperty('--app-radius-base', radii.base);
  root.style.setProperty('--app-radius-card', radii.card);
  root.style.setProperty('--app-radius-pill', radii.pill);

  // Density spacing factor
  const density = {
    compact: '0.85',
    comfortable: '1',
    spacious: '1.15',
  }[settings.uiDensity];
  root.style.setProperty('--app-density-scale', density);

  // Font family
  const fonts = {
    'google-sans': "'Google Sans Flex', 'Google Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    mono: "'Google Sans Mono', 'JetBrains Mono', monospace",
    system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  }[settings.fontFamily];
  root.style.setProperty('--app-font-family', fonts);

  // Glow and glass flags
  root.style.setProperty('--app-glow-opacity', settings.enableGlowEffects ? '1' : '0');
  root.style.setProperty('--app-glass-filter', settings.enableGlassmorphism ? 'blur(16px)' : 'none');

  // Update body background
  document.body.style.background = palette.variables['--app-bg'] || '#000000';
  document.body.style.color = palette.variables['--app-text-primary'] || '#ffffff';
}
