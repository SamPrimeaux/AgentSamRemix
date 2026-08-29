import React from 'react';
import { useLocation } from 'react-router-dom';
import { ChatAssistant } from '../ChatAssistant/ChatAssistant';
import type { ChatAssistantProps } from '../ChatAssistant/types';
import { ProjectType } from '../../types';
import { useDesignStudioContext } from './DesignStudioContext';

type Props = Omit<ChatAssistantProps, 'activeProject'> & {
  fallbackProject?: ProjectType;
};

/** Syncs Design Studio mode into ChatAssistant contextMode when on /dashboard/designstudio. */
export function ChatAssistantWithStudioContext({
  fallbackProject = ProjectType.CAD,
  ...props
}: Props) {
  const location = useLocation();
  const studio = useDesignStudioContext();
  const onDesignStudio = location.pathname.startsWith('/dashboard/designstudio');
  const activeProject = onDesignStudio ? studio.activeProject : fallbackProject;

  return (
    <ChatAssistant
      {...props}
      activeProject={activeProject}
      designStudioSceneId={onDesignStudio ? studio.sceneId : undefined}
      designStudioBlueprintId={onDesignStudio ? studio.blueprintId : undefined}
      designStudioCadJobId={onDesignStudio ? studio.cadJobId : undefined}
    />
  );
}
