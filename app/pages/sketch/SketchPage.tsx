/**
 * Sketch Studio — architectural + Figma-like shell (separate from Excalidraw /draw).
 */
import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { SketchEntryScreen } from './SketchEntryScreen';
import {
  SKETCH_LOAD_EVENT,
  blueprintFloorPlanPreset,
  dispatchSketchLoad,
  type SketchStudioMode,
} from './sketchDocument';
import './sketch-studio.css';

const SketchStudioShell = lazy(() =>
  import('./SketchStudioShell').then((m) => ({ default: m.SketchStudioShell })),
);

export type SketchPageProps = {
  onEntryPhaseChange?: (entry: boolean) => void;
  onComposerHost?: (el: HTMLDivElement | null) => void;
  onMessagesHost?: (el: HTMLDivElement | null) => void;
};

export default function SketchPage({
  onEntryPhaseChange,
  onComposerHost,
  onMessagesHost,
}: SketchPageProps) {
  const [phase, setPhase] = useState<'entry' | 'studio'>('entry');
  const [initialMode, setInitialMode] = useState<SketchStudioMode>('sketch');
  const pendingLoad = useRef<{ elements?: unknown[]; mode?: SketchStudioMode; name?: string } | null>(
    null,
  );

  useEffect(() => {
    onEntryPhaseChange?.(phase === 'entry');
  }, [phase, onEntryPhaseChange]);

  const openStudio = useCallback((mode: SketchStudioMode = 'sketch') => {
    setInitialMode(mode);
    setPhase('studio');
  }, []);

  useEffect(() => {
    const onLoad = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        elements?: unknown[];
        mode?: SketchStudioMode;
        name?: string;
      };
      pendingLoad.current = d ?? null;
      if (d?.mode) setInitialMode(d.mode);
      setPhase('studio');
    };
    window.addEventListener(SKETCH_LOAD_EVENT, onLoad);
    return () => window.removeEventListener(SKETCH_LOAD_EVENT, onLoad);
  }, []);

  if (phase === 'entry') {
    return (
      <SketchEntryScreen
        onOpenSketch={() => openStudio('sketch')}
        onOpenLayout={() => openStudio('layout')}
        onOpenBlueprint={() => {
          openStudio('blueprint');
          queueMicrotask(() => {
            dispatchSketchLoad({ elements: blueprintFloorPlanPreset(), mode: 'blueprint', name: 'Floor plan starter' });
          });
        }}
        onComposerHost={onComposerHost}
        onMessagesHost={onMessagesHost}
      />
    );
  }

  return (
    <Suspense
      fallback={
        <div className="sketch-studio-loading">
          <Loader2 size={18} className="draw-entry__spin" aria-hidden />
          Loading Sketch studio…
        </div>
      }
    >
      <SketchStudioShell
        initialMode={initialMode}
        pendingLoad={pendingLoad.current}
        onBack={() => {
          pendingLoad.current = null;
          setPhase('entry');
        }}
      />
    </Suspense>
  );
}
