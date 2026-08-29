import type { FileKind } from '../src/lib/fileKind';
import type { MovieModeTimeline } from '../src/types/moviemode';

export type MediaLibraryItem = {
  id: string;
  name: string;
  kind: FileKind;
  previewUrl: string;
  contentType?: string | null;
  size?: number | null;
  source: 'local' | 'r2' | 'api' | 'stream';
  workspacePath?: string;
  r2Bucket?: string;
  r2Key?: string;
  assetId?: string;
  vectorizeId?: string | null;
  durationSec?: number | null;
  streamUid?: string;
};

export type MovieModeStudioProps = {
  timeline: MovieModeTimeline | null;
  onTimelineChange: (timeline: MovieModeTimeline) => void;
  onExportComplete?: (r2Key: string) => void;
  onSaveToDrive?: (r2Key: string) => void;
  showMediaBin?: boolean;
  playheadFrame?: number;
  onSeekFrame?: (frame: number) => void;
};
