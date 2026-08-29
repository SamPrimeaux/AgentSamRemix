import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type PointerEvent, type ReactNode } from 'react';
import { ChatAssistantWithStudioContext } from '../designstudio/ChatAssistantWithStudioContext';
import { ChatScratchpadRail } from '../ChatAssistant/components/ChatScratchpadRail';
import type { AgentGeneratedFile } from '../ChatAssistant/types';
import type { AgentChatLayout } from '../../lib/shellLayoutMeta';

const AGENT_RESIZER_HIT_PX = 10;
const SCRATCHPAD_RAIL_W_PX = 220;

type StudioChatProps = ComponentProps<typeof ChatAssistantWithStudioContext>;

export type AgentSamChatHostProps = StudioChatProps & {
  layout: AgentChatLayout;
  agentW: number;
  isNarrowViewport: boolean;
  activeActivity: string | null;
  narrowNeedsBack: boolean;
  mobileEdgeSwipeHandlers?: Record<string, unknown>;
  productLabel: string;
  onResizePointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
  /** When true on phone, leave bottom space for the docked terminal panel. */
  terminalOpen?: boolean;
};

function ChatWithScratchpadRail({
  chat,
  messages,
  onFileSelect,
  scratchpadOpen,
  showScratchpadRail,
  onCloseScratchpad,
}: {
  chat: ReactNode;
  messages: StudioChatProps['messages'];
  onFileSelect?: StudioChatProps['onFileSelect'];
  scratchpadOpen: boolean;
  showScratchpadRail: boolean;
  onCloseScratchpad?: () => void;
}) {
  const openScratchpadFile = useCallback(
    (file: AgentGeneratedFile) => {
      if (file.kind === 'image' || /\.(png|jpe?g|webp|gif)$/i.test(file.filename)) {
        if (file.r2Url && typeof window !== 'undefined') {
          window.open(file.r2Url, '_blank', 'noopener,noreferrer');
        }
        return;
      }
      if (file.content) {
        onFileSelect?.({
          name: file.filename,
          content: file.content,
          workspacePath: file.workspacePath,
        });
        return;
      }
      if (file.r2Url) {
        void fetch(file.r2Url, { credentials: 'include' })
          .then((r) => r.text())
          .then((content) =>
            onFileSelect?.({
              name: file.filename,
              content,
              workspacePath: file.workspacePath,
            }),
          )
          .catch((e) => console.warn('[AgentSamChatHost] scratchpad open failed', e));
      }
    },
    [onFileSelect],
  );

  return (
    <div className="flex flex-row flex-1 min-h-0 min-w-0 overflow-hidden">
      <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden flex-col">{chat}</div>
      {scratchpadOpen && showScratchpadRail ? (
        <div
          className="shrink-0 min-h-0 max-phone:hidden flex flex-col"
          style={{ width: SCRATCHPAD_RAIL_W_PX }}
        >
          <ChatScratchpadRail
            messages={messages}
            onOpenFile={openScratchpadFile}
            onClose={onCloseScratchpad}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Single ChatAssistant mount — center (portals), left rail, or right rail. */
export function AgentSamChatHost({
  layout,
  agentW,
  isNarrowViewport,
  activeActivity,
  narrowNeedsBack,
  mobileEdgeSwipeHandlers,
  productLabel,
  onResizePointerDown,
  terminalOpen = false,
  atmosphericHomeMode,
  composerPortalTarget,
  messagesPortalTarget,
  messages,
  onFileSelect,
  ...chatProps
}: AgentSamChatHostProps) {
  const phoneTerminalBottom =
    isNarrowViewport && terminalOpen ? 'var(--terminal-panel-h, 0px)' : undefined;
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const autoOpenedRef = useRef(false);
  /** User closed the rail — do not auto-reopen until artifacts clear or they open again. */
  const userDismissedRef = useRef(false);

  // Badge count = all files. Auto-open only for agent-generated artifacts (not user
  // attach) — tkt_scratchpad_collapsed: default collapsed; attach must not stick rail open.
  const scratchpadFileCount = useMemo(() => {
    if (!messages) return 0;
    let n = 0;
    for (const m of messages) {
      n += (m.attachmentPreviews ?? []).length;
      const agentN = (m.agentFiles ?? []).length;
      if (agentN > 0) {
        n += agentN;
      } else {
        n += (m.imageGenerationState?.previewFrames ?? []).filter((f) => f.previewUrl).length;
      }
    }
    return n;
  }, [messages]);

  const agentArtifactCount = useMemo(() => {
    if (!messages) return 0;
    let n = 0;
    for (const m of messages) {
      n += (m.agentFiles ?? []).length;
      if (!(m.agentFiles ?? []).length) {
        n += (m.imageGenerationState?.previewFrames ?? []).filter((f) => f.previewUrl).length;
      }
    }
    return n;
  }, [messages]);

  // Auto-open once when the agent produces an artifact — never for user uploads alone.
  useEffect(() => {
    if (autoOpenedRef.current || userDismissedRef.current) return;
    if (agentArtifactCount > 0 && !isNarrowViewport && !atmosphericHomeMode) {
      setScratchpadOpen(true);
      autoOpenedRef.current = true;
    }
  }, [agentArtifactCount, isNarrowViewport, atmosphericHomeMode]);

  // Reset auto-open / dismiss guards when conversation clears artifacts.
  const prevArtifactCount = useRef(agentArtifactCount);
  useEffect(() => {
    if (agentArtifactCount === 0 && prevArtifactCount.current > 0) {
      autoOpenedRef.current = false;
      userDismissedRef.current = false;
      setScratchpadOpen(false);
    }
    prevArtifactCount.current = agentArtifactCount;
  }, [agentArtifactCount]);

  const toggleScratchpad = useCallback(() => {
    setScratchpadOpen((v) => {
      const next = !v;
      userDismissedRef.current = !next;
      if (next) autoOpenedRef.current = true;
      return next;
    });
  }, []);

  const closeScratchpad = useCallback(() => {
    userDismissedRef.current = true;
    setScratchpadOpen(false);
  }, []);

  if (layout === 'hidden') return null;

  const showScratchpadRail = !isNarrowViewport && !atmosphericHomeMode;

  const chat = (
    <ChatAssistantWithStudioContext
      {...chatProps}
      messages={messages}
      onFileSelect={onFileSelect}
      atmosphericHomeMode={atmosphericHomeMode}
      composerPortalTarget={composerPortalTarget}
      messagesPortalTarget={messagesPortalTarget}
      onToggleScratchpad={toggleScratchpad}
      scratchpadOpen={scratchpadOpen}
      scratchpadFileCount={scratchpadFileCount}
    />
  );

  const chatColumn = (
    <ChatWithScratchpadRail
      chat={chat}
      messages={messages}
      onFileSelect={onFileSelect}
      scratchpadOpen={scratchpadOpen}
      showScratchpadRail={showScratchpadRail}
      onCloseScratchpad={closeScratchpad}
    />
  );

  if (layout === 'center') {
    return (
      <div
        className={`absolute inset-x-0 top-0 z-20 flex flex-col min-h-0 min-w-0 w-full overflow-hidden ${
          phoneTerminalBottom ? '' : 'bottom-0'
        } ${
          atmosphericHomeMode && composerPortalTarget
            ? 'pointer-events-none bg-transparent'
            : 'bg-[var(--dashboard-panel)]'
        }`}
        style={phoneTerminalBottom ? { bottom: phoneTerminalBottom } : undefined}
        aria-label="Agent Sam chat"
      >
        {chatColumn}
      </div>
    );
  }

  const isLeft = layout === 'left-rail';
  const borderStyle = isLeft
    ? { borderRight: '1px solid var(--dashboard-border)' }
    : { borderLeft: '1px solid var(--dashboard-border)' };

  const panel = (
    <div
      className={`bg-[var(--dashboard-panel)] flex flex-col shrink-0 transition-opacity relative group z-30 opacity-100 max-phone:fixed max-phone:inset-x-0 max-phone:z-[45] max-phone:w-full max-phone:max-w-none max-phone:shrink ${
        phoneTerminalBottom ? '' : 'max-phone:bottom-0'
      } ${activeActivity ? 'max-phone:hidden' : ''}`}
      style={{
        ...(isNarrowViewport ? borderStyle : { width: agentW, ...borderStyle }),
        ...(phoneTerminalBottom ? { bottom: phoneTerminalBottom } : null),
        // Sit below chrome topbar (40px) + iOS status-bar inset in standalone PWA.
        ...(isNarrowViewport
          ? { top: 'calc(2.5rem + env(safe-area-inset-top, 0px))' }
          : null),
      }}
      {...(narrowNeedsBack && !activeActivity ? mobileEdgeSwipeHandlers : {})}
    >
      {!isNarrowViewport ? (
        <div className="h-9 min-h-9 max-phone:hidden border-b border-[var(--dashboard-border)] flex items-center px-3 font-semibold text-[10px] tracking-widest uppercase text-muted shrink-0 truncate">
          {productLabel}
        </div>
      ) : null}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{chatColumn}</div>
    </div>
  );

  const resizer =
    !isNarrowViewport && onResizePointerDown ? (
      <div
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize Agent Sam panel"
        aria-label="Resize Agent Sam panel"
        className="max-phone:hidden shrink-0 z-50 flex justify-center cursor-col-resize touch-none select-none group relative"
        style={{ width: AGENT_RESIZER_HIT_PX }}
        onPointerDown={onResizePointerDown}
      >
        <span
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--dashboard-border)] group-hover:bg-[var(--solar-cyan)] group-active:bg-[var(--solar-cyan)] transition-colors"
          aria-hidden
        />
      </div>
    ) : null;

  if (isLeft) {
    return (
      <>
        {panel}
        {resizer}
      </>
    );
  }

  return (
    <>
      {resizer}
      {panel}
    </>
  );
}
