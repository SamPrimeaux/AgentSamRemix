/** Remotion-compatible MovieMode timeline contract (v1). */

export type MovieModeTimeline = {
  version: 1;
  renderer: 'remotion' | 'moviepy' | 'ffmpeg' | 'hybrid';
  fps: number;
  width: number;
  height: number;
  durationFrames: number;
  brand: {
    colors?: Record<string, string>;
    fonts?: Record<string, string>;
    logoR2Key?: string;
  };
  tracks: Array<{
    id: string;
    type: 'video' | 'image' | 'audio' | 'text' | 'shape' | 'overlay';
    clips: Array<{
      id: string;
      assetId?: string;
      sceneId?: string;
      r2?: { bucket: string; key: string };
      startFrame: number;
      durationFrames: number;
      sourceStartMs?: number;
      sourceEndMs?: number;
      fit?: 'cover' | 'contain';
      volume?: number;
      text?: string;
      style?: Record<string, unknown>;
      transitionIn?: Record<string, unknown>;
      transitionOut?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }>;
  }>;
  /** Remotion edit-session overlays (ms-based); synced with MovieModeComposition */
  overlays?: TextOverlay[];
  exportVariants: Array<{
    type:
      | 'master_music'
      | 'master_silent'
      | 'hero_loop'
      | 'reel'
      | 'short'
      | 'vertical'
      | 'thumbnail'
      | 'poster'
      | 'custom';
    width: number;
    height: number;
    fps: number;
    hasAudio: boolean;
    loop: boolean;
  }>;
};

export interface TimelineClip {
  id: string;
  trackType: 'video' | 'audio' | 'text';
  src: string;
  fileRef: string;
  startMs: number;
  durationMs: number;
  trimInMs: number;
  trimOutMs: number;
  volume: number;
  label: string;
}

export interface TextOverlay {
  id: string;
  text: string;
  startMs: number;
  durationMs: number;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontWeight: 'normal' | 'bold';
  background: string;
  align: 'left' | 'center' | 'right';
  animation: 'none' | 'fade-in' | 'slide-up';
}

export interface EditSession {
  clips: TimelineClip[];
  overlays: TextOverlay[];
  fps: number;
  width: number;
  height: number;
}

export interface ExportJob {
  jobId: string;
  status: 'queued' | 'rendering' | 'uploading' | 'done' | 'error';
  progressPercent: number;
  r2Key?: string;
  errorMessage?: string;
  renderLane?: 'local' | 'remote' | 'sandbox' | string | null;
  exec_lane?: 'local' | 'remote' | 'sandbox' | string | null;
}
