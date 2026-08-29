export type ImagesTabId = 'storage' | 'delivery' | 'keys' | 'sourcing-kit';

export type ImagesTab = {
  id: ImagesTabId;
  label: string;
  path: string;
};

/** Top-level Hosted images tabs (CF Images UX mirror). */
export const IMAGES_TABS: ImagesTab[] = [
  { id: 'storage', label: 'Storage', path: '/dashboard/images/storage' },
  { id: 'delivery', label: 'Delivery', path: '/dashboard/images/delivery' },
  { id: 'keys', label: 'Keys', path: '/dashboard/images/keys' },
  { id: 'sourcing-kit', label: 'Sourcing Kit', path: '/dashboard/images/sourcing-kit' },
];

export const IMAGES_BASE = '/dashboard/images';

export const NAMED_VARIANTS = [
  { id: 'avatar', label: 'avatar', hint: '200×200' },
  { id: 'thumbnail', label: 'thumbnail', hint: '150×150' },
  { id: 'small', label: 'small', hint: '400×400' },
  { id: 'medium', label: 'medium', hint: '800×800' },
  { id: 'large', label: 'large', hint: '1600×1600' },
  { id: 'hero', label: 'hero', hint: '1920×1080' },
  { id: 'public', label: 'public', hint: 'original' },
] as const;

export type NamedVariantId = (typeof NAMED_VARIANTS)[number]['id'];
