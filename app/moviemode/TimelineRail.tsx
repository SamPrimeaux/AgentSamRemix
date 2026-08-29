import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Copy,
  GripVertical,
  Music,
  Scissors,
  Type,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { MovieModeTimeline } from '../src/types/moviemode';
import { MOVIEMODE_CLIP_DRAG } from './createEmptyTimeline';
import type { MediaLibraryItem } from './types';
import { appendClipToTimeline } from './createEmptyTimeline';

/* ─── constants ──────────────────────────────────────────────── */
const LABEL_W = 56;        // px — fixed track-label column
const TRACK_H = 36;        // px — clip row height
const MIN_PPF = 0.5;       // px per frame min zoom
const MAX_PPF = 10;        // px per frame max zoom
const DEFAULT_PPF = 4;

/* ─── helpers ────────────────────────────────────────────────── */
function recalcDuration(timeline: MovieModeTimeline): MovieModeTimeline {
  let max = 30;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      max = Math.max(max, clip.startFrame + clip.durationFrames);
    }
  }
  return { ...timeline, durationFrames: max };
}

function msLabel(frame: number, fps: number): string {
  const totalSec = frame / fps;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const f = frame % fps;
  return m > 0
    ? `${m}:${String(s).padStart(2, '0')}`
    : `${s}:${String(f).padStart(2, '0')}`;
}

function trackColor(type: string) {
  if (type === 'video' || type === 'image') return 'bg-[var(--solar-cyan)] text-[#0a0f14]';
  if (type === 'audio') return 'bg-[var(--solar-magenta,#e040fb)]/90 text-white';
  return 'bg-[var(--solar-amber,#ffb300)]/90 text-[#0a0f14]';
}

function trackIcon(type: string) {
  if (type === 'video' || type === 'image') return <Video size={10} />;
  if (type === 'audio') return <Music size={10} />;
  return <Type size={10} />;
}

/* ─── types ──────────────────────────────────────────────────── */
type TimelineRailProps = {
  timeline: MovieModeTimeline;
  onTimelineChange: (timeline: MovieModeTimeline) => void;
  playheadFrame?: number;
  onSeekFrame?: (frame: number) => void;
};

type DragState =
  | { kind: 'move'; trackId: string; clipId: string; startX: number; startFrame: number; liveDelta: number }
  | { kind: 'trim-left'; trackId: string; clipId: string; startX: number; origStart: number; origDur: number; liveDelta: number }
  | { kind: 'trim-right'; trackId: string; clipId: string; startX: number; origDur: number; liveDelta: number }
  | null;

/* ═══ component ══════════════════════════════════════════════════ */
export const TimelineRail: React.FC<TimelineRailProps> = ({
  timeline,
  onTimelineChange,
  playheadFrame = 0,
  onSeekFrame,
}) => {
  const [ppf, setPpf] = useState(DEFAULT_PPF);          // px per frame
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dropTargetTrackId, setDropTargetTrackId] = useState<string | null>(null);
  const dragRef = useRef<DragState>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fps = timeline.fps || 30;
  const totalPx = Math.max(timeline.durationFrames * ppf, 600);

  /* ── frame ↔ px helpers (track-body relative) ── */
  const frameFromBodyX = useCallback(
    (clientX: number, bodyEl: HTMLElement) => {
      const rect = bodyEl.getBoundingClientRect();
      const x = clientX - rect.left + (bodyEl.parentElement?.scrollLeft ?? 0);
      return Math.max(0, Math.round(x / ppf));
    },
    [ppf],
  );

  /* ── keyboard shortcuts ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteClip(selectedId);
      }
      if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        splitClip(selectedId, playheadFrame);
      }
      if ((e.key === 'd' || e.key === 'D') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        duplicateClip(selectedId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, playheadFrame, timeline]);

  /* ── clip mutations ── */
  const deleteClip = useCallback(
    (clipId: string) => {
      const next = recalcDuration({
        ...timeline,
        tracks: timeline.tracks.map((t) => ({
          ...t,
          clips: t.clips.filter((c) => c.id !== clipId),
        })),
      });
      onTimelineChange(next);
      setSelectedId(null);
    },
    [timeline, onTimelineChange],
  );

  const splitClip = useCallback(
    (clipId: string, atFrame: number) => {
      const next = {
        ...timeline,
        tracks: timeline.tracks.map((track) => {
          const clip = track.clips.find((c) => c.id === clipId);
          if (!clip) return track;
          if (atFrame <= clip.startFrame || atFrame >= clip.startFrame + clip.durationFrames)
            return track;
          const leftDur = atFrame - clip.startFrame;
          const rightDur = clip.durationFrames - leftDur;
          const left = { ...clip, durationFrames: leftDur };
          const right = {
            ...clip,
            id: `${clip.id}_split_${Date.now()}`,
            startFrame: atFrame,
            durationFrames: rightDur,
          };
          return {
            ...track,
            clips: track.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c])),
          };
        }),
      };
      onTimelineChange(next);
    },
    [timeline, onTimelineChange],
  );

  const duplicateClip = useCallback(
    (clipId: string) => {
      const next = {
        ...timeline,
        tracks: timeline.tracks.map((track) => {
          const clip = track.clips.find((c) => c.id === clipId);
          if (!clip) return track;
          const dup = {
            ...clip,
            id: `${clip.id}_dup_${Date.now()}`,
            startFrame: clip.startFrame + clip.durationFrames,
          };
          const newDur = Math.max(timeline.durationFrames, dup.startFrame + dup.durationFrames);
          return { ...track, clips: [...track.clips, dup], _dur: newDur };
        }),
      };
      const maxDur = Math.max(...next.tracks.map((t) => (t as unknown as { _dur?: number })._dur ?? 0), timeline.durationFrames);
      onTimelineChange({ ...next, durationFrames: maxDur });
    },
    [timeline, onTimelineChange],
  );

  /* ── pointer drag (move + trim) ── */
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const delta = Math.round((e.clientX - (d.kind === 'move' ? d.startX : d.startX)) / ppf);
    dragRef.current = { ...d, liveDelta: delta } as DragState;
    // force re-render
    setDropTargetTrackId((v) => v); // tiny no-op trick; use forceUpdate instead
  }, [ppf]);

  // Proper force-update via counter
  const [tick, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((n) => n + 1), []);

  const onPointerMoveReal = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const delta = Math.round((e.clientX - d.startX) / ppf);
    (dragRef.current as { liveDelta: number }).liveDelta = delta;
    forceUpdate();
  }, [ppf, forceUpdate]);

  const commitDrag = useCallback((finalDelta: number) => {
    const d = dragRef.current;
    if (!d || finalDelta === 0) { dragRef.current = null; return; }

    if (d.kind === 'move') {
      onTimelineChange({
        ...timeline,
        tracks: timeline.tracks.map((track) => {
          if (track.id !== d.trackId) return track;
          return {
            ...track,
            clips: track.clips.map((clip) =>
              clip.id === d.clipId
                ? { ...clip, startFrame: Math.max(0, d.startFrame + finalDelta) }
                : clip,
            ),
          };
        }),
      });
    } else if (d.kind === 'trim-left') {
      const newStart = Math.max(0, d.origStart + finalDelta);
      const shrink = newStart - d.origStart;
      const newDur = Math.max(1, d.origDur - shrink);
      onTimelineChange({
        ...timeline,
        tracks: timeline.tracks.map((track) => {
          if (track.id !== d.trackId) return track;
          return {
            ...track,
            clips: track.clips.map((clip) =>
              clip.id === d.clipId
                ? { ...clip, startFrame: newStart, durationFrames: newDur }
                : clip,
            ),
          };
        }),
      });
    } else if (d.kind === 'trim-right') {
      const newDur = Math.max(1, d.origDur + finalDelta);
      onTimelineChange(recalcDuration({
        ...timeline,
        tracks: timeline.tracks.map((track) => {
          if (track.id !== d.trackId) return track;
          return {
            ...track,
            clips: track.clips.map((clip) =>
              clip.id === d.clipId ? { ...clip, durationFrames: newDur } : clip,
            ),
          };
        }),
      }));
    }
    dragRef.current = null;
  }, [timeline, onTimelineChange]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    commitDrag(d.liveDelta ?? 0);
    forceUpdate();
  }, [commitDrag, forceUpdate]);

  /* ── seek on ruler / track click ── */
  const onRulerClick = (e: React.MouseEvent, rulerEl: HTMLElement) => {
    const rect = rulerEl.getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
    onSeekFrame?.(Math.max(0, Math.round(x / ppf)));
  };

  const onTrackBodyClick = (e: React.MouseEvent, trackBodyEl: HTMLElement) => {
    if (dragRef.current) return;
    if ((e.target as HTMLElement).closest('[data-clip]')) return;
    const frame = frameFromBodyX(e.clientX, trackBodyEl);
    onSeekFrame?.(frame);
  };

  /* ── drop from media panel ── */
  const onTrackDragOver = (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropTargetTrackId(trackId);
  };

  const onTrackDrop = (e: React.DragEvent, trackId: string, trackType: string, trackBodyEl: HTMLElement) => {
    e.preventDefault();
    setDropTargetTrackId(null);
    const raw = e.dataTransfer.getData(MOVIEMODE_CLIP_DRAG);
    if (!raw) return;
    let item: MediaLibraryItem;
    try { item = JSON.parse(raw) as MediaLibraryItem; } catch { return; }
    const wantsAudio = item.kind === 'audio';
    const wantsVideo = item.kind === 'video' || item.kind === 'image';
    if (wantsAudio && trackType !== 'audio') return;
    if (wantsVideo && trackType !== 'video') return;
    const startFrame = frameFromBodyX(e.clientX, trackBodyEl);
    onTimelineChange(appendClipToTimeline(timeline, item, { startFrame }));
  };

  /* ── add text clip ── */
  const addTextClip = () => {
    const track = timeline.tracks.find((t) => t.type === 'text');
    if (!track) return;
    const id = `text_${Date.now()}`;
    onTimelineChange({
      ...timeline,
      durationFrames: Math.max(timeline.durationFrames, playheadFrame + 90),
      tracks: timeline.tracks.map((t) =>
        t.id === track.id
          ? { ...t, clips: [...t.clips, { id, startFrame: playheadFrame, durationFrames: 90, text: 'Title' }] }
          : t,
      ),
    });
  };

  /* ── ruler ticks ── */
  const rulerTicks = () => {
    const ticks: React.ReactNode[] = [];
    const framesPerSecond = fps;
    // decide tick interval in frames: want roughly 60–120px between ticks
    const targetPx = 80;
    let intervalFrames = framesPerSecond; // 1 sec minimum
    if (intervalFrames * ppf < 40) intervalFrames = framesPerSecond * 5;
    if (intervalFrames * ppf < 40) intervalFrames = framesPerSecond * 10;
    if (intervalFrames * ppf < 40) intervalFrames = framesPerSecond * 30;
    const totalFrames = timeline.durationFrames + intervalFrames * 2;
    for (let f = 0; f <= totalFrames; f += intervalFrames) {
      const x = f * ppf;
      ticks.push(
        <div
          key={f}
          className="absolute top-0 flex flex-col items-center pointer-events-none"
          style={{ left: x }}
        >
          <div className="w-px h-2 bg-[var(--border-subtle)]" />
          <span className="text-[8px] text-muted tabular-nums select-none whitespace-nowrap" style={{ transform: 'translateX(-50%)' }}>
            {msLabel(f, fps)}
          </span>
        </div>
      );
    }
    return ticks;
  };

  /* ── render ── */
  const playheadLeft = playheadFrame * ppf;

  return (
    <div
      className="shrink-0 border-t border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] flex flex-col select-none"
      style={{ minHeight: 180, maxHeight: '40vh' }}
    >
      {/* ── toolbar ── */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-[var(--border-subtle)] shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted mr-1">
          Timeline
        </span>

        {/* timecode */}
        <span className="text-[9px] text-[var(--solar-cyan)] tabular-nums font-mono">
          {msLabel(playheadFrame, fps)}
          <span className="text-muted"> / {msLabel(timeline.durationFrames, fps)}</span>
        </span>

        <div className="flex-1" />

        {/* selected clip actions */}
        {selectedId && (() => {
          const clip = timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedId);
          return clip ? (
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                title="Split at playhead (S)"
                onClick={() => splitClip(selectedId, playheadFrame)}
                className="p-1 rounded text-muted hover:text-main hover:bg-[var(--bg-hover)]"
              >
                <Scissors size={12} />
              </button>
              <button
                type="button"
                title="Duplicate (D)"
                onClick={() => duplicateClip(selectedId)}
                className="p-1 rounded text-muted hover:text-main hover:bg-[var(--bg-hover)]"
              >
                <Copy size={12} />
              </button>
              <button
                type="button"
                title="Delete (Del)"
                onClick={() => deleteClip(selectedId)}
                className="p-1 rounded text-red-400 hover:text-red-300 hover:bg-[var(--bg-hover)]"
              >
                <X size={12} />
              </button>
              <div className="w-px h-4 bg-[var(--border-subtle)] mx-0.5" />
            </div>
          ) : null;
        })()}

        {/* add text overlay */}
        <button
          type="button"
          onClick={addTextClip}
          className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-[var(--dashboard-border)] hover:border-[var(--solar-cyan)] text-main"
        >
          <Type size={11} /> Text
        </button>

        {/* zoom controls */}
        <div className="flex items-center gap-0.5 ml-1">
          <button
            type="button"
            onClick={() => setPpf((p) => Math.max(MIN_PPF, +(p / 1.5).toFixed(2)))}
            className="p-1 rounded text-muted hover:text-main hover:bg-[var(--bg-hover)]"
            title="Zoom out"
          >
            <ZoomOut size={13} />
          </button>
          <input
            type="range"
            min={MIN_PPF}
            max={MAX_PPF}
            step={0.25}
            value={ppf}
            onChange={(e) => setPpf(+e.target.value)}
            className="w-16 h-1 accent-[var(--solar-cyan)]"
            title={`Zoom: ${ppf}px/frame`}
          />
          <button
            type="button"
            onClick={() => setPpf((p) => Math.min(MAX_PPF, +(p * 1.5).toFixed(2)))}
            className="p-1 rounded text-muted hover:text-main hover:bg-[var(--bg-hover)]"
            title="Zoom in"
          >
            <ZoomIn size={13} />
          </button>
        </div>
      </div>

      {/* ── scroll area ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* fixed label column */}
        <div
          className="shrink-0 flex flex-col border-r border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]"
          style={{ width: LABEL_W }}
        >
          {/* ruler spacer */}
          <div style={{ height: 22 }} className="border-b border-[var(--border-subtle)]" />
          {/* track labels */}
          {timeline.tracks.map((track) => (
            <div
              key={track.id}
              className="shrink-0 flex items-center justify-center gap-1 border-b border-[var(--border-subtle)] text-[9px] font-semibold uppercase tracking-wider text-muted"
              style={{ height: TRACK_H + 8 }}
            >
              {trackIcon(track.type)}
              <span>{track.type === 'text' ? 'txt' : track.type.slice(0, 3)}</span>
            </div>
          ))}
        </div>

        {/* scrollable track area */}
        <div
          ref={scrollRef}
          className={`flex-1 min-w-0 overflow-x-auto overflow-y-hidden ${dragRef.current ? 'cursor-grabbing' : ''}`}
          onPointerMove={onPointerMoveReal}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="relative" style={{ width: totalPx, minWidth: '100%' }}>

            {/* playhead */}
            <div
              className="absolute top-0 bottom-0 w-px bg-[var(--solar-cyan)] z-30 pointer-events-none"
              style={{ left: playheadLeft }}
              aria-hidden
            >
              {/* playhead head */}
              <div className="absolute -top-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-[var(--solar-cyan)] rotate-45" />
            </div>

            {/* ruler */}
            <div
              role="presentation"
              className="relative border-b border-[var(--border-subtle)] cursor-pointer"
              style={{ height: 22, width: totalPx }}
              onClick={(e) => onRulerClick(e, e.currentTarget)}
            >
              {rulerTicks()}
            </div>

            {/* tracks */}
            {timeline.tracks.map((track) => {
              const isDropTarget = dropTargetTrackId === track.id;
              return (
                <div
                  key={track.id}
                  role="presentation"
                  className={`relative border-b ${isDropTarget ? 'border-[var(--solar-cyan)] bg-[var(--solar-cyan)]/5' : 'border-[var(--border-subtle)] bg-[var(--scene-bg)]'}`}
                  style={{ height: TRACK_H + 8, width: totalPx }}
                  onClick={(e) => onTrackBodyClick(e, e.currentTarget)}
                  onDragOver={(e) => onTrackDragOver(e, track.id)}
                  onDragLeave={() => setDropTargetTrackId(null)}
                  onDrop={(e) => onTrackDrop(e, track.id, track.type, e.currentTarget)}
                >
                  {track.clips.length === 0 && (
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] text-muted opacity-40 pointer-events-none">
                      Drop · click to seek
                    </span>
                  )}

                  {track.clips.map((clip) => {
                    const isSelected = selectedId === clip.id;
                    const meta = clip.metadata as { name?: string } | undefined;
                    const label = clip.text || meta?.name || clip.id;

                    // live drag offsets
                    let liveStart = clip.startFrame;
                    let liveDur = clip.durationFrames;
                    const d = dragRef.current;
                    if (d && d.clipId === clip.id && d.liveDelta) {
                      if (d.kind === 'move') liveStart = Math.max(0, clip.startFrame + d.liveDelta);
                      else if (d.kind === 'trim-left') {
                        const trimmed = Math.max(0, (d as { origStart: number; origDur: number }).origStart + d.liveDelta);
                        liveDur = Math.max(1, (d as { origDur: number }).origDur - (trimmed - (d as { origStart: number }).origStart));
                        liveStart = trimmed;
                      } else if (d.kind === 'trim-right') {
                        liveDur = Math.max(1, (d as { origDur: number }).origDur + d.liveDelta);
                      }
                    }

                    const leftPx = liveStart * ppf;
                    const widthPx = Math.max(liveDur * ppf, 8);
                    const colorCls = trackColor(track.type);

                    return (
                      <div
                        key={clip.id}
                        data-clip
                        className={`absolute top-1 rounded flex items-center overflow-hidden z-10 group ${colorCls} ${isSelected ? 'ring-2 ring-white/70 ring-offset-1 ring-offset-[var(--scene-bg)]' : 'opacity-90 hover:opacity-100'}`}
                        style={{ left: leftPx, width: widthPx, bottom: 4 }}
                        onClick={(e) => { e.stopPropagation(); setSelectedId(clip.id === selectedId ? null : clip.id); }}
                      >
                        {/* trim-left handle */}
                        <div
                          className="absolute left-0 top-0 bottom-0 w-2 cursor-w-resize z-20 flex items-center justify-center hover:bg-black/20"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            (e.target as HTMLElement).setPointerCapture(e.pointerId);
                            dragRef.current = { kind: 'trim-left', trackId: track.id, clipId: clip.id, startX: e.clientX, origStart: clip.startFrame, origDur: clip.durationFrames, liveDelta: 0 };
                            forceUpdate();
                          }}
                        >
                          <div className="w-px h-3/4 bg-black/30 rounded" />
                        </div>

                        {/* main body: drag to move */}
                        <div
                          className="flex-1 flex items-center gap-0.5 px-2 cursor-grab active:cursor-grabbing min-w-0"
                          onPointerDown={(e) => {
                            if ((e.target as HTMLElement).closest('[data-trim]')) return;
                            e.stopPropagation();
                            e.preventDefault();
                            (e.target as HTMLElement).setPointerCapture(e.pointerId);
                            dragRef.current = { kind: 'move', trackId: track.id, clipId: clip.id, startX: e.clientX, startFrame: clip.startFrame, liveDelta: 0 };
                            forceUpdate();
                          }}
                        >
                          <GripVertical size={9} className="shrink-0 opacity-50" />
                          <span className="truncate text-[10px] font-medium leading-none">{label}</span>
                        </div>

                        {/* delete button on selected */}
                        {isSelected && widthPx > 40 && (
                          <button
                            type="button"
                            data-clip
                            className="absolute top-0.5 right-5 p-0.5 rounded bg-black/30 hover:bg-red-500/70 z-20"
                            onClick={(e) => { e.stopPropagation(); deleteClip(clip.id); }}
                            title="Delete clip"
                          >
                            <X size={9} />
                          </button>
                        )}

                        {/* trim-right handle */}
                        <div
                          data-trim
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-e-resize z-20 flex items-center justify-center hover:bg-black/20"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            (e.target as HTMLElement).setPointerCapture(e.pointerId);
                            dragRef.current = { kind: 'trim-right', trackId: track.id, clipId: clip.id, startX: e.clientX, origDur: clip.durationFrames, liveDelta: 0 };
                            forceUpdate();
                          }}
                        >
                          <div className="w-px h-3/4 bg-black/30 rounded" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
