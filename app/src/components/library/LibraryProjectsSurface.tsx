import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Archive, CheckSquare, Plus, Search, Square, Star } from 'lucide-react';
import { ProjectHealthDonut } from '../projects/ProjectHealthDonut';

// --- Deploy activity fetch ---
type DeployDay = {
  date: string;
  worker: string;
  session_start: string;
  session_end: string;
  session_minutes: number;
  build_count: number;
  commits: string[];
};

type DeployActivityResponse = {
  ok: boolean;
  days: DeployDay[];
  by_worker: Record<string, { total_minutes: number; active_days: number; last_active: string }>;
};

async function fetchDeployActivity(days = 30): Promise<DeployActivityResponse | null> {
  try {
    const r = await fetch(`/api/projects/deploy-activity?days=${days}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

// Build per-worker per-day minute map for bar charts
function buildWorkerDayMap(days: DeployDay[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const d of days) {
    if (!out[d.worker]) out[d.worker] = {};
    out[d.worker][d.date] = (out[d.worker][d.date] || 0) + d.session_minutes;
  }
  return out;
}

// Last 7 calendar days labels + minutes for a given worker
function weeklyBars(workerDayMap: Record<string, number>): { label: string; mins: number }[] {
  const out = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ label: ['Su','Mo','Tu','We','Th','Fr','Sa'][d.getDay()], mins: workerDayMap[key] || 0 });
  }
  return out;
}
import type { OverviewProject } from '../../../client-api/projects';
import { fetchProjectsList, fetchProjectsOverview, updateProject, deleteProject } from '../../../client-api/projects';
import { StartProjectWizard } from '../../../components/projects/StartProjectWizard';
import { readIamProjectsCache, writeIamProjectsCache } from '../../iamProjectsCache';
import { cfImageVariants, projectAccentHue, projectInitials } from '../../lib/projectBranding';
import { useWorkspace } from '../../context/WorkspaceContext';
import { LibraryProjectDetail } from './LibraryProjectDetail';

type Props = {
  onToast?: (msg: string) => void;
  initialProjectId?: string | null;
  onProjectChange?: (projectId: string | null) => void;
};

function formatUpdated(project: OverviewProject): string {
  if (project.lastDeploy && project.lastDeploy !== '—') return project.lastDeploy;
  if (project.dueDate && project.dueDate !== '—') return project.dueDate;
  return 'Recently';
}

function projectDescription(project: OverviewProject): string {
  const d = project.description?.trim();
  if (d) return d;
  const stage = project.stage?.trim();
  if (stage) return stage;
  const client = project.client_name || project.client;
  if (client) return `Client · ${client}`;
  return 'No description yet.';
}

function mergeOverviewProjects(fast: OverviewProject[], rich: OverviewProject[]): OverviewProject[] {
  const richById = new Map(rich.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: OverviewProject[] = [];
  for (const p of fast) {
    out.push(richById.get(p.id) || p);
    seen.add(p.id);
  }
  for (const p of rich) {
    if (!seen.has(p.id)) out.push(p);
  }
  return out;
}

function WeeklyDeployBars({ bars, accentColor }: { bars: { label: string; mins: number }[]; accentColor: string }) {
  const max = Math.max(...bars.map((b) => b.mins), 1);
  const todayIdx = new Date().getDay();
  // Sunday=0, we built bars oldest→newest so today is index 6
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 28, flex: 1 }}>
      {bars.map((b, i) => {
        const isToday = i === 6;
        const h = b.mins > 0 ? Math.max(4, Math.round((b.mins / max) * 22)) : 2;
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flex: 1 }} title={b.mins > 0 ? `${b.label}: ${b.mins}m` : b.label}>
            <div style={{
              width: '100%',
              height: h,
              borderRadius: 2,
              background: isToday && b.mins > 0 ? accentColor : b.mins > 0 ? `${accentColor}66` : 'rgba(0,0,0,0.08)',
              transition: 'height 0.4s ease',
            }} />
            <span style={{ fontSize: 7, color: isToday ? accentColor : 'rgba(0,0,0,0.35)', fontVariantNumeric: 'tabular-nums' }}>{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function LibraryProjectsSurface({ onToast, initialProjectId, onProjectChange }: Props) {
  const { workspaceId, canonicalWorkspaceId, workspaces, loading: workspaceLoading } = useWorkspace();
  const effectiveWorkspaceId = workspaceId || canonicalWorkspaceId;
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<OverviewProject[]>(() => {
    const cached = readIamProjectsCache(effectiveWorkspaceId);
    return cached?.projects || [];
  });
  const [loading, setLoading] = useState(() => !readIamProjectsCache(effectiveWorkspaceId)?.projects?.length);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialProjectId || null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [workerDayMap, setWorkerDayMap] = useState<Record<string, Record<string, number>>>({});
  const deployFetched = useRef(false);

  const refresh = useCallback(async () => {
    const wsId = effectiveWorkspaceId?.trim() || '';
    if (!wsId) {
      setLoading(false);
      return;
    }
    const cached = readIamProjectsCache(wsId);
    if (cached?.projects?.length) {
      setProjects(cached.projects);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const fast = await fetchProjectsList(wsId);
      if (fast.ok && fast.projects.length) {
        setProjects(fast.projects);
        writeIamProjectsCache(wsId, fast.projects);
      } else if (!fast.ok && !cached?.projects?.length) {
        setError(fast.error || 'Failed to load projects');
      } else if (fast.ok && !fast.projects.length && !cached?.projects?.length) {
        setProjects([]);
      }
    } catch (e) {
      if (!cached?.projects?.length) {
        setError(e instanceof Error ? e.message : 'Failed to load projects');
      }
    } finally {
      setLoading(false);
    }

    setEnriching(true);
    try {
      const data = await fetchProjectsOverview(wsId);
      if (data.ok && data.projects?.length) {
        setProjects((prev) => {
          const merged = mergeOverviewProjects(prev, data.projects);
          writeIamProjectsCache(wsId, merged);
          return merged;
        });
      }
    } catch {
      /* fast list already shown */
    } finally {
      setEnriching(false);
    }
  }, [effectiveWorkspaceId]);

  useEffect(() => {
    if (!effectiveWorkspaceId) {
      if (!workspaceLoading) setLoading(false);
      return;
    }
    const cached = readIamProjectsCache(effectiveWorkspaceId);
    if (cached?.projects?.length) setProjects(cached.projects);
    void refresh();
  }, [effectiveWorkspaceId, workspaceLoading, refresh]);

  useEffect(() => {
    if (initialProjectId) setSelectedId(initialProjectId);
  }, [initialProjectId]);

  useEffect(() => {
    if (deployFetched.current) return;
    deployFetched.current = true;
    fetchDeployActivity(30).then((data) => {
      if (data?.ok && data.days?.length) {
        setWorkerDayMap(buildWorkerDayMap(data.days));
      }
    });
  }, []);

  const activeProjects = useMemo(
    () =>
      projects.filter((p) => {
        const st = String(p.status_raw || p.status || '').toLowerCase();
        return st !== 'archived' && st !== 'complete';
      }),
    [projects],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? activeProjects.filter((p) =>
          [p.name, p.description, p.client, p.client_name, ...(p.tags || [])]
            .join(' ')
            .toLowerCase()
            .includes(q),
        )
      : activeProjects;
    return base;
  }, [activeProjects, query]);

  const selected = selectedId ? projects.find((p) => p.id === selectedId) : null;

  const workspaceLabel = useMemo(() => {
    if (!effectiveWorkspaceId) return null;
    return workspaces.find((w) => w.id === effectiveWorkspaceId)?.name || effectiveWorkspaceId;
  }, [effectiveWorkspaceId, workspaces]);

  const openProject = (id: string) => {
    if (selectMode) {
      toggleSelect(id);
      return;
    }
    setSelectedId(id);
    onProjectChange?.(id);
  };

  const closeProject = () => {
    setSelectedId(null);
    onProjectChange?.(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((p) => p.id)));
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const bulkArchive = async () => {
    if (!selectedIds.size || bulkBusy) return;
    if (!window.confirm(`Archive ${selectedIds.size} project(s)?`)) return;
    setBulkBusy(true);
    try {
      const ids = [...selectedIds];
      const results = await Promise.all(ids.map((id) => updateProject(id, { status: 'archived' })));
      const failed = results.filter((r) => !r.ok).length;
      if (failed) onToast?.(`${failed} project(s) could not be archived`);
      else onToast?.(`Archived ${ids.length} project(s)`);
      exitSelectMode();
      void refresh();
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (!selectedIds.size || bulkBusy) return;
    if (
      !window.confirm(
        `Permanently delete ${selectedIds.size} project(s)? This cannot be undone. Consider archiving instead.`,
      )
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      const ids = [...selectedIds];
      const results = await Promise.all(
        ids.map((id) => deleteProject(id, { workspaceId: effectiveWorkspaceId || undefined })),
      );
      const failed = results.filter((r) => !r.ok).length;
      if (failed) onToast?.(`${failed} project(s) could not be deleted`);
      else onToast?.(`Deleted ${ids.length} project(s)`);
      exitSelectMode();
      void refresh();
    } finally {
      setBulkBusy(false);
    }
  };

  const toggleStar = (p: OverviewProject, e: MouseEvent) => {
    e.stopPropagation();
    void (async () => {
      const tags = [...(p.tags || [])];
      const has = tags.includes('starred');
      const next = has ? tags.filter((t) => t !== 'starred') : [...tags, 'starred'];
      const res = await updateProject(p.id, { tags_json: next });
      if (!res.ok) onToast?.(res.error || 'Could not update star');
      else void refresh();
    })();
  };

  const isStarred = (p: OverviewProject) => (p.tags || []).includes('starred');

  if (selected) {
    return (
      <LibraryProjectDetail
        project={selected}
        onBack={closeProject}
        onToast={onToast}
        onRefresh={() => void refresh()}
      />
    );
  }

  return (
    <div className="lib-proj-grid-surface">
      <div className="lib-proj-grid-head">
        <div>
          <h1>Projects</h1>
          {workspaceLabel ? <p className="lib-project-muted">Workspace · {workspaceLabel}</p> : null}
          {enriching ? <p className="lib-project-muted lib-proj-sync-hint">Refreshing stats…</p> : null}
        </div>
        <div className="lib-proj-grid-head-actions">
          {selectMode ? (
            <>
              <button type="button" className="lib-proj-btn ghost" onClick={toggleSelectAll}>
                {selectedIds.size === filtered.length && filtered.length ? 'Deselect all' : 'Select all'}
              </button>
              <button
                type="button"
                className="lib-proj-btn ghost danger"
                disabled={!selectedIds.size || bulkBusy}
                onClick={() => void bulkArchive()}
              >
                <Archive size={16} />
                Archive ({selectedIds.size})
              </button>
              <button
                type="button"
                className="lib-proj-btn ghost danger"
                disabled={!selectedIds.size || bulkBusy}
                onClick={() => void bulkDelete()}
              >
                Delete ({selectedIds.size})
              </button>
              <button type="button" className="lib-proj-btn ghost" onClick={exitSelectMode}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="lib-proj-btn ghost"
              onClick={() => setSelectMode(true)}
              title="Select projects"
            >
              <CheckSquare size={16} />
              Select
            </button>
          )}
          <button type="button" className="lib-proj-btn primary" onClick={() => setModalOpen(true)}>
            <Plus size={16} strokeWidth={2} />
            New project
          </button>
        </div>
      </div>

      {error ? <div className="lib-error">{error}</div> : null}

      <div className="lib-proj-grid-search">
        <Search size={16} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects…"
        />
      </div>

      {loading && !projects.length ? (
        <div className="lib-proj-grid lib-proj-grid-skeleton" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="lib-proj-grid-card lib-proj-skeleton-card">
              <div className="lib-proj-skeleton-cover" />
              <div className="lib-proj-skeleton-line lg" />
              <div className="lib-proj-skeleton-line" />
              <div className="lib-proj-skeleton-line sm" />
            </div>
          ))}
        </div>
      ) : null}

      <div className="lib-proj-grid">
        {filtered.map((p) => {
          const cover = cfImageVariants(p.cover_image_url);
          const hue = projectAccentHue(p.id);
          const checked = selectedIds.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={`lib-proj-grid-card${selectMode && checked ? ' is-selected' : ''}`}
              onClick={() => openProject(p.id)}
            >
              {selectMode ? (
                <span className="lib-proj-grid-check" aria-hidden>
                  {checked ? <CheckSquare size={18} /> : <Square size={18} />}
                </span>
              ) : null}
              <div className="lib-proj-grid-card-cover" style={cover.src ? undefined : { background: `linear-gradient(135deg, hsl(${hue} 52% 42%), hsl(${(hue + 40) % 360} 48% 32%))` }}>
                {cover.src ? (
                  <img src={cover.src} srcSet={cover.srcSet} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="lib-proj-grid-card-initials">{projectInitials(p.name)}</span>
                )}
              </div>
              <div className="lib-proj-grid-card-top">
                <h3>{p.name}</h3>
                {isStarred(p) ? (
                  <Star size={14} className="lib-proj-star" fill="currentColor" />
                ) : (
                  <button
                    type="button"
                    className="lib-proj-star-btn"
                    aria-label="Star project"
                    onClick={(e) => toggleStar(p, e)}
                  >
                    <Star size={14} />
                  </button>
                )}
              </div>
              <p className="lib-proj-grid-card-desc">{projectDescription(p)}</p>
              {(() => {
                // Derive worker slug from workspace_id or project slug
                // e.g. ws_inneranimalmedia → "inneranimalmedia", ws_companionscpas → "companionscpas"
                const wsSlug = (p.workspace_id || '').replace(/^ws_/, '');
                const workerDays = workerDayMap[wsSlug] || {};
                const bars = weeklyBars(workerDays);
                const hasActivity = bars.some((b) => b.mins > 0);
                const accentHex = `hsl(${hue} 65% 52%)`;
                const totalMinsThisWeek = bars.reduce((s, b) => s + b.mins, 0);
                return (
                  <div className="lib-proj-grid-card-footer">
                    <ProjectHealthDonut
                      taskRatio={p.totalTasks > 0 ? p.completedTasks / p.totalTasks : 0}
                      healthScore={p.health ?? 0}
                      budgetRatio={p.budgetTotal > 0 ? p.budgetUsed / p.budgetTotal : 0}
                      accentColor={accentHex}
                      size={44}
                      label={true}
                    />
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {hasActivity ? (
                        <>
                          <WeeklyDeployBars bars={bars} accentColor={accentHex} />
                          <p className="lib-proj-grid-card-meta" style={{ margin: 0 }}>
                            {Math.round(totalMinsThisWeek / 60 * 10) / 10}h this week
                          </p>
                        </>
                      ) : (
                        <p className="lib-proj-grid-card-meta">Updated {formatUpdated(p)}</p>
                      )}
                    </div>
                  </div>
                );
              })()}
            </button>
          );
        })}
      </div>

      {!loading && filtered.length === 0 ? (
        <p className="lib-project-muted lib-proj-grid-empty">
          {query.trim() ? `No projects match "${query.trim()}"` : 'No projects yet. Create one to organize chats and artifacts.'}
        </p>
      ) : null}

      <StartProjectWizard
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(createdId) => {
          setModalOpen(false);
          onToast?.('Project created');
          void refresh().then(() => {
            if (createdId) openProject(createdId);
          });
        }}
      />
    </div>
  );
}

export default LibraryProjectsSurface;
