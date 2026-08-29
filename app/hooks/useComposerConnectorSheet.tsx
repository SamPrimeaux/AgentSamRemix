import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactPortal,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { ComposerConnectorSheet } from '../components/ChatAssistant/components/ComposerConnectorSheet';
import { measureBelowComposerAnchor } from '../components/ChatAssistant/composerLayout';
import type { ChatComposerSource } from '../components/ChatAssistant/composer/types';
import { WEB_SEARCH_SOURCE, WEB_SEARCH_SOURCE_ID } from '../components/ChatAssistant/composer/types';
import {
  composerSourcesStorageKey,
  readComposerSources,
  writeComposerSources,
} from '../components/ChatAssistant/composer/composerSourcesStorage';
import { useAvailableConnectors } from '../src/hooks/useAvailableConnectors';
import type { ComposerAvailableConnector } from '../src/hooks/useAvailableConnectors';

export type UseComposerConnectorSheetOpts = {
  workspaceId?: string | null;
  sessionUserId?: string | null;
  webSearchAllowed?: boolean;
  onAttachFiles: () => void;
  onCreateImage?: () => void;
  onWebSearch?: () => void;
  onDeepResearch?: () => void;
};

export type UseComposerConnectorSheetResult = {
  composerRef: RefObject<HTMLDivElement>;
  attachButtonRef: RefObject<HTMLButtonElement>;
  composerSources: ChatComposerSource[];
  activeComposerSourceIds: Set<string>;
  attachMenuOpen: boolean;
  toggleAttachMenu: () => void;
  closeAttachMenu: () => void;
  removeComposerSource: (id: string) => void;
  toggleComposerSource: (source: ChatComposerSource, enabled: boolean) => void;
  renderAttachMenuPortal: () => ReactPortal | null;
};

export function useComposerConnectorSheet(
  opts: UseComposerConnectorSheetOpts,
): UseComposerConnectorSheetResult {
  const composerRef = useRef<HTMLDivElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachMenuStyle, setAttachMenuStyle] = useState<CSSProperties | null>(null);
  const [composerSources, setComposerSources] = useState<ChatComposerSource[]>([]);

  const { connectors, loading: connectorsLoading } = useAvailableConnectors(opts.workspaceId);
  const webSearchAllowed = opts.webSearchAllowed !== false;

  const composerSourcesKey = composerSourcesStorageKey(opts.sessionUserId, opts.workspaceId);

  useEffect(() => {
    setComposerSources(readComposerSources(composerSourcesKey));
  }, [composerSourcesKey]);

  useEffect(() => {
    writeComposerSources(composerSourcesKey, composerSources);
  }, [composerSourcesKey, composerSources]);

  const activeComposerSourceIds = useMemo(
    () => new Set(composerSources.map((s) => s.id)),
    [composerSources],
  );

  const toggleComposerSource = useCallback((source: ChatComposerSource, enabled: boolean) => {
    setComposerSources((prev) => {
      if (enabled) {
        if (prev.some((s) => s.id === source.id)) return prev;
        return [...prev, source];
      }
      return prev.filter((s) => s.id !== source.id);
    });
  }, []);

  const sourceFromConnector = useCallback(
    (item: ComposerAvailableConnector): ChatComposerSource => ({
      id: `oauth:${item.providerKey}`,
      label: item.name,
      kind: 'oauth',
      providerKey: item.providerKey,
    }),
    [],
  );

  const removeComposerSource = useCallback((id: string) => {
    setComposerSources((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const measureAttachMenu = useCallback(() => {
    setAttachMenuStyle(measureBelowComposerAnchor(composerRef.current, 480));
  }, []);

  useLayoutEffect(() => {
    if (!attachMenuOpen) {
      setAttachMenuStyle(null);
      return;
    }
    measureAttachMenu();
    const h = () => measureAttachMenu();
    window.addEventListener('resize', h);
    window.addEventListener('scroll', h, true);
    return () => {
      window.removeEventListener('resize', h);
      window.removeEventListener('scroll', h, true);
    };
  }, [attachMenuOpen, measureAttachMenu]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const node = e.target as Node;
      if (attachButtonRef.current?.contains(node)) return;
      if (attachMenuRef.current?.contains(node)) return;
      setAttachMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAttachMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [attachMenuOpen]);

  const toggleAttachMenu = useCallback(() => {
    setAttachMenuOpen((open) => !open);
  }, []);

  const closeAttachMenu = useCallback(() => {
    setAttachMenuOpen(false);
  }, []);

  const handleWebSearch = useCallback(() => {
    if (webSearchAllowed) {
      const on = activeComposerSourceIds.has(WEB_SEARCH_SOURCE_ID);
      toggleComposerSource(WEB_SEARCH_SOURCE, !on);
    }
    opts.onWebSearch?.();
  }, [activeComposerSourceIds, opts, toggleComposerSource, webSearchAllowed]);

  const renderAttachMenuPortal = useCallback(() => {
    if (typeof document === 'undefined' || !attachMenuOpen || !attachMenuStyle) return null;
    return createPortal(
      <div ref={attachMenuRef}>
        <ComposerConnectorSheet
          style={attachMenuStyle}
          connectors={connectors}
          connectorsLoading={connectorsLoading}
          activeSourceIds={activeComposerSourceIds}
          webSearchAllowed={webSearchAllowed}
          sandboxAgentAllowed={false}
          onClose={closeAttachMenu}
          onAttachFiles={() => {
            closeAttachMenu();
            opts.onAttachFiles();
          }}
          onCreateImage={() => {
            closeAttachMenu();
            opts.onCreateImage?.();
          }}
          onWebSearch={handleWebSearch}
          onDeepResearch={() => {
            closeAttachMenu();
            opts.onDeepResearch?.();
          }}
          onOpenTerminal={() => {
            closeAttachMenu();
            window.dispatchEvent(new CustomEvent('iam:open-terminal'));
          }}
          onToggleSource={toggleComposerSource}
          sourceFromConnector={sourceFromConnector}
        />
      </div>,
      document.body,
    );
  }, [
    activeComposerSourceIds,
    attachMenuOpen,
    attachMenuStyle,
    closeAttachMenu,
    connectors,
    connectorsLoading,
    handleWebSearch,
    opts,
    sourceFromConnector,
    toggleComposerSource,
    webSearchAllowed,
  ]);

  return {
    composerRef,
    attachButtonRef,
    composerSources,
    activeComposerSourceIds,
    attachMenuOpen,
    toggleAttachMenu,
    closeAttachMenu,
    removeComposerSource,
    toggleComposerSource,
    renderAttachMenuPortal,
  };
}
