/** Canonical MeauxChess marketing imagery (Cloudflare Images). */
export const CF_IMAGES_ACCOUNT = 'g7wf09fCONpnidkRnR_5vw';
export const MEAUXCHESS_HERO_IMAGE_ID = '1b7ecfe9-550c-4ef7-966c-9e1972e29800';

export function cfImageUrl(imageId: string, variant: string): string {
  return `https://imagedelivery.net/${CF_IMAGES_ACCOUNT}/${imageId}/${variant}`;
}

export const MEAUXCHESS_HERO = {
  desktop: cfImageUrl(MEAUXCHESS_HERO_IMAGE_ID, 'hero'),
  public: cfImageUrl(MEAUXCHESS_HERO_IMAGE_ID, 'public'),
  og: cfImageUrl(MEAUXCHESS_HERO_IMAGE_ID, 'hero'),
} as const;
