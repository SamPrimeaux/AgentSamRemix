import React from 'react';
import type { ActiveFile } from '../types';
import { DriveExplorerPanel } from './DriveExplorerPanel';

export const GoogleDriveExplorer: React.FC<{
  onOpenInEditor?: (file: ActiveFile) => void;
  embedded?: boolean;
}> = ({ onOpenInEditor, embedded = false }) => {
  return (
    <div
      className={`w-full h-full min-h-0 overflow-hidden flex flex-col ${
        embedded ? 'bg-transparent' : 'bg-[var(--dashboard-panel)]'
      }`}
    >
      <DriveExplorerPanel embedded={embedded} onOpenInEditor={onOpenInEditor} />
    </div>
  );
};

export default GoogleDriveExplorer;
