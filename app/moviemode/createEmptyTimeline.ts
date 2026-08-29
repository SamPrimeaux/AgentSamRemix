import type { MovieModeTimeline } from '../src/types/moviemode';
import type { MediaLibraryItem } from './types';

export const MOVIEMODE_CLIP_DRAG = 'application/x-iam-moviemode-clip';

const DEFAULT_FPS = 30;
const DEFAULT_W = 1920;
const DEFAULT_H = 1080;
const DEFAULT_CLIP_FRAMES = 150;

function buildClipFromItem(item: MediaLibraryItem) {
  const clipId = `clip_${item.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}`;
  const trackType = item.kind === 'audio' ? 'audio' : 'video';
  return {
    trackType,
    trackId: `${trackType}-1`,
    clip: {
      id: clipId,
      assetId: item.assetId,
      startFrame: 0,
      durationFrames: DEFAULT_CLIP_FRAMES,
      fit: 'contain' as const,
      volume: trackType === 'audio' ? 1 : 0.9,
      ...(item.r2Bucket && item.r2Key ? { r2: { bucket: item.r2Bucket, key: item.r2Key } } : {}),
      metadata: {
        previewUrl: item.previewUrl,
        name: item.name,
        local: item.source === 'local',
      },
    },
  };
}

export function createEmptyTimeline(): MovieModeTimeline {
  return {
    version: 1,
    renderer: 'remotion',
    fps: DEFAULT_FPS,
    width: DEFAULT_W,
    height: DEFAULT_H,
    durationFrames: DEFAULT_CLIP_FRAMES,
    brand: {},
    tracks: [
      { id: 'video-1', type: 'video', clips: [] },
      { id: 'audio-1', type: 'audio', clips: [] },
      { id: 'text-1', type: 'text', clips: [] },
    ],
    exportVariants: [
      {
        type: 'master_music',
        width: DEFAULT_W,
        height: DEFAULT_H,
        fps: DEFAULT_FPS,
        hasAudio: true,
        loop: false,
      },
    ],
  };
}

export function createTimelineWithClip(item: MediaLibraryItem): MovieModeTimeline {
  return appendClipToTimeline(createEmptyTimeline(), item);
}

export function appendClipToTimeline(
  timeline: MovieModeTimeline,
  item: MediaLibraryItem,
  opts?: { startFrame?: number },
): MovieModeTimeline {
  const { trackType, trackId, clip } = buildClipFromItem(item);
  const startFrame = opts?.startFrame ?? 0;
  const clipAt = { ...clip, startFrame };

  const track = timeline.tracks.find((t) => t.id === trackId);
  if (!track) return timeline;

  const endFrame = startFrame + clipAt.durationFrames;
  return {
    ...timeline,
    durationFrames: Math.max(timeline.durationFrames, endFrame),
    tracks: timeline.tracks.map((t) =>
      t.id === trackId ? { ...t, clips: [...t.clips, clipAt] } : t,
    ),
  };
}
