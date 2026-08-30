/** Dashboard page <Routes> tree peeled from App.tsx (Wave 2 E7 partial). */
import React from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { MeetProvider, type MeetCtxValue } from './src/MeetContext';
import {
  OverviewPage,
  DashboardHome,
  FinanceDashboard,
  AnalyticsPage,
  RedirectHealthToAnalytics,
  LearnPage,
  DatabasePage,
  DesignStudioPage,
  ImagesShell,
  ImagesStoragePage,
  ImagesDeliveryPage,
  ImagesDeliveryVariantCreatePage,
  ImagesKeysPage,
  ImagesSourcingKitPage,
  ImagesDetailPage,
  ImagesEditPage,
  VideosShell,
  VideosOverviewPage,
  VideosDetailShell,
  VideosAssetDetailPage,
  VideosSettingsTab,
  VideosDownloadsTab,
  VideosCaptionsTab,
  VideosEmbedTab,
  VideosJsonTab,
  VideosPublicDetailsTab,
  VideosTagsTab,
  MailPage,
  MeetPage,
  SettingsPanel,
  TasksPage,
  LibraryPage,
  ProjectsPage,
  ProjectDetailPage,
  WorkflowsPage,
  MovieModePage,
  DrawPage,
  SketchPage,
  CmsPage,
  LaunchDeskPage,
  BookPage,
  ChatsPage,
} from './lazyDashboardPages';

export type DashboardAppRoutesProps = {
  authWorkspaceId: string | null | undefined;
  meetCtxValue: MeetCtxValue | null;
  setMeetCtxValue: React.Dispatch<React.SetStateAction<MeetCtxValue | null>>;
  setDrawEntryPhase: React.Dispatch<React.SetStateAction<boolean>>;
  setDrawComposerHost: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
  setDrawMessagesHost: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
  setSketchEntryPhase: React.Dispatch<React.SetStateAction<boolean>>;
  setSketchComposerHost: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
  setSketchMessagesHost: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
  setDesignStudioEntryPhase: React.Dispatch<React.SetStateAction<boolean>>;
  setDesignStudioComposerHost: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
  setDesignStudioMessagesHost: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
};

export function DashboardAppRoutes(props: DashboardAppRoutesProps) {
  const navigate = useNavigate();
  const {
    authWorkspaceId,
    meetCtxValue,
    setMeetCtxValue,
    setDrawEntryPhase,
    setDrawComposerHost,
    setDrawMessagesHost,
    setSketchEntryPhase,
    setSketchComposerHost,
    setSketchMessagesHost,
    setDesignStudioEntryPhase,
    setDesignStudioComposerHost,
    setDesignStudioMessagesHost,
  } = props;

  return (
<Routes>
  <Route path="/dashboard" element={<Navigate to="/dashboard/home" replace />} />
  <Route path="/dashboard/calendar" element={<Navigate to="/dashboard/collaborate" replace />} />
  <Route path="/dashboard/home" element={<DashboardHome />} />
  <Route path="/dashboard/overview" element={<OverviewPage />} />
  <Route
    path="/dashboard/finance"
    element={
      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-y-contain">
        <FinanceDashboard />
      </div>
    }
  />
  <Route path="/dashboard/library" element={<Navigate to="/dashboard/artifacts" replace />} />
  <Route path="/dashboard/artifacts" element={<LibraryPage />} />
  <Route path="/dashboard/artifacts/tickets/:ticketId" element={<LibraryPage />} />
  <Route path="/dashboard/artifacts/tickets" element={<LibraryPage />} />
  <Route path="/dashboard/artifacts/*" element={<LibraryPage />} />
  <Route path="/dashboard/projects" element={<ProjectsPage />} />
  <Route path="/dashboard/projects/:projectId" element={<ProjectDetailPage />} />
  <Route path="/dashboard/tasks" element={<TasksPage />} />
  <Route path="/dashboard/chats" element={<ChatsPage />} />
  <Route path="/dashboard/launch-desk" element={<Navigate to="/dashboard/collaborate" replace />} />
  <Route
    path="/dashboard/collaborate"
    element={
      <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
        <LaunchDeskPage />
      </div>
    }
  />
  <Route
    path="/dashboard/book/:slug"
    element={
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        <BookPage />
      </div>
    }
  />
  <Route path="/dashboard/analytics" element={<AnalyticsPage />} />
  <Route path="/dashboard/analytics/*" element={<Navigate to="/dashboard/analytics" replace />} />
  <Route path="/dashboard/health" element={<Navigate to="/dashboard/analytics" replace />} />
  <Route path="/dashboard/health/:tab" element={<RedirectHealthToAnalytics />} />
  <Route path="/dashboard/health/*" element={<Navigate to="/dashboard/analytics" replace />} />
  <Route path="/dashboard/learn" element={<LearnPage />} />
  <Route path="/dashboard/workflows" element={<WorkflowsPage />} />
  <Route
    path="/dashboard/database/:databaseName"
    element={
      <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
        <DatabasePage />
      </div>
    }
  />
  <Route
    path="/dashboard/database"
    element={
      <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
        <DatabasePage />
      </div>
    }
  />
  <Route
    path="/dashboard/docs"
    element={<Navigate to="/dashboard/settings/docs" replace />}
  />
  <Route
    path="/dashboard/integrations"
    element={
      <Navigate to="/dashboard/settings/integrations" replace />
    }
  />
  <Route
    path="/dashboard/moviemode/:projectId?"
    element={
      <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
        <MovieModePage />
      </div>
    }
  />
  <Route
    path="/dashboard/draw"
    element={
      <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
        <DrawPage
          onEntryPhaseChange={setDrawEntryPhase}
          onComposerHost={setDrawComposerHost}
          onMessagesHost={setDrawMessagesHost}
        />
      </div>
    }
  />
  <Route
    path="/dashboard/sketch"
    element={
      <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
        <SketchPage
          onEntryPhaseChange={setSketchEntryPhase}
          onComposerHost={setSketchComposerHost}
          onMessagesHost={setSketchMessagesHost}
        />
      </div>
    }
  />
  <Route
    path="/dashboard/cms/sites"
    element={<Navigate to="/dashboard/cms" replace />}
  />
  <Route
    path="/dashboard/cms"
    element={
      <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
        <CmsPage workspaceId={authWorkspaceId || undefined} />
      </div>
    }
  />
  <Route
    path="/dashboard/cms/*"
    element={
      <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
        <CmsPage workspaceId={authWorkspaceId || undefined} />
      </div>
    }
  />
  <Route
    path="/dashboard/designstudio"
    element={
      <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
        <DesignStudioPage
          onEntryPhaseChange={setDesignStudioEntryPhase}
          onComposerHost={setDesignStudioComposerHost}
          onMessagesHost={setDesignStudioMessagesHost}
        />
      </div>
    }
  />
  <Route
    path="/dashboard/storage"
    element={<Navigate to="/dashboard/settings/storage" replace />}
  />
  <Route
    path="/dashboard/images/videos"
    element={
      <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
        <VideosShell workspaceId={authWorkspaceId || undefined} />
      </div>
    }
  >
    <Route index element={<VideosOverviewPage />} />
    <Route path="asset/:assetId" element={<VideosAssetDetailPage />} />
    <Route path=":uid" element={<VideosDetailShell />}>
      <Route index element={<Navigate to="settings" replace />} />
      <Route path="settings" element={<VideosSettingsTab />} />
      <Route path="downloads" element={<VideosDownloadsTab />} />
      <Route path="captions" element={<VideosCaptionsTab />} />
      <Route path="embed" element={<VideosEmbedTab />} />
      <Route path="json" element={<VideosJsonTab />} />
      <Route path="public-details" element={<VideosPublicDetailsTab />} />
      <Route path="tags" element={<VideosTagsTab />} />
    </Route>
  </Route>
  <Route
    path="/dashboard/images"
    element={
      <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
        <ImagesShell workspaceId={authWorkspaceId || undefined} />
      </div>
    }
  >
    <Route index element={<Navigate to="storage" replace />} />
    <Route path="storage" element={<ImagesStoragePage />} />
    <Route path="delivery" element={<ImagesDeliveryPage />} />
    <Route path="delivery/variant/create" element={<ImagesDeliveryVariantCreatePage />} />
    <Route path="keys" element={<ImagesKeysPage />} />
    <Route path="sourcing-kit" element={<ImagesSourcingKitPage />} />
    <Route path=":id/edit" element={<ImagesEditPage />} />
    <Route path=":id" element={<ImagesDetailPage />} />
  </Route>
  <Route path="/dashboard/mail" element={
    <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
      <MailPage />
    </div>
  } />
  <Route
    path="/dashboard/meet"
    element={
      <MeetProvider value={meetCtxValue || ({} as MeetCtxValue)}>
        <MeetPage onContextReady={setMeetCtxValue} />
      </MeetProvider>
    }
  />
  <Route
    path="/dashboard/settings"
    element={<Navigate to="/dashboard/settings/general" replace />}
  />
  <Route
    path="/dashboard/settings/:sectionSlug"
    element={
      <SettingsPanel
        onClose={() => navigate(-1)}
        workspaceId={authWorkspaceId || undefined}
      />
    }
  />
</Routes>
  );
}
