export type VideosSourceTab = 'all' | 'stream' | 'r2' | 'drive';

export type VideosDetailTabId =
  | 'settings'
  | 'downloads'
  | 'captions'
  | 'embed'
  | 'json'
  | 'public-details'
  | 'tags';

export type VideosDetailTab = {
  id: VideosDetailTabId;
  label: string;
};

export const VIDEOS_BASE = '/dashboard/images/videos';

export const CF_STREAM_DOCS_URL = 'https://developers.cloudflare.com/stream/';

export const VIDEOS_SOURCE_TABS: Array<{ id: VideosSourceTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'stream', label: 'Stream' },
  { id: 'r2', label: 'R2' },
  { id: 'drive', label: 'Drive' },
];

/** Cloudflare Stream dashboard–parity detail tabs. */
export const VIDEOS_DETAIL_TABS: VideosDetailTab[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'captions', label: 'Captions' },
  { id: 'embed', label: 'Embed' },
  { id: 'json', label: 'JSON' },
  { id: 'public-details', label: 'Public Details' },
  { id: 'tags', label: 'Tags' },
];

export function videosDetailPath(uid: string, tab: VideosDetailTabId = 'settings') {
  return `${VIDEOS_BASE}/${encodeURIComponent(uid)}/${tab}`;
}

export function videosAssetPath(assetId: string) {
  return `${VIDEOS_BASE}/asset/${encodeURIComponent(assetId)}`;
}
