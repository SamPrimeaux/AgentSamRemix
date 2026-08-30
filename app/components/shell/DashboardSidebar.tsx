/**
 * Phase 1 shell sidebar — Claude-shaped core nav + Code / Create / Collaborate products.
 */
import { useEffect, useMemo, useState, type ComponentType, type FC } from 'react';
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Code2,
  FolderKanban,
  ImageIcon,
  Layers,
  MessageSquare,
  Palette,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Settings,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  SHELL_CORE_NAV,
  SHELL_MEDIA_PRODUCT,
  SHELL_PRODUCTS,
  type ShellProduct,
  type ShellProductId,
  type ShellProductItem,
} from '../../config/shellNav';
import {
  isCoreRouteActive,
  isProductItemActive,
  resolveActiveProduct,
} from '../../lib/shellNavResolve';
import { ActivityRailItem } from './DashboardActivityNav';
import { AgentChatSessionList } from './AgentChatSessionList';
import { AGENT_NEW_CHAT_PATH } from '../../lib/agentRoutes';

const PRODUCT_ICONS: Record<ShellProductId, ComponentType<{ size?: number; className?: string }>> = {
  media: ImageIcon,
  code: Code2,
  create: Palette,
  collaborate: CalendarDays,
};

/** Media sits below Work; Code / Create / Collaborate stay under Products. */
const SHELL_PRODUCTS_BELOW_MEDIA: ShellProduct[] = SHELL_PRODUCTS.filter((p) => p.id !== 'media');

type DashboardSidebarProps = {
  expanded: boolean;
  onToggleExpanded?: () => void;
  onItemActivate?: () => void;
  onNewChat?: () => void;
  onOpenChats?: () => void;
  onOpenMovieMode?: () => void;
  onSelectChat?: (conversationId: string, title?: string) => void;
  onDeleteActiveChat?: (conversationId: string) => void;
  activeConversationId?: string | null;
  /** Repo / folder / slug label (not marketing display_name). */
  workspaceLabel?: string | null;
  /** Avatar initial (account) when no image URL. */
  avatarInitial?: string | null;
  /** Profile image URL (GitHub avatar, etc.). */
  avatarUrl?: string | null;
  /** Optional subtitle under workspace label (e.g. branch). */
  workspaceSubtitle?: string | null;
};

const HomeIcon: FC<{ size?: number }> = ({ size = 18 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
    <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
  </svg>
);

const CoreIcon: FC<{ id: string; size?: number }> = ({ id, size = 18 }) => {
  const props = { size, strokeWidth: 1, className: 'shrink-0' };
  if (id === 'home') return <HomeIcon size={size} />;
  if (id === 'new-chat') return <Plus {...props} />;
  if (id === 'chats') return <MessageSquare {...props} />;
  if (id === 'projects') return <FolderKanban {...props} />;
  if (id === 'artifacts') return <Layers {...props} />;
  return <Layers {...props} />;
};

export function DashboardSidebar({
  expanded,
  onToggleExpanded,
  onItemActivate,
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
}: DashboardSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const activeProduct = resolveActiveProduct(location.pathname);
  const [expandedProduct, setExpandedProduct] = useState<ShellProductId | null>(activeProduct);
  const [expandedNested, setExpandedNested] = useState<Record<string, boolean>>({});

  const cmsRouteActive = location.pathname.startsWith('/dashboard/cms');

  useEffect(() => {
    setExpandedProduct(activeProduct);
  }, [activeProduct]);

  useEffect(() => {
    if (cmsRouteActive) {
      setExpandedNested((prev) => ({ ...prev, 'cms-suite': true }));
    }
  }, [cmsRouteActive]);

  const isNestedOpen = useMemo(
    () => (item: ShellProductItem) => {
      if (expandedNested[item.id] != null) return expandedNested[item.id];
      if (item.children?.length) {
        return item.children.some((child) => isProductItemActive(location.pathname, child, location.search));
      }
      return false;
    },
    [expandedNested, location.pathname],
  );

  const go = (path: string) => {
    const qIndex = path.indexOf('?');
    const pathname = qIndex >= 0 ? path.slice(0, qIndex) : path;
    const search = qIndex >= 0 ? path.slice(qIndex) : '';
    // Code → Agent is a full-page route to /dashboard/agent/new (fresh center chat).
    // Never mint a side-rail tab here — parallel chats are only via the Agent Sam "+" widget.
    navigate(path);
    onItemActivate?.();
  };

  const toggleProduct = (id: ShellProductId) => {
    setExpandedProduct((cur) => (cur === id ? null : id));
  };

  const renderProductBlock = (product: ShellProduct) => {
    const ProductIcon = PRODUCT_ICONS[product.id];
    const productActive = activeProduct === product.id;
    const isOpen = expandedProduct === product.id;

    return (
      <div key={product.id} className="flex flex-col">
        <div className={`flex items-center ${expanded ? 'pr-1' : ''}`}>
          <ActivityRailItem
            icon={ProductIcon}
            label={product.label}
            expanded={expanded}
            active={productActive}
            onClick={() => {
              // Code product: always full-page fresh Agent Sam — never side-rail mint.
              go(product.id === 'code' ? AGENT_NEW_CHAT_PATH : product.home);
              setExpandedProduct(product.id);
            }}
          />
          {expanded ? (
            <button
              type="button"
              className="shrink-0 p-1 rounded text-muted hover:text-main hover:bg-[var(--bg-hover)]/60"
              aria-label={isOpen ? `Collapse ${product.label}` : `Expand ${product.label}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleProduct(product.id);
              }}
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : null}
        </div>
        {expanded && isOpen ? (
          <div className="ml-3 pl-2 border-l border-[var(--dashboard-border)]/80 flex flex-col gap-0.5 mb-1">
            {product.items.map((child) => {
              if (child.children?.length) {
                const groupActive = isProductItemActive(location.pathname, child, location.search);
                const nestedOpen = isNestedOpen(child);
                return (
                  <div key={child.id} className="flex flex-col gap-0.5">
                    <div className="flex items-center pr-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (child.path) go(child.path);
                          setExpandedNested((prev) => ({ ...prev, [child.id]: true }));
                        }}
                        className={`flex flex-1 items-center gap-2 w-full text-left min-h-[32px] px-2 rounded-md text-[11px] font-medium transition-colors ${
                          groupActive
                            ? 'text-main bg-[var(--bg-hover)]/40'
                            : 'text-muted hover:text-main hover:bg-[var(--bg-hover)]/40'
                        }`}
                      >
                        <span className="truncate">{child.label}</span>
                      </button>
                      <button
                        type="button"
                        className="shrink-0 p-0.5 rounded text-muted hover:text-main"
                        aria-label={nestedOpen ? `Collapse ${child.label}` : `Expand ${child.label}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedNested((prev) => ({
                            ...prev,
                            [child.id]: !nestedOpen,
                          }));
                        }}
                      >
                        {nestedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    </div>
                    {nestedOpen ? (
                      <div className="ml-2 pl-2 border-l border-[var(--dashboard-border)]/60 flex flex-col gap-0.5 pb-0.5">
                        {child.children.map((sub) => {
                          const subActive = sub.path
                            ? isProductItemActive(location.pathname, sub, location.search)
                            : false;
                          const editorHref =
                            sub.id === 'cms-editor' ? '/dashboard/cms/pages' : sub.path;
                          return (
                            <button
                              key={sub.id}
                              type="button"
                              onClick={() => {
                                if (editorHref) go(editorHref);
                              }}
                              className={`flex items-center gap-2 w-full text-left min-h-[30px] px-2 rounded-md text-[11px] font-medium transition-colors ${
                                subActive
                                  ? 'text-[var(--solar-cyan)] bg-[var(--bg-hover)]/50'
                                  : 'text-muted hover:text-main hover:bg-[var(--bg-hover)]/40'
                              }`}
                            >
                              <span className="truncate">{sub.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              }
              const childActive = child.path
                ? isProductItemActive(location.pathname, child, location.search)
                : false;
              return (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => {
                    if (child.path) go(child.path);
                  }}
                  className={`flex items-center gap-2 w-full text-left min-h-[32px] px-2 rounded-md text-[11px] font-medium transition-colors ${
                    childActive
                      ? 'text-[var(--solar-cyan)] bg-[var(--bg-hover)]/50'
                      : 'text-muted hover:text-main hover:bg-[var(--bg-hover)]/40'
                  }`}
                >
                  {child.id === 'moviemode' ? (
                    <Clapperboard size={13} strokeWidth={1.5} className="shrink-0 opacity-80" />
                  ) : null}
                  <span className="truncate">{child.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-0.5">
      <div className="flex flex-col gap-0.5 shrink-0 pb-1 mb-0.5 border-b border-[var(--dashboard-border)]/60">
        <button
          type="button"
          title={expanded ? 'Collapse navigation' : 'Expand navigation'}
          aria-expanded={expanded}
          onClick={() => onToggleExpanded?.()}
          className={`relative flex w-full min-h-[40px] shrink-0 items-center rounded-lg transition-colors ${
            expanded ? 'gap-2.5 px-2 justify-start' : 'justify-center px-0'
          } text-muted hover:text-main hover:bg-[var(--bg-hover)]/60`}
        >
          {expanded ? <PanelLeftClose size={20} strokeWidth={1} /> : <PanelLeft size={18} strokeWidth={1} />}
          {expanded ? (
            <span className="min-w-0 truncate text-left text-[12px] font-medium leading-tight">Collapse</span>
          ) : null}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain chat-hide-scroll pr-0.5">
      <div className="flex flex-col gap-0.5 shrink-0">
        {SHELL_CORE_NAV.map((item) => {
          if (item.kind === 'action') {
            const active = false;
            return (
              <button
                key={item.id}
                type="button"
                title={item.label}
                onClick={() => {
                  if (item.action === 'new-chat') onNewChat?.();
                  else if (item.action === 'open-chats') onOpenChats?.();
                  onItemActivate?.();
                }}
                className={`relative flex w-full min-h-[40px] shrink-0 items-center rounded-lg transition-colors ${
                  expanded ? 'gap-2.5 px-2 justify-start' : 'justify-center px-0'
                } text-muted hover:text-main hover:bg-[var(--bg-hover)]/60`}
              >
                <CoreIcon id={item.id} size={expanded ? 20 : 18} />
                {expanded ? (
                  <span className="min-w-0 truncate text-left text-[12px] font-medium leading-tight">
                    {item.label}
                  </span>
                ) : null}
                {active ? (
                  <div
                    className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r-md bg-[var(--solar-cyan)]"
                    aria-hidden
                  />
                ) : null}
              </button>
            );
          }
          const active = isCoreRouteActive(location.pathname, item.path, item.match ?? 'exact');
          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              onClick={() => go(item.path)}
              className={`relative flex w-full min-h-[40px] shrink-0 items-center rounded-lg transition-colors ${
                expanded ? 'gap-2.5 px-2 justify-start' : 'justify-center px-0'
              } ${active ? 'text-main' : 'text-muted hover:text-main hover:bg-[var(--bg-hover)]/60'}`}
            >
              {active ? (
                <div
                  className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r-md bg-[var(--solar-cyan)]"
                  aria-hidden
                />
              ) : null}
              <CoreIcon id={item.id} size={expanded ? 20 : 18} />
              {expanded ? (
                <span className="min-w-0 truncate text-left text-[12px] font-medium leading-tight">
                  {item.label}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-0.5 shrink-0 mt-1">
        {renderProductBlock(SHELL_MEDIA_PRODUCT)}
      </div>

      {expanded ? (
        <div className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted opacity-70">
          Products
        </div>
      ) : (
        <div className="my-1 mx-2 border-t border-[var(--dashboard-border)]" aria-hidden />
      )}

      <div className="flex flex-col gap-0.5 shrink-0">
        {SHELL_PRODUCTS_BELOW_MEDIA.map((product) => renderProductBlock(product))}
      </div>

      {expanded ? (
        <div className="pt-3">
          <AgentChatSessionList
            variant="sidebar"
            expanded={expanded}
            activeConversationId={activeConversationId}
            onDeletedActive={onDeleteActiveChat}
            onSelect={(id) => {
              onSelectChat?.(id);
              onItemActivate?.();
            }}
          />
        </div>
      ) : null}
      </div>

      <div className="pt-2 border-t border-[var(--dashboard-border)] shrink-0">
        <div
          className={`w-full flex items-center rounded-lg ${
            expanded ? 'gap-2 px-2 py-2 justify-between' : 'flex-col gap-1.5 py-2 justify-center'
          }`}
        >
          <div
            className={`flex items-center min-w-0 ${expanded ? 'gap-2.5 flex-1' : 'justify-center'}`}
            title={workspaceLabel?.trim() || 'Account'}
          >
            <div
              className={`shrink-0 rounded-full bg-[var(--bg-hover)] border border-[var(--dashboard-border)] flex items-center justify-center font-semibold text-main overflow-hidden ${
                expanded ? 'w-11 h-11 text-[15px]' : 'w-12 h-12 text-[16px]'
              }`}
              aria-hidden={!!avatarUrl?.trim()}
            >
              {avatarUrl?.trim() ? (
                <img src={avatarUrl.trim()} alt="" className="w-full h-full object-cover" />
              ) : (
                (avatarInitial || workspaceLabel || 'A').charAt(0).toUpperCase()
              )}
            </div>
            {expanded ? (
              <div className="min-w-0 text-left">
                <div className="text-[12px] font-medium text-main truncate font-mono">
                  {workspaceLabel?.trim() || 'Account'}
                </div>
                {workspaceSubtitle?.trim() ? (
                  <div className="text-[10px] text-muted truncate">{workspaceSubtitle}</div>
                ) : null}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            title="Settings"
            aria-label="Settings"
            onClick={() => go('/dashboard/settings/general')}
            className={`shrink-0 p-1.5 rounded-md text-muted hover:text-main hover:bg-[var(--bg-hover)]/60 transition-colors ${
              location.pathname.startsWith('/dashboard/settings') ? 'text-[var(--solar-cyan)]' : ''
            }`}
          >
            <Settings size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
