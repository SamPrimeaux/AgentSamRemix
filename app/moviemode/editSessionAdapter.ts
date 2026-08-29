import type {
  EditSession,
  MovieModeTimeline,
  TextOverlay,
  TimelineClip,
} from '../src/types/moviemode';
import { framesToMs, msToFrames } from './remotion-utils';

function clipSrc(clip: MovieModeTimeline['tracks'][0]['clips'][0]): string {
  const meta = clip.metadata as { previewUrl?: string } | undefined;
  if (meta?.previewUrl) return meta.previewUrl;
  if (clip.r2?.bucket && clip.r2?.key) {
    return `/api/r2/buckets/${encodeURIComponent(clip.r2.bucket)}/object/${encodeURIComponent(clip.r2.key)}`;
  }
  return '';
}

function trackTypeFor(
  t: MovieModeTimeline['tracks'][0]['type'],
): TimelineClip['trackType'] | null {
  if (t === 'video' || t === 'image') return 'video';
  if (t === 'audio') return 'audio';
  if (t === 'text' || t === 'overlay') return 'text';
  return null;
}

/** Map frame-based timeline → ms-based EditSession for MovieModeComposition + export. */
export function timelineToEditSession(timeline: MovieModeTimeline): EditSession {
  const fps = timeline.fps || 30;
  const clips: TimelineClip[] = [];

  for (const track of timeline.tracks) {
    const trackType = trackTypeFor(track.type);
    if (!trackType || trackType === 'text') continue;

    for (const clip of track.clips) {
      const src = clipSrc(clip);
      if (!src) continue;
      const durationMs = framesToMs(clip.durationFrames, fps);
      const trimInMs = clip.sourceStartMs ?? 0;
      const trimOutMs =
        clip.sourceEndMs != null && clip.sourceEndMs > 0
          ? Math.max(0, durationMs - (clip.sourceEndMs - trimInMs))
          : 0;
      const meta = clip.metadata as { name?: string } | undefined;
      clips.push({
        id: clip.id,
        trackType,
        src,
        fileRef: clip.r2?.key || clip.assetId || clip.id,
        startMs: framesToMs(clip.startFrame, fps),
        durationMs,
        trimInMs,
        trimOutMs,
        volume: clip.volume ?? 1,
        label: meta?.name || clip.text || clip.id,
      });
    }
  }

  return {
    clips,
    overlays: timeline.overlays ?? [],
    fps,
    width: timeline.width,
    height: timeline.height,
  };
}

export function editSessionDurationFrames(session: EditSession): number {
  const fps = session.fps || 30;
  let maxMs = 5000;
  for (const c of session.clips) {
    maxMs = Math.max(maxMs, c.startMs + c.durationMs - c.trimInMs - c.trimOutMs);
  }
  for (const o of session.overlays) {
    maxMs = Math.max(maxMs, o.startMs + o.durationMs);
  }
  return Math.max(msToFrames(maxMs, fps), fps * 5);
}

export function applyOverlayChange(
  timeline: MovieModeTimeline,
  overlays: TextOverlay[],
): MovieModeTimeline {
  return { ...timeline, overlays };
}
