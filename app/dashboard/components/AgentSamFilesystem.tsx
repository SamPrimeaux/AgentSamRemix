import React, { useEffect, useState } from 'react';
import type { ActiveFile } from '../types';
import {
  loadPersistedAgentSamFsSource,
  type AgentSamFsSource,
} from '../src/lib/agentSamFilesystemTypes';
import { AgentSamFilesystemView } from './AgentSamFilesystemView';
import { useLocalFsaFolder } from '../hooks/useLocalFsaFolder';
import { useR2FilesPane } from '../hooks/useR2FilesPane';

export type AgentSamFilesystemProps = {
  onFileSelect: (file: ActiveFile) => void;
  onWorkspaceRootChange?: (info: { folderName: string }) => void;
  onOpenInEditor?: (file: ActiveFile) => void;
  nativeFolderOpenSignal?: number;
  workspace_id?: string | null;
  user_id?: string | null;
  onClose?: () => void;
  pinnedGithubRepo?: string | null;
};

export const AgentSamFilesystem: React.FC<AgentSamFilesystemProps> = ({
  onFileSelect,
  onWorkspaceRootChange,
  onOpenInEditor,
  nativeFolderOpenSignal = 0,
  workspace_id = null,
  user_id = null,
  onClose,
  pinnedGithubRepo = null,
}) => {
  const [googleDriveOAuthRefresh, setGoogleDriveOAuthRefresh] = useState(0);
  const [unifiedSource, setUnifiedSource] = useState<AgentSamFsSource>(
    () => loadPersistedAgentSamFsSource() ?? 'local',
  );
  const local = useLocalFsaFolder({
    onFileSelect,
    onOpenInEditor,
    onWorkspaceRootChange,
    nativeFolderOpenSignal,
  });
  const r2 = useR2FilesPane({
    userId: user_id,
    activeSource: unifiedSource,
    onOpenInEditor,
  });

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('connected') === 'google' && params.get('success') === 'true') {
        setUnifiedSource('drive');
        setGoogleDriveOAuthRefresh((n) => n + 1);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'oauth_success' && e.data?.provider === 'google') {
        setUnifiedSource('drive');
        setGoogleDriveOAuthRefresh((n) => n + 1);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <AgentSamFilesystemView
      local={local}
      r2={r2}
      onClose={onClose}
      onOpenInEditor={onOpenInEditor}
      workspace_id={workspace_id}
      googleDriveOAuthRefresh={googleDriveOAuthRefresh}
      onSourceActivated={setUnifiedSource}
      pinnedGithubRepo={pinnedGithubRepo}
    />
  );
};

export default AgentSamFilesystem;
