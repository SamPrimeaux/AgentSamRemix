/** @license SPDX-License-Identifier: Apache-2.0 */
import React from 'react';
import type { DesignModeElement } from './designModeContext.ts';
import type { PaneMode } from './types.ts';

export type DesignModeOverlayProps = {
  mode: PaneMode;
  designModeOn: boolean;
  designSelections: DesignModeElement[];
  annotateFrame: string | null;
  screenshotUrl: string | null;
  annotateStrokes: Array<{ points: Array<{ x: number; y: number }>; color?: string; _live?: boolean }>;
  annotateDrawingRef: React.MutableRefObject<boolean>;
  annotateCurrentRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  setAnnotateStrokes: React.Dispatch<React.SetStateAction<Array<{ points: Array<{ x: number; y: number }>; color?: string }>>>;
  publishDesignModeSurface: (next: { active?: boolean; annotation?: unknown; selected_elements?: DesignModeElement[] }) => void;
  setMode: React.Dispatch<React.SetStateAction<PaneMode>>;
};

export function DesignModeSelectionChips({
  designModeOn,
  designSelections,
  mode,
}: Pick<DesignModeOverlayProps, 'designModeOn' | 'designSelections' | 'mode'>) {
  if (!designModeOn || designSelections.length === 0 || mode === 'annotate') return null;
  return (
    <div className="absolute bottom-2 left-2 right-2 z-30 flex flex-wrap gap-1 pointer-events-none">
      {designSelections.map((sel, i) => (
        <span
          key={`${sel.selector || i}`}
          className="pointer-events-none text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--solar-cyan)]/90 text-[var(--solar-base03)] max-w-[40%] truncate"
        >
          {String(sel.tag || 'el')}
          {sel.selector ? ` · ${String(sel.selector).slice(0, 40)}` : ''}
        </span>
      ))}
    </div>
  );
}

export function DesignModeAnnotateOverlay(p: DesignModeOverlayProps) {
  if (p.mode !== 'annotate') return null;
  const {
    annotateFrame, screenshotUrl, annotateStrokes, annotateDrawingRef,
    annotateCurrentRef, setAnnotateStrokes, publishDesignModeSurface, setMode,
  } = p;
  return (
    <div
      className="absolute top-0 left-0 right-0 bottom-0 z-20 touch-none"
      onPointerDown={(e) => {
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        annotateDrawingRef.current = true;
        annotateCurrentRef.current = [
          { x: e.clientX - rect.left, y: e.clientY - rect.top },
        ];
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!annotateDrawingRef.current) return;
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        annotateCurrentRef.current.push({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
        setAnnotateStrokes((prev) => {
          const draft = [...prev];
          const live = {
            points: [...annotateCurrentRef.current],
            color: '#38bdf8',
          };
          if (draft.length && (draft[draft.length - 1] as { _live?: boolean })._live) {
            draft[draft.length - 1] = live as typeof live & { _live?: boolean };
            (draft[draft.length - 1] as { _live?: boolean })._live = true;
          } else {
            (live as { _live?: boolean })._live = true;
            draft.push(live);
          }
          return draft;
        });
      }}
      onPointerUp={() => {
        if (!annotateDrawingRef.current) return;
        annotateDrawingRef.current = false;
        const pts = [...annotateCurrentRef.current];
        annotateCurrentRef.current = [];
        setAnnotateStrokes((prev) => {
          const cleaned = prev
            .filter((s) => !(s as { _live?: boolean })._live)
            .concat(pts.length > 1 ? [{ points: pts, color: '#38bdf8' }] : []);
          publishDesignModeSurface({
            active: true,
            annotation: {
              kind: 'strokes',
              strokes: cleaned,
              frame_data_url: annotateFrame || screenshotUrl,
            },
          });
          return cleaned;
        });
      }}
    >
      {(annotateFrame || screenshotUrl) && (
        <img
          src={annotateFrame || screenshotUrl || ''}
          alt="Annotate frame"
          className="absolute inset-0 w-full h-full object-contain pointer-events-none bg-[var(--bg-app)]"
          draggable={false}
        />
      )}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {annotateStrokes.map((s, i) => (
          <polyline
            key={i}
            fill="none"
            stroke={s.color || '#38bdf8'}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={s.points.map((pt) => `${pt.x},${pt.y}`).join(' ')}
          />
        ))}
      </svg>
      <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-2 text-[10px] font-mono text-white bg-black/60 px-2 py-1 rounded-md">
        <span>Draw to annotate · Design Mode</span>
        <button
          type="button"
          className="underline"
          onClick={() => {
            setAnnotateStrokes([]);
            publishDesignModeSurface({
              active: true,
              annotation: null,
            });
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className="underline"
          onClick={() => setMode('picker')}
        >
          Done
        </button>
      </div>
    </div>
  );
}
