import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import type { ActiveFile } from '../types';
import type { PlanQuestionsBatchPayload } from '../components/ChatAssistant/types';
import type { QuestionsIntakePageSubmitPayload } from './components/QuestionsIntakePage';

/**
 * IDE Editor Context — Handles multi-tab buffers and state.
 */

/**
 * Live state for the 'questions_intake' tab (Agent Sam plan-intake Questions
 * surface). Holds the current plan_questions_batch payload plus the busy flag
 * and submit handler owned by ChatAssistant's handlePlanIntakeSubmit, so
 * MonacoEditorView can render QuestionsIntakePage without prop-drilling
 * through the chat <-> editor split.
 */
export type QuestionsIntakeState = {
  batch: PlanQuestionsBatchPayload;
  busy: boolean;
  onSubmit: (payload: QuestionsIntakePageSubmitPayload) => void;
} | null;

export interface EditorTab extends ActiveFile {
  id: string; // Typically the file path
  isDirty: boolean;
  lastSavedContent: string;
}

interface EditorContextType {
  tabs: EditorTab[];
  activeTabId: string | null;
  openFile: (file: ActiveFile) => void;
  closeFile: (id: string) => void;
  /** Close only tabs whose buffer matches lastSavedContent (clean). */
  closeSavedFiles: () => void;
  /** Close all tabs. Returns list of dirty tab ids that were closed. */
  closeAllFiles: () => string[];
  /** Number of open tabs with unsaved changes. */
  dirtyFileCount: number;
  setActiveTab: (id: string) => void;
  updateActiveContent: (content: string) => void;
  updateActiveFile: (updates: Partial<ActiveFile> | ((prev: ActiveFile | null) => ActiveFile | null)) => void;
  saveActiveFile: (onSave: (id: string, content: string) => Promise<void>) => Promise<void>;
  discardChanges: (id: string) => void;
  questionsIntake: QuestionsIntakeState;
  setQuestionsIntake: (state: QuestionsIntakeState) => void;
}

const EditorContext = createContext<EditorContextType | undefined>(undefined);

export const EditorProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [questionsIntake, setQuestionsIntake] = useState<QuestionsIntakeState>(null);

  /**
   * Tab identity must be unique across *sources*, not just basename — two files
   * named e.g. "README.md" from different GitHub repos, or a GitHub file vs a
   * same-named local/R2 file, previously collapsed into one tab (id was just
   * `workspacePath || name`) and silently overwrote each other's content.
   * Composite key by source first, falling back to name only when no source
   * identifier is present (e.g. a brand-new unsaved buffer).
   */
  const getFileId = (file: ActiveFile) => {
    if (file.githubRepo && file.githubPath) return `github:${file.githubRepo}:${file.githubPath}`;
    if (file.r2Bucket && file.r2Key) return `r2:${file.r2Bucket}:${file.r2Key}`;
    if (file.driveFileId) return `drive:${file.driveFileId}`;
    if (file.workspacePath) return `local:${file.workspacePath}`;
    return `name:${file.name}`;
  };

  const openFile = useCallback((file: ActiveFile) => {
    const id = getFileId(file);
    const isMedia = Boolean(
      file.fileKind && file.fileKind !== 'text' && file.fileKind !== 'truncated',
    );
    setTabs(prev => {
      const existing = prev.find((t) => t.id === id);
      if (existing) {
        return prev.map((t) => {
          if (t.id !== id) return t;
          const savedBaseline =
            file.originalContent !== undefined
              ? file.originalContent
              : isMedia
                ? t.lastSavedContent
                : file.content;
          const merged: EditorTab = {
            ...t,
            ...file,
            id,
            isDirty: isMedia ? false : file.content !== savedBaseline,
            lastSavedContent: isMedia ? t.lastSavedContent : savedBaseline,
          };
          return merged;
        });
      }

      const savedBaseline =
        file.originalContent !== undefined ? file.originalContent : isMedia ? '' : file.content;
      const newTab: EditorTab = {
        ...file,
        id,
        isDirty: isMedia ? false : file.content !== savedBaseline,
        lastSavedContent: savedBaseline,
      };
      return [...prev, newTab];
    });
    setActiveTabId(id);
  }, []);

  const closeFile = useCallback((id: string) => {
    setTabs(prev => {
      const filtered = prev.filter(t => t.id !== id);
      if (activeTabId === id) {
        setActiveTabId(filtered.length > 0 ? filtered[filtered.length - 1].id : null);
      }
      return filtered;
    });
  }, [activeTabId]);

  const closeSavedFiles = useCallback(() => {
    setTabs(prev => {
      const remaining = prev.filter(t => t.isDirty);
      if (remaining.length === prev.length) return prev;
      const activeStillOpen = remaining.some(t => t.id === activeTabId);
      if (!activeStillOpen) {
        setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
      }
      return remaining;
    });
  }, [activeTabId]);

  const closeAllFiles = useCallback(() => {
    const dirtyIds = tabs.filter(t => t.isDirty).map(t => t.id);
    setTabs([]);
    setActiveTabId(null);
    return dirtyIds;
  }, [tabs]);

  const dirtyFileCount = useMemo(() => tabs.filter(t => t.isDirty).length, [tabs]);

  const updateActiveContent = useCallback((content: string) => {
    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) {
        const savedContent = t.originalContent ?? t.lastSavedContent;
        return { ...t, content, isDirty: content !== savedContent };
      }
      return t;
    }));
  }, [activeTabId]);

  const updateActiveFile = useCallback((updates: Partial<ActiveFile> | ((prev: ActiveFile | null) => ActiveFile | null)) => {
    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) {
        const currentAsActiveFile: ActiveFile = { ...t };
        const result = typeof updates === 'function' ? updates(currentAsActiveFile) : { ...t, ...updates };
        if (!result) return t; // Handle null from functional update
        const savedContent = result.originalContent ?? t.lastSavedContent;
        return {
          ...t,
          ...result,
          isDirty: result.content !== savedContent,
          lastSavedContent: result.content === savedContent ? savedContent : t.lastSavedContent,
        };
      }
      return t;
    }));
  }, [activeTabId]);

  const saveActiveFile = useCallback(async (onSave: (id: string, content: string) => Promise<void>) => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;
    
    await onSave(tab.id, tab.content);
    
    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) {
        return {
          ...t,
          originalContent: t.content,
          isDirty: false,
          lastSavedContent: t.content,
        };
      }
      return t;
    }));
  }, [activeTabId, tabs]);

  const discardChanges = useCallback((id: string) => {
    setTabs(prev => prev.map(t => {
      if (t.id === id) {
        return { ...t, content: t.lastSavedContent, isDirty: false };
      }
      return t;
    }));
  }, []);

  return (
    <EditorContext.Provider value={{ 
      tabs, 
      activeTabId, 
      openFile, 
      closeFile,
      closeSavedFiles,
      closeAllFiles,
      dirtyFileCount,
      setActiveTab: setActiveTabId,
      updateActiveContent,
      updateActiveFile,
      saveActiveFile,
      discardChanges,
      questionsIntake,
      setQuestionsIntake
    }}>
      {children}
    </EditorContext.Provider>
  );
};

export const useEditor = () => {
  const context = useContext(EditorContext);
  if (!context) throw new Error('useEditor must be used within EditorProvider');
  return context;
};
