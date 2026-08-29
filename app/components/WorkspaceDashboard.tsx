import React, { useState, useEffect, useRef } from 'react';
import {
  FolderOpen,
  Github,
  ArrowRight,
  Target,
  Sparkles,
  ChevronDown,
  Database,
  Zap,
  Globe,
  History as HistoryIcon,
} from 'lucide-react';
import type { RecentFileEntry } from '../src/ideWorkspace';
import { SetiFileIcon } from '../src/components/SetiFileIcon';
import { usePlanTasksRealtime } from '../src/hooks/usePlanTasksRealtime';
import { readRecentWorkspacesFromLocalStorage } from '../src/recentWorkspacesStorage';

interface WorkspaceDashboardProps {
  onOpenFolder: () => void;
  onConnectWorkspace: () => void;
  onGithubSync: () => void;
  recentFiles: RecentFileEntry[];
  workspaceRows: Array<{ id: string; name: string }>;
  authWorkspaceId: string | null;
  onSwitchWorkspace: (id: string) => void;
  onQuickstart: () => void;
  onRunVerificationCommand?: (command: string) => void;
  onOpenEditor?: () => void;
  onOpenRecent: (entry: RecentFileEntry) => void;
  workspacePlanTasks?: unknown[];
  activePlanId?: string | null;
  workspaceActivity?: unknown[];
  workspaceVerificationCommands?: unknown[];
  activeAgentSlug?: string | null;
  sessionUserId?: string | null;
}

const HOME_SUBLINE_OPTIONS = [
  'What are we building today',
  'Ready when you are',
  'Your stack is standing by',
  'Where do we start',
  'All systems operational',
  "Let's get to work",
] as const;

function pickHomeSubline(): string {
  const i = Math.floor(Math.random() * HOME_SUBLINE_OPTIONS.length);
  return HOME_SUBLINE_OPTIONS[i] ?? HOME_SUBLINE_OPTIONS[0];
}

function summarizeUnknownTask(row: unknown): string {
  if (row == null) return '';
  if (typeof row === 'string') return row;
  if (typeof row === 'object' && row !== null && 'title' in row && typeof (row as { title?: unknown }).title === 'string') {
    return String((row as { title: string }).title);
  }
  try {
    return JSON.stringify(row).slice(0, 200);
  } catch {
    return String(row);
  }
}

export const WorkspaceDashboard: React.FC<WorkspaceDashboardProps> = ({
  onOpenFolder,
  onConnectWorkspace,
  onGithubSync,
  recentFiles,
  workspaceRows,
  authWorkspaceId,
  onSwitchWorkspace,
  onQuickstart,
  onRunVerificationCommand,
  onOpenRecent,
  workspacePlanTasks = [],
  activePlanId = null,
  workspaceActivity = [],
  workspaceVerificationCommands = [],
  activeAgentSlug = null,
  sessionUserId = null,
}) => {
  const { tasks: realtimePlanTasks } = usePlanTasksRealtime(activePlanId ?? null);
  const displayPlanTasks: unknown[] = activePlanId ? (realtimePlanTasks as unknown[]) : workspacePlanTasks;

  const [subline] = useState(pickHomeSubline);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (workspaceRef.current && !workspaceRef.current.contains(target)) {
        setIsWorkspaceOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeWorkspace = (workspaceRows || []).find((w) => w.id === authWorkspaceId) || { name: 'Home', id: 'default' };
  const recentWorkspaces = readRecentWorkspacesFromLocalStorage(sessionUserId);
  const hasRecentWork = recentFiles.length > 0 || recentWorkspaces.length > 0;

  return (
    <div className="flex-1 flex flex-col items-center justify-start bg-[var(--scene-bg)] overflow-y-auto py-12 px-6 no-scrollbar h-full">
      <div className="flex flex-col items-center mb-6 text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="w-16 h-16 mb-4 rounded-2xl flex items-center justify-center grayscale opacity-80">
          <img
            src="https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/ac515729-af6b-4ea5-8b10-e581a4d02100/thumbnail"
            alt="Inner Animal Media"
            className="w-full h-full object-contain"
          />
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight text-[var(--dashboard-text)] mb-1">{getGreeting()}</h1>
        <p className="text-[13px] text-[var(--dashboard-muted)] opacity-60">{subline}</p>
      </div>

      <div className="relative mb-4 z-[80]" ref={workspaceRef}>
        <button
          type="button"
          onClick={() => setIsWorkspaceOpen(!isWorkspaceOpen)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-[var(--dashboard-card)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-all font-medium text-[13px]"
        >
          <span>{activeWorkspace.name}</span>
          <ChevronDown size={14} className={`opacity-60 transition-transform ${isWorkspaceOpen ? 'rotate-180' : ''}`} />
          <Database size={13} className="opacity-40 ml-1" />
        </button>

        {isWorkspaceOpen && (
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-64 bg-[var(--dashboard-card)] border border-[var(--dashboard-border)] rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] z-[90] overflow-hidden py-2 animate-in fade-in slide-in-from-top-2">
            <div className="px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-[var(--dashboard-muted)] opacity-60 border-b border-[var(--dashboard-border)]/30 mb-1">
              Cloud Workspaces
            </div>
            {workspaceRows.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => {
                  onSwitchWorkspace(ws.id);
                  setIsWorkspaceOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 text-[12px] transition-colors ${authWorkspaceId === ws.id ? 'text-[var(--solar-cyan)] bg-[var(--dashboard-canvas)]' : 'text-[var(--dashboard-text)] hover:bg-[var(--dashboard-canvas)]'}`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${ws.id.includes('sandbox') ? 'bg-[var(--solar-cyan)]' : 'bg-[var(--solar-green)] shadow-[0_0_8px_var(--solar-green)]'}`}
                  />
                  <span>{ws.name}</span>
                </div>
                {authWorkspaceId === ws.id && <Sparkles size={10} />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-full max-w-2xl mb-8 flex flex-col items-center animate-in fade-in slide-in-from-bottom-6 duration-1000">
        <div className="flex items-center justify-center gap-3 flex-wrap animate-in fade-in slide-in-from-bottom-2 duration-1200 delay-300">
          <button
            type="button"
            onClick={onQuickstart}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--dashboard-border)] bg-[var(--dashboard-card)]/50 hover:bg-[var(--dashboard-card)] transition-all text-[12px] font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]"
          >
            <Zap size={14} />
            <span>Quickstart</span>
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.href = '/dashboard/artifacts';
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--dashboard-border)] bg-[var(--dashboard-card)]/50 hover:bg-[var(--dashboard-card)] transition-all text-[12px] font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]"
          >
            <span>View Artifacts</span>
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.href = '/dashboard/projects';
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--dashboard-border)] bg-[var(--dashboard-card)]/50 hover:bg-[var(--dashboard-card)] transition-all text-[12px] font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]"
          >
            <span>Open Project</span>
          </button>
        </div>
      </div>

      {(displayPlanTasks.length > 0 ||
        activePlanId ||
        workspaceActivity.length > 0 ||
        workspaceVerificationCommands.length > 0 ||
        activeAgentSlug) ? (
        <div className="w-full max-w-3xl mb-10 grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
          {activeAgentSlug ? (
            <div className="rounded-2xl border border-[var(--dashboard-border)] bg-[var(--dashboard-card)] p-4 md:col-span-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--dashboard-muted)] mb-1">Active subagent</p>
              <p className="text-[13px] font-mono text-[var(--solar-cyan)]">{activeAgentSlug}</p>
            </div>
          ) : null}
          {displayPlanTasks.length > 0 ? (
            <div className="rounded-2xl border border-[var(--dashboard-border)] bg-[var(--dashboard-card)] p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--dashboard-muted)] mb-2">Next tasks</p>
              <ul className="space-y-2 text-[12px] text-[var(--dashboard-text)]">
                {displayPlanTasks.slice(0, 12).map((t, i) => {
                  const rowKey =
                    t != null && typeof t === 'object' && 'id' in t && typeof (t as { id?: unknown }).id === 'string'
                      ? (t as { id: string }).id
                      : i;
                  return (
                    <li key={rowKey} className="flex gap-2">
                      <Target size={12} className="mt-0.5 shrink-0 text-[var(--solar-yellow)]" />
                      <span className="leading-snug">{summarizeUnknownTask(t)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {workspaceActivity.length > 0 ? (
            <div className="rounded-2xl border border-[var(--dashboard-border)] bg-[var(--dashboard-card)] p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--dashboard-muted)] mb-2">Recent activity</p>
              <ul className="space-y-2 text-[11px] text-[var(--dashboard-muted)] font-mono">
                {workspaceActivity.slice(0, 12).map((a, i) => (
                  <li key={i} className="truncate">
                    {summarizeUnknownTask(a)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {workspaceVerificationCommands.length > 0 ? (
            <div className="rounded-2xl border border-[var(--dashboard-border)] bg-[var(--dashboard-card)] p-4 md:col-span-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--dashboard-muted)] mb-2">Verification commands</p>
              <div className="flex flex-wrap gap-2">
                {workspaceVerificationCommands.slice(0, 16).map((c, i) => {
                  const cmd = typeof c === 'string' ? c : summarizeUnknownTask(c);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onRunVerificationCommand?.(`Run in terminal: ${cmd}`)}
                      className="px-2 py-1 rounded-lg border border-[var(--dashboard-border)] text-[11px] font-mono text-[var(--dashboard-text)] hover:border-[var(--solar-cyan)]"
                    >
                      {cmd}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="w-full max-w-3xl mb-12 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-150">
        <div className="bg-[var(--dashboard-card)] border border-[var(--dashboard-border)] rounded-2xl p-6 hover:border-[var(--solar-cyan)]/40 transition-all duration-300">
          <div className="flex items-start gap-4 mb-5">
            <div className="p-3 rounded-xl bg-[var(--dashboard-canvas)] text-[var(--solar-cyan)] shrink-0">
              <Globe size={24} />
            </div>
            <div className="min-w-0 text-left">
              <h3 className="text-sm font-bold text-[var(--dashboard-text)] mb-1">Open your work</h3>
              <p className="text-[11px] text-[var(--dashboard-muted)] leading-relaxed">
                Switch to a cloud workspace, open a local folder, or clone a GitHub repo — all from one place.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onConnectWorkspace}
            className="w-full mb-3 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[var(--solar-cyan)]/15 border border-[var(--solar-cyan)]/35 text-[var(--solar-cyan)] text-[13px] font-semibold hover:bg-[var(--solar-cyan)]/25 transition-colors"
          >
            <Database size={16} />
            Switch workspace
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onOpenFolder}
              className="group flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-canvas)]/50 hover:border-[var(--solar-cyan)]/40 hover:bg-[var(--dashboard-canvas)] transition-all text-left"
            >
              <FolderOpen size={16} className="shrink-0 text-[var(--dashboard-muted)] group-hover:text-[var(--solar-cyan)]" />
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-[var(--dashboard-text)]">Local folder</span>
                <span className="block text-[10px] text-[var(--dashboard-muted)] truncate">Browse this machine</span>
              </span>
            </button>
            <button
              type="button"
              onClick={onGithubSync}
              className="group flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-canvas)]/50 hover:border-[var(--solar-cyan)]/40 hover:bg-[var(--dashboard-canvas)] transition-all text-left"
            >
              <Github size={16} className="shrink-0 text-[var(--dashboard-muted)] group-hover:text-[var(--solar-cyan)]" />
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-[var(--dashboard-text)]">Clone repo</span>
                <span className="block text-[10px] text-[var(--dashboard-muted)] truncate">Paste a GitHub URL</span>
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="w-full max-w-3xl animate-in fade-in slide-in-from-bottom-10 duration-1000 delay-300">
        <div className="flex items-center gap-2 mb-4 px-2">
          <HistoryIcon size={14} className="text-[var(--dashboard-muted)]" />
          <h2 className="text-[11px] font-bold text-[var(--dashboard-muted)] uppercase tracking-widest">Recent Work</h2>
        </div>

        <div className="bg-[var(--dashboard-card)] border border-[var(--dashboard-border)] rounded-2xl divide-y divide-[var(--dashboard-border)] overflow-hidden">
          {hasRecentWork ? (
            <>
              {recentWorkspaces.slice(0, 3).map((ws) => (
                <div
                  key={`ws-${ws.id}`}
                  role="button"
                  tabIndex={0}
                  className="group flex items-center justify-between p-4 hover:bg-[var(--dashboard-canvas)] transition-colors cursor-pointer"
                  onClick={() => onSwitchWorkspace(ws.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onSwitchWorkspace(ws.id);
                  }}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[var(--dashboard-canvas)] flex items-center justify-center text-[var(--solar-cyan)] group-hover:opacity-90 transition-opacity">
                      <Database size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-[var(--dashboard-text)] truncate">
                        {ws.display_name || ws.slug || ws.id}
                      </div>
                      <div className="text-[10px] text-[var(--dashboard-muted)] font-mono truncate">
                        Workspace · {ws.slug || ws.id}
                      </div>
                    </div>
                  </div>
                  <ArrowRight size={14} className="text-[var(--dashboard-muted)] opacity-0 group-hover:opacity-100 transition-all" />
                </div>
              ))}
              {recentFiles.slice(0, 6).map((file) => (
                <div
                  key={file.id}
                  role="button"
                  tabIndex={0}
                  className="group flex items-center justify-between p-4 hover:bg-[var(--dashboard-canvas)] transition-colors cursor-pointer"
                  onClick={() => onOpenRecent(file)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onOpenRecent(file);
                  }}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[var(--dashboard-canvas)] flex items-center justify-center group-hover:opacity-90 transition-opacity">
                      <SetiFileIcon filename={file.name} size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-[var(--dashboard-text)] truncate">{file.name}</div>
                      <div className="text-[10px] text-[var(--dashboard-muted)] font-mono truncate">{file.label}</div>
                    </div>
                  </div>
                  <ArrowRight size={14} className="text-[var(--dashboard-muted)] opacity-0 group-hover:opacity-100 transition-all" />
                </div>
              ))}
            </>
          ) : (
            <div className="p-8 text-center text-[var(--dashboard-muted)] italic text-[12px]">
              No recent work yet — switch a workspace or open a file to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
