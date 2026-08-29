import { MobileNavDrawer } from './MobileNavDrawer';

type MobileNavShellProps = {
  open: boolean;
  onClose: () => void;
  onNewChat?: () => void;
  onOpenChats?: () => void;
  onOpenMovieMode?: () => void;
  onSelectChat?: (conversationId: string, title?: string) => void;
  onDeleteActiveChat?: (conversationId: string) => void;
  activeConversationId?: string | null;
  workspaceLabel?: string | null;
  avatarInitial?: string | null;
  avatarUrl?: string | null;
  workspaceSubtitle?: string | null;
};

/**
 * Mobile-only nav drawer. Hamburger lives in the chrome topbar (AppShellFrame);
 * this shell only mounts the left drawer + overlay.
 */
export function MobileNavShell({
  open,
  onClose,
  onNewChat,
  onOpenChats,
  onOpenMovieMode,
  onSelectChat,
  onDeleteActiveChat,
  activeConversationId,
  workspaceLabel,
  avatarInitial,
  avatarUrl,
  workspaceSubtitle,
}: MobileNavShellProps) {
  return (
    <MobileNavDrawer
      open={open}
      onClose={onClose}
      onNewChat={onNewChat}
      onOpenChats={onOpenChats}
      onOpenMovieMode={onOpenMovieMode}
      onSelectChat={onSelectChat}
      onDeleteActiveChat={onDeleteActiveChat}
      activeConversationId={activeConversationId}
      workspaceLabel={workspaceLabel}
      avatarInitial={avatarInitial}
      avatarUrl={avatarUrl}
      workspaceSubtitle={workspaceSubtitle}
    />
  );
}
