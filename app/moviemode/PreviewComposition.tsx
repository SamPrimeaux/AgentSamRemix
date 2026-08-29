import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, Video } from 'remotion';
import type { MovieModeTimeline } from '../src/types/moviemode';

export type PreviewCompositionProps = {
  timeline: MovieModeTimeline;
};

function clipSrc(clip: MovieModeTimeline['tracks'][0]['clips'][0]): string {
  const meta = clip.metadata as { previewUrl?: string } | undefined;
  if (meta?.previewUrl) return meta.previewUrl;
  if (clip.r2?.bucket && clip.r2?.key) {
    return `/api/r2/buckets/${encodeURIComponent(clip.r2.bucket)}/object/${encodeURIComponent(clip.r2.key)}`;
  }
  return '';
}

export const PreviewComposition: React.FC<PreviewCompositionProps> = ({ timeline }) => {
  const videoTracks = timeline.tracks.filter((t) => t.type === 'video' || t.type === 'image');
  const audioTracks = timeline.tracks.filter((t) => t.type === 'audio');
  const textTracks = timeline.tracks.filter((t) => t.type === 'text');

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0f' }}>
      {videoTracks.flatMap((track) =>
        track.clips.map((clip) => {
          const src = clipSrc(clip);
          if (!src) return null;
          const isImage = track.type === 'image';
          return (
            <Sequence
              key={`${track.id}-${clip.id}`}
              from={clip.startFrame}
              durationInFrames={clip.durationFrames}
            >
              <AbsoluteFill
                style={{
                  justifyContent: 'center',
                  alignItems: 'center',
                  objectFit: clip.fit || 'contain',
                }}
              >
                {isImage ? (
                  <Img src={src} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: clip.fit || 'contain' }} />
                ) : (
                  <Video
                    src={src}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: clip.fit || 'contain' }}
                    volume={clip.volume ?? 1}
                  />
                )}
              </AbsoluteFill>
            </Sequence>
          );
        }),
      )}
      {audioTracks.flatMap((track) =>
        track.clips.map((clip) => {
          const src = clipSrc(clip);
          if (!src) return null;
          return (
            <Sequence
              key={`${track.id}-${clip.id}`}
              from={clip.startFrame}
              durationInFrames={clip.durationFrames}
            >
              <Audio src={src} volume={clip.volume ?? 1} />
            </Sequence>
          );
        }),
      )}
      {textTracks.flatMap((track) =>
        track.clips.map((clip) => (
          <Sequence
            key={`${track.id}-${clip.id}`}
            from={clip.startFrame}
            durationInFrames={clip.durationFrames}
          >
            <AbsoluteFill
              style={{
                justifyContent: 'flex-end',
                alignItems: 'center',
                paddingBottom: 48,
              }}
            >
              <div
                style={{
                  color: '#fff',
                  fontSize: 42,
                  fontWeight: 700,
                  textShadow: '0 2px 12px rgba(0,0,0,0.8)',
                  padding: '8px 24px',
                }}
              >
                {clip.text || 'Text'}
              </div>
            </AbsoluteFill>
          </Sequence>
        )),
      )}
    </AbsoluteFill>
  );
};
