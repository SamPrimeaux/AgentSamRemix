import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { Clapperboard } from 'lucide-react';
import type { MovieModeStudioProps } from './types';
import { MovieModeComposition } from './MovieModeComposition';
import { TimelineRail } from './TimelineRail';
import { TextOverlayEditor } from './TextOverlayEditor';
import { createEmptyTimeline, appendClipToTimeline } from './createEmptyTimeline';
import {
  applyOverlayChange,
  editSessionDurationFrames,
  timelineToEditSession,
} from './editSessionAdapter';
import { dispatchMovieModeSurfaceContext } from '../src/lib/moviemodeStudioEvents';
import { framesToMs } from './remotion-utils';
import type { MediaLibraryItem } from './types';
import { IAM_MOVIEMODE_ADD_CLIP } from './movieModeMediaEvents';
import { useMovieModeShell } from './useMovieModeShell';

export const MovieModeStudio: React.FC<MovieModeStudioProps> = ({
  timeline,
  onTimelineChange,
}) => {
  const active = timeline ?? createEmptyTimeline();
  const playerRef = useRef<PlayerRef>(null);
  const [playheadFrame, setPlayheadFrame] = useState(0);
  const playheadMs = framesToMs(playheadFrame, active.fps);
  const { binTab } = useMovieModeShell();

  const session = useMemo(() => timelineToEditSession(active), [active]);
  const durationInFrames = useMemo(() => editSessionDurationFrames(session), [session]);

  const handleSeekFrame = useCallback(
    (frame: number) => {
      const clamped = Math.max(0, Math.min(frame, durationInFrames - 1));
      setPlayheadFrame(clamped);
      playerRef.current?.seekTo(clamped);
    },
    [durationInFrames],
  );

  const addClipFromLibrary = useCallback(
    (item: MediaLibraryItem) => {
      if (!timeline) {
        onTimelineChange(appendClipToTimeline(createEmptyTimeline(), item, { startFrame: playheadFrame }));
        return;
      }
      onTimelineChange(appendClipToTimeline(timeline, item, { startFrame: playheadFrame }));
    },
    [timeline, onTimelineChange, playheadFrame],
  );

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = () => setPlayheadFrame(player.getCurrentFrame());
    player.addEventListener('frameupdate', onFrame);
    return () => player.removeEventListener('frameupdate', onFrame);
  }, [active.fps, durationInFrames]);

  useEffect(() => {
    if (playheadFrame > durationInFrames - 1) {
      setPlayheadFrame(Math.max(0, durationInFrames - 1));
    }
  }, [durationInFrames, playheadFrame]);

  useEffect(() => {
    const onAdd = (e: Event) => {
      const item = (e as CustomEvent<{ item?: MediaLibraryItem }>).detail?.item;
      if (item) addClipFromLibrary(item);
    };
    window.addEventListener(IAM_MOVIEMODE_ADD_CLIP, onAdd as EventListener);
    return () => window.removeEventListener(IAM_MOVIEMODE_ADD_CLIP, onAdd as EventListener);
  }, [addClipFromLibrary]);

  useEffect(() => {
    dispatchMovieModeSurfaceContext(timeline, false);
  }, [timeline]);

  if (!timeline) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted p-8">
        <Clapperboard size={40} className="opacity-30" />
        <p className="text-sm text-center max-w-sm">
          Pick a clip from the <strong className="text-main">media library</strong> on the
          left, or upload / import from Stream.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--scene-bg)]">
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-4 overflow-hidden relative min-w-0">
          <Player
            ref={playerRef}
            acknowledgeRemotionLicense
            component={MovieModeComposition}
            inputProps={session}
            durationInFrames={durationInFrames}
            compositionWidth={active.width}
            compositionHeight={active.height}
            fps={active.fps}
            style={{
              width: '100%',
              maxWidth: 1080,
              aspectRatio: `${active.width} / ${active.height}`,
              boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
            }}
            controls
            loop
          />
        </div>

        {binTab === 'text' ? (
          <div className="shrink-0 max-h-[min(32vh,240px)] overflow-y-auto border-t border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]">
            <p className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-muted">
              Text overlays
            </p>
            <TextOverlayEditor
              overlays={active.overlays ?? []}
              playheadMs={playheadMs}
              onChange={(overlays) => onTimelineChange(applyOverlayChange(active, overlays))}
            />
          </div>
        ) : null}
      </div>

      <TimelineRail
        timeline={active}
        onTimelineChange={onTimelineChange}
        playheadFrame={playheadFrame}
        onSeekFrame={handleSeekFrame}
      />
    </div>
  );
};
