import type { TimelineClip } from '../src/types/moviemode';

export const FPS = 30;

export const msToFrames = (ms: number, fps = FPS) => Math.round((ms / 1000) * fps);
export const framesToMs = (f: number, fps = FPS) => Math.round((f / fps) * 1000);
export const secToFrames = (sec: number, fps = FPS) => Math.round(sec * fps);

export const clipFrames = (clip: TimelineClip, fps = FPS) =>
  msToFrames(clip.durationMs - clip.trimInMs - clip.trimOutMs, fps);

export const clipFrom = (clip: TimelineClip, fps = FPS) => msToFrames(clip.startMs, fps);

export const clipStartFrom = (clip: TimelineClip, fps = FPS) => msToFrames(clip.trimInMs, fps);
