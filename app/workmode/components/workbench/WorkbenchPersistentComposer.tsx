import React from 'react';
import { FlexFitComposer } from './FlexFitComposer';
import { ModelChoice } from '../../types';
import { cn } from '../../../lib/utils';

interface WorkbenchPersistentComposerProps {
  onSendMessage: (text: string, model?: ModelChoice) => void;
  onOpenTerminal?: () => void;
  onConnectLane?: () => void;
  placeholder?: string;
  contextLabel?: string;
  className?: string;
  onWarmAsset?: (assetName: 'monaco' | 'xterm' | 'three' | 'excalidraw') => void;
  selectedModel?: ModelChoice;
  onSelectModel?: (m: ModelChoice) => void;
  isProcessing?: boolean;
}

export const WorkbenchPersistentComposer: React.FC<WorkbenchPersistentComposerProps> = ({
  onSendMessage,
  onOpenTerminal,
  onConnectLane,
  placeholder = "Work with Agent Sam",
  className,
  selectedModel = 'gemini-3.5-flash',
  onSelectModel,
  isProcessing = false
}) => {
  return (
    <div className={cn("w-full max-w-4xl mx-auto px-2 sm:px-4 py-2 shrink-0 z-30", className)}>
      <FlexFitComposer
        onSendMessage={(text, model) => onSendMessage(text, model)}
        onOpenTerminal={onOpenTerminal}
        onOpenConnectorDrawer={onConnectLane}
        placeholder={placeholder}
        selectedModel={selectedModel}
        onSelectModel={onSelectModel}
        isProcessing={isProcessing}
      />
    </div>
  );
};

