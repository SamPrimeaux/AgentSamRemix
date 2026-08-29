export type LocalTerminalPlatform = 'macos' | 'windows' | 'linux';

export interface LocalTerminalDefaults {
  platform: LocalTerminalPlatform;
  shell: string;
}

/** Browser-detected defaults for user_hosted_tunnel provisioning (overridable in UI). */
export function detectLocalTerminalDefaults(): LocalTerminalDefaults {
  if (typeof navigator === 'undefined') {
    return { platform: 'linux', shell: '/bin/bash' };
  }
  const ua = navigator.userAgent || '';
  const plat = navigator.platform || '';
  if (/Win/i.test(ua) || /Win/i.test(plat)) {
    return { platform: 'windows', shell: 'powershell' };
  }
  if (/Mac/i.test(plat) || /Mac/i.test(ua)) {
    return { platform: 'macos', shell: '/bin/zsh' };
  }
  return { platform: 'linux', shell: '/bin/bash' };
}

export const LOCAL_SHELL_OPTIONS: Record<LocalTerminalPlatform, { label: string; value: string }[]> = {
  macos: [
    { label: 'zsh', value: '/bin/zsh' },
    { label: 'bash', value: '/bin/bash' },
  ],
  windows: [
    { label: 'PowerShell', value: 'powershell' },
    { label: 'pwsh', value: 'pwsh' },
  ],
  linux: [
    { label: 'bash', value: '/bin/bash' },
    { label: 'zsh', value: '/bin/zsh' },
  ],
};

export interface LocalTerminalConnection {
  id: string;
  platform: string | null;
  shell: string | null;
  is_active: boolean;
  ws_url_present: boolean;
}
