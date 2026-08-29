import React, { useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2, X } from 'lucide-react';
import { MovieModeWorkbench } from './MovieModeWorkbench';
import { MovieModeToolbar } from './MovieModeToolbar';
import { ExportPanel } from './ExportPanel';
import { MovieModeBottomNav } from './MovieModeBottomNav';
import { MovieModeHome, primeStreamImport } from './MovieModeHome';
import { MovieModeProjectsTab } from './MovieModeProjectsTab';
import { MovieModePlaceholderTab } from './MovieModePlaceholderTab';
import {
  isMovieModeProjectId,
  parseMovieModeRoute,
} from './movieModeRoutes';
import { useMovieModeProject } from '../hooks/useMovieModeProject';
import { useMovieModeProjects } from '../hooks/useMovieModeProjects';
import { timelineToEditSession } from './editSessionAdapter';

type SaveDestination = 'local' | 'google_drive' | 'byok_r2';

export default function MovieModePage() {
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const parsedRoute = useMemo(() => parseMovieModeRoute(location.pathname), [location.pathname]);
  const queryProjectId = searchParams.get('project_id');
  const projectId = useMemo(() => {
    if (isMovieModeProjectId(routeProjectId)) return routeProjectId;
    if (isMovieModeProjectId(queryProjectId)) return queryProjectId;
    return parsedRoute.projectId;
  }, [routeProjectId, queryProjectId, parsedRoute.projectId]);

  const inEditorWorkbench = parsedRoute.tab === 'editor' && isMovieModeProjectId(projectId);

  const { project, timeline, loading, error, saving, setTimeline } = useMovieModeProject({
    projectId: inEditorWorkbench ? projectId : null,
  });
  const {
    projects,
    loading: projectsLoading,
    createProject,
  } = useMovieModeProjects(
    (parsedRoute.tab === 'editor' && !inEditorWorkbench) || parsedRoute.tab === 'projects',
  );

  const [lastExportKey, setLastExportKey] = useState<string | null>(null);
  const [mirrorBusy, setMirrorBusy] = useState<SaveDestination | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const session = useMemo(() => (timeline ? timelineToEditSession(timeline) : null), [timeline]);

  const mirrorExport = useCallback(async (r2Key: string, destination: SaveDestination) => {
    if (!r2Key) return;
    setMirrorBusy(destination);
    try {
      const res = await fetch('/api/moviemode/assets/save', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination,
          bucket: 'artifacts',
          r2_key: r2Key,
          filename: r2Key.split('/').pop(),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        video_base64?: string;
        web_view_link?: string;
      };
      if (!data.ok && data.error) {
        alert(data.error);
        return;
      }
      if (destination === 'local' && data.video_base64) {
        const a = document.createElement('a');
        a.href = `data:video/mp4;base64,${data.video_base64}`;
        a.download = r2Key.split('/').pop() || 'moviemode-export.mp4';
        a.click();
      }
      if (destination === 'google_drive' && data.web_view_link) {
        window.open(data.web_view_link, '_blank', 'noopener,noreferrer');
      }
    } finally {
      setMirrorBusy(null);
    }
  }, []);

  const onExportComplete = useCallback(
    (r2Key: string) => {
      setLastExportKey(r2Key);
      setExportOpen(false);
      void mirrorExport(r2Key, 'local');
    },
    [mirrorExport],
  );

  const onSaveToDrive = useCallback(
    (r2Key: string) => {
      setLastExportKey(r2Key);
      void mirrorExport(r2Key, 'google_drive');
    },
    [mirrorExport],
  );

  const handleCreateProject = useCallback(async () => {
    setCreating(true);
    try {
      const id = await createProject();
      navigate(`/dashboard/moviemode/${encodeURIComponent(id)}`);
    } catch (e) {
      alert(String((e as Error)?.message || e));
    } finally {
      setCreating(false);
    }
  }, [createProject, navigate]);

  const handleImportStream = useCallback(async () => {
    setCreating(true);
    try {
      primeStreamImport();
      const id = await createProject();
      navigate(`/dashboard/moviemode/${encodeURIComponent(id)}`);
    } catch (e) {
      alert(String((e as Error)?.message || e));
    } finally {
      setCreating(false);
    }
  }, [createProject, navigate]);

  if (inEditorWorkbench && loading) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center gap-2 text-muted">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading Movie Mode…</span>
      </div>
    );
  }

  const driveActions =
    lastExportKey ? (
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={mirrorBusy !== null}
          className="text-[10px] px-2 py-1 rounded border border-[var(--dashboard-border)] text-muted hover:text-main disabled:opacity-50"
          onClick={() => void mirrorExport(lastExportKey, 'google_drive')}
        >
          {mirrorBusy === 'google_drive' ? 'Drive…' : 'Drive'}
        </button>
        <button
          type="button"
          disabled={mirrorBusy !== null}
          className="text-[10px] px-2 py-1 rounded border border-[var(--dashboard-border)] text-muted hover:text-main disabled:opacity-50"
          onClick={() => void mirrorExport(lastExportKey, 'local')}
        >
          {mirrorBusy === 'local' ? 'Saving…' : 'Download'}
        </button>
      </div>
    ) : null;

  let main: React.ReactNode = null;

  if (parsedRoute.tab === 'templates') {
    main = (
      <MovieModePlaceholderTab
        title="Templates"
        subtitle="Starter layouts and branded packs — coming in the next Movie Mode sprint."
      />
    );
  } else if (parsedRoute.tab === 'ai-studio') {
    main = (
      <MovieModePlaceholderTab
        title="AI Studio"
        subtitle="AutoCut, captions, voice, and generative tools will live here."
      />
    );
  } else if (parsedRoute.tab === 'projects') {
    main = (
      <MovieModeProjectsTab
        projects={projects}
        loading={projectsLoading}
        onCreate={() => void handleCreateProject()}
        creating={creating}
      />
    );
  } else if (inEditorWorkbench) {
    main = (
      <>
        <MovieModeToolbar
          title={project?.title || 'Movie Mode'}
          subtitle={project?.slug || 'Untitled project · 16:9'}
          saving={saving}
          onExport={session ? () => setExportOpen(true) : undefined}
          exportDisabled={!session}
          extraActions={driveActions}
        />
        {error ? <p className="px-3 py-1 text-xs text-amber-400/90">{error}</p> : null}
        <div className="flex-1 min-h-0 flex flex-col">
          <MovieModeWorkbench
            projectId={projectId}
            projectSlug={project?.slug}
            timeline={timeline}
            onTimelineChange={setTimeline}
          />
        </div>
      </>
    );
  } else {
    main = (
      <MovieModeHome
        projects={projects}
        projectsLoading={projectsLoading}
        onNewMovie={() => void handleCreateProject()}
        onImportStream={() => void handleImportStream()}
        creating={creating}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
      {main}

      <MovieModeBottomNav activeTab={parsedRoute.tab} projectId={projectId} />

      {exportOpen && session ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50">
          <div
            role="dialog"
            aria-labelledby="moviemode-export-title"
            className="w-full max-w-md rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--dashboard-border)]">
              <h2 id="moviemode-export-title" className="text-sm font-semibold text-main">
                Export
              </h2>
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                className="p-1 rounded text-muted hover:text-main"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4 max-h-[70vh] overflow-y-auto">
              <ExportPanel
                session={session}
                projectId={projectId}
                onExportComplete={onExportComplete}
                onSaveToDrive={onSaveToDrive}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
