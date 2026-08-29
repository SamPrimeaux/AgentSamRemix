import { useEffect, useRef, useState } from 'react';
import {
  loadPersistedFsInspectionWidth,
  persistFsInspectionWidth,
  type AgentSamFsPaneMode,
} from '../../src/lib/agentSamFilesystemTypes';
import {
  resolveInspectionWidthBand,
  type FsInspectionWidthBand,
} from '../../src/lib/agentSamFsChanges';

export type FsChangesPaneController = {
  paneRef: React.RefObject<HTMLDivElement>;
  widthBand: FsInspectionWidthBand;
};

export function useFsChangesPane({ paneMode }: { paneMode: AgentSamFsPaneMode }): FsChangesPaneController {
  const [widthBand, setWidthBand] = useState<FsInspectionWidthBand>(() => {
    const w = loadPersistedFsInspectionWidth();
    return resolveInspectionWidthBand(w ?? 220);
  });
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? el.clientWidth;
      setWidthBand(resolveInspectionWidthBand(w));
      if (paneMode === 'changes' || paneMode === 'snapshot') persistFsInspectionWidth(w);
    });
    ro.observe(el);
    const initial = el.clientWidth || loadPersistedFsInspectionWidth() || 220;
    setWidthBand(resolveInspectionWidthBand(initial));
    return () => ro.disconnect();
  }, [paneMode]);

  return { paneRef, widthBand };
}
