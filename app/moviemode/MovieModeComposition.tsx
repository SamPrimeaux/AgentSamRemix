import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  Video,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { EditSession, TextOverlay } from '../src/types/moviemode';
import { clipFrames, clipFrom, clipStartFrom, msToFrames } from './remotion-utils';

function OverlayText({ overlay }: { overlay: TextOverlay }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const totalFrames = msToFrames(overlay.durationMs, fps);

  const opacity =
    overlay.animation === 'fade-in'
      ? interpolate(frame, [0, Math.min(15, totalFrames * 0.3)], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.out(Easing.ease),
        })
      : 1;

  const translateY =
    overlay.animation === 'slide-up'
      ? interpolate(frame, [0, Math.min(12, totalFrames * 0.25)], [24, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.out(Easing.back(1.2)),
        })
      : 0;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: `${overlay.x}%`,
          top: `${overlay.y}%`,
          transform: `translate(-50%, -50%) translateY(${translateY}px)`,
          opacity,
          fontSize: overlay.fontSize,
          color: overlay.color,
          fontWeight: overlay.fontWeight,
          textAlign: overlay.align,
          background: overlay.background,
          padding: '6px 12px',
          borderRadius: 6,
          whiteSpace: 'pre-wrap',
          maxWidth: '80%',
          lineHeight: 1.3,
        }}
      >
        {overlay.text}
      </div>
    </AbsoluteFill>
  );
}

export function MovieModeComposition({ clips, overlays, fps }: EditSession) {
  const { fps: compositionFps } = useVideoConfig();
  const f = fps || compositionFps;

  const videoClips = clips
    .filter((c) => c.trackType === 'video')
    .sort((a, b) => a.startMs - b.startMs);
  const audioClips = clips
    .filter((c) => c.trackType === 'audio')
    .sort((a, b) => a.startMs - b.startMs);

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {videoClips.map((clip) => (
        <Sequence
          key={clip.id}
          from={clipFrom(clip, f)}
          durationInFrames={clipFrames(clip, f)}
          layout="none"
        >
          <Video
            src={clip.src}
            startFrom={clipStartFrom(clip, f)}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </Sequence>
      ))}
      {audioClips.map((clip) => (
        <Sequence
          key={clip.id}
          from={clipFrom(clip, f)}
          durationInFrames={clipFrames(clip, f)}
          layout="none"
        >
          <Audio src={clip.src} startFrom={clipStartFrom(clip, f)} volume={clip.volume ?? 1} />
        </Sequence>
      ))}
      {overlays.map((overlay) => (
        <Sequence
          key={overlay.id}
          from={msToFrames(overlay.startMs, f)}
          durationInFrames={msToFrames(overlay.durationMs, f)}
          layout="none"
        >
          <OverlayText overlay={overlay} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
