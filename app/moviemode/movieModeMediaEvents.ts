import type { MediaLibraryItem } from './types';

export const IAM_MOVIEMODE_ADD_CLIP = 'iam:moviemode-add-clip';
export const IAM_MOVIEMODE_PREVIEW_CLIP = 'iam:moviemode-preview-clip';

export function dispatchMovieModeAddClip(item: MediaLibraryItem) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(IAM_MOVIEMODE_ADD_CLIP, { detail: { item } }));
}

export function dispatchMovieModePreviewClip(item: MediaLibraryItem) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(IAM_MOVIEMODE_PREVIEW_CLIP, { detail: { item } }));
}
