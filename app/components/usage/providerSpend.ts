export const PROVIDER_SPEND_COLORS: Record<string, string> = {
  anthropic: '#6ba8ff',
  openai: '#35c98a',
  google: '#f3b34c',
  workers_ai: '#39d5e8',
  cloudflare_workers_ai: '#39d5e8',
  cloudflare: '#39d5e8',
  deepseek: '#7d8396',
  other: '#7d8396',
};

export function providerSpendColor(provider: string): string {
  return PROVIDER_SPEND_COLORS[String(provider || 'other').toLowerCase()] ?? PROVIDER_SPEND_COLORS.other;
}

export function providerSpendLabel(provider: string): string {
  const normalized = String(provider || 'other').toLowerCase();
  if (normalized === 'workers_ai' || normalized === 'cloudflare_workers_ai' || normalized === 'cloudflare') {
    return 'Workers AI';
  }
  return normalized.replace(/_/g, ' ');
}
