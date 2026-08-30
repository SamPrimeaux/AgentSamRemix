/**
 * Route-level lazy pages + fallbacks for the dashboard shell.
 * Extracted from App.tsx (Wave 2 E1) — mechanical move; keep lazy boundaries.
 */
import React, { lazy } from 'react';
import { Navigate, useParams } from 'react-router-dom';

export function ProjectsLegacyRedirect() {
  const { projectId } = useParams();
  const dest = projectId
    ? `/dashboard/projects/${encodeURIComponent(projectId)}`
    : '/dashboard/projects';
  return <Navigate to={dest} replace />;
}

/** Route-level code splitting: heavy dashboard pages load on demand; shell + /dashboard/agent stay eager. */
export const OverviewPage = lazy(() => import('./components/overview'));
export const DashboardHome = lazy(() => import('./components/DashboardHome').then((m) => ({ default: m.DashboardHome })));
export const FinanceDashboard = lazy(() => import('./components/finance'));
export const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
export const RedirectHealthToAnalytics = lazy(() =>
  import('./pages/RedirectHealthToAnalytics').then((m) => ({ default: m.RedirectHealthToAnalytics })),
);
export const LearnPage = lazy(() => import('./components/LearnPage'));
export const DatabasePage = lazy(() => import('./components/DatabasePage').then((m) => ({ default: m.DatabasePage })));
export const DesignStudioPage = lazy(() => import('./components/DesignStudioPage').then((m) => ({ default: m.DesignStudioPage })));
export const ImagesShell = lazy(() =>
  import('./components/images/ImagesShell').then((m) => ({ default: m.ImagesShell })),
);
export const ImagesStoragePage = lazy(() =>
  import('./components/images/ImagesStoragePage').then((m) => ({ default: m.ImagesStoragePage })),
);
export const ImagesDeliveryPage = lazy(() =>
  import('./components/images/ImagesDeliveryPage').then((m) => ({ default: m.ImagesDeliveryPage })),
);
export const ImagesDeliveryVariantCreatePage = lazy(() =>
  import('./components/images/ImagesDeliveryVariantCreatePage').then((m) => ({
    default: m.ImagesDeliveryVariantCreatePage,
  })),
);
export const ImagesKeysPage = lazy(() =>
  import('./components/images/ImagesKeysPage').then((m) => ({ default: m.ImagesKeysPage })),
);
export const ImagesSourcingKitPage = lazy(() =>
  import('./components/images/ImagesSourcingKitPage').then((m) => ({ default: m.ImagesSourcingKitPage })),
);
export const ImagesDetailPage = lazy(() =>
  import('./components/images/ImagesDetailPage').then((m) => ({ default: m.ImagesDetailPage })),
);
export const ImagesEditPage = lazy(() =>
  import('./components/images/ImagesEditPage').then((m) => ({ default: m.ImagesEditPage })),
);
export const VideosShell = lazy(() =>
  import('./components/videos/VideosShell').then((m) => ({ default: m.VideosShell })),
);
export const VideosOverviewPage = lazy(() =>
  import('./components/videos/VideosOverviewPage').then((m) => ({ default: m.VideosOverviewPage })),
);
export const VideosDetailShell = lazy(() =>
  import('./components/videos/VideosDetailShell').then((m) => ({ default: m.VideosDetailShell })),
);
export const VideosAssetDetailPage = lazy(() =>
  import('./components/videos/VideosAssetDetailPage').then((m) => ({
    default: m.VideosAssetDetailPage,
  })),
);
export const VideosSettingsTab = lazy(() =>
  import('./components/videos/VideosDetailTabs').then((m) => ({ default: m.VideosSettingsTab })),
);
export const VideosDownloadsTab = lazy(() =>
  import('./components/videos/VideosDetailTabs').then((m) => ({ default: m.VideosDownloadsTab })),
);
export const VideosCaptionsTab = lazy(() =>
  import('./components/videos/VideosDetailTabs').then((m) => ({ default: m.VideosCaptionsTab })),
);
export const VideosEmbedTab = lazy(() =>
  import('./components/videos/VideosDetailTabs').then((m) => ({ default: m.VideosEmbedTab })),
);
export const VideosJsonTab = lazy(() =>
  import('./components/videos/VideosDetailTabs').then((m) => ({ default: m.VideosJsonTab })),
);
export const VideosPublicDetailsTab = lazy(() =>
  import('./components/videos/VideosDetailTabs').then((m) => ({
    default: m.VideosPublicDetailsTab,
  })),
);
export const VideosTagsTab = lazy(() =>
  import('./components/videos/VideosDetailTabs').then((m) => ({ default: m.VideosTagsTab })),
);
export const MailPage = lazy(() => import('./components/MailPage').then((m) => ({ default: m.MailPage })));
export const MeetPage = lazy(() => import('./components/MeetPage'));
export const SettingsPanel = lazy(() => import('./components/settings'));
export const TasksPage = lazy(() => import('./pages/tasks/TasksPage'));
export const LibraryPage = lazy(() => import('./pages/library/LibraryPage'));
export const ProjectsPage = lazy(() => import('./pages/projects/ProjectsPage'));
export const ProjectDetailPage = lazy(() => import('./pages/projects/ProjectDetailPage'));
export const WorkflowsPage = lazy(() =>
  import('./pages/workflows/WorkflowsPage').then((m) => ({ default: m.WorkflowsPage })),
);
export const MovieModePage = lazy(() =>
  import('./moviemode/MovieModePage').then((m) => ({ default: m.default })),
);
export const DrawPage = lazy(() =>
  import('./pages/draw/DrawPage').then((m) => ({ default: m.default })),
);
export const SketchPage = lazy(() =>
  import('./pages/sketch/SketchPage').then((m) => ({ default: m.default })),
);
export const CmsPage = lazy(() =>
  import('./pages/cms/CmsPage').then((m) => ({ default: m.default })),
);
export const ExamplesPage = lazy(() =>
  import('./pages/examples/ExamplesPage').then((m) => ({ default: m.default })),
);
export const MonacoEditorView = lazy(() =>
  import('./components/MonacoEditorView').then((m) => ({ default: m.MonacoEditorView })),
);
export const LaunchDeskPage = lazy(() =>
  import('./pages/LaunchDeskPage').then((m) => ({ default: m.LaunchDeskPage })),
);
export const BookPage = lazy(() =>
  import('./pages/book/BookPage').then((m) => ({ default: m.BookPage })),
);
export const BrowserView = lazy(() =>
  import('./components/BrowserView').then((m) => ({ default: m.BrowserView })),
);

/** Activity drawer + agent-only tools — not on critical path for /dashboard/artifacts etc. */
export const AgentSamFilesystem = lazy(() =>
  import('./components/AgentSamFilesystem').then((m) => ({ default: m.AgentSamFilesystem })),
);
export const GitHubExplorer = lazy(() =>
  import('./components/GitHubExplorer').then((m) => ({ default: m.GitHubExplorer })),
);
export const GoogleDriveExplorer = lazy(() =>
  import('./components/GoogleDriveExplorer').then((m) => ({ default: m.GoogleDriveExplorer })),
);
export const SourcePanel = lazy(() =>
  import('./components/SourcePanel').then((m) => ({ default: m.SourcePanel })),
);
export const MCPPanel = lazy(() =>
  import('./components/MCPPanel').then((m) => ({ default: m.MCPPanel })),
);
export const ChatsPage = lazy(() => import('./pages/chats/ChatsPage'));
export const XTermShell = lazy(() =>
  import('./components/XTermShell').then((m) => ({ default: m.XTermShell })),
);

export function ActivityPanelFallback() {
  return (
    <div className="flex flex-1 min-h-[120px] items-center justify-center text-[12px] text-muted">
      Loading…
    </div>
  );
}

export function DashboardRoutesFallback() {
  return (
    <div
      className="flex-1 min-h-0 flex items-center justify-center text-sm"
      style={{ color: 'var(--text-muted)' }}
      role="status"
      aria-live="polite"
    >
      Loading…
    </div>
  );
}
