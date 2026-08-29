import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PanelRight } from 'lucide-react';
import { MeshyBalancePill } from '../MeshyBalancePill';
import { MeshyPlatformNotice } from './MeshyPlatformNotice';
import { MeshyToolRail, MobileMeshyToolStrip } from './MeshyToolRail';
import { MeshyToolkitTweaks } from './MeshyToolkitTweaks';
import { ApiInspector } from './ApiInspector';
import { DEFAULT_SCAD, OpenScadEditorStrip } from './AdvancedOpenScadPanel';
import { useCreationStation } from './useCreationStation';
import { openStudioTerminal } from '../studioTerminalOutput';
import { CS_GRID } from './layout';
import {
  readStoredStudioSegment,
  persistStudioSegment,
  type StudioSegment,
} from './meshyToolkitTypes';
import type { useDesignStudioCad } from '../hooks/useDesignStudioCad';
import type { CustomAsset, GenerationConfig, SceneConfig } from '../../../types';
import type { SavedSceneRow } from '../shared/ScenePanel';
import type { CadJobRow } from '../api';
import type { AgentSamGeneratorKey } from '../../../utils/agentSamGenerators';
import { KEYS_PATH } from './MeshyPlatformNotice';

type CadHook = ReturnType<typeof useDesignStudioCad>;

export type DesignStudioCreationStationProps = {
  cad: CadHook;
  viewport: React.ReactNode;
  customAssets: CustomAsset[];
  onSpawnModel: (name: string, url: string, scale: number) => void;
  onSpawnProcedural?: (key: AgentSamGeneratorKey) => void;
  onAddCustomAsset: (name: string, url: string) => void | Promise<void>;
  onRemoveCustomAsset: (id: string) => void | Promise<void>;
  onRefreshUserAssets?: () => void;
  onImportGlb?: (file: File) => void;
  onBlenderExport?: () => void;
  sceneName: string;
  onSceneNameChange: (n: string) => void;
  savedScenes: SavedSceneRow[];
  sceneBusy: boolean;
  onSaveScene: () => void;
  onLoadScene: (id: string) => void;
  onDownloadLatestGlb?: () => void;
  onExportSceneJson?: () => void;
  onDeployJob: (job: CadJobRow) => void;
  cadJobId?: string | null;
  glbR2Key?: string | null;
  genConfig: GenerationConfig;
  onUpdateGenConfig: (c: Partial<GenerationConfig>) => void;
  sceneConfig: SceneConfig;
  onUpdateSceneConfig: (c: Partial<SceneConfig>) => void;
  activeJob?: CadJobRow | null;
  engineContainerRef?: React.RefObject<HTMLDivElement | null>;
  onEngineContainerMount?: () => void;
};

export function DesignStudioCreationStation({
  cad,
  viewport,
  customAssets,
  onSpawnModel,
  onSpawnProcedural,
  onAddCustomAsset,
  onRemoveCustomAsset,
  onRefreshUserAssets,
  onImportGlb,
  onBlenderExport,
  sceneName,
  onSceneNameChange,
  savedScenes,
  sceneBusy,
  onSaveScene,
  onLoadScene,
  onDownloadLatestGlb,
  onExportSceneJson,
  onDeployJob,
  cadJobId,
  glbR2Key,
  genConfig,
  onUpdateGenConfig,
  sceneConfig,
  onUpdateSceneConfig,
  activeJob,
  engineContainerRef,
  onEngineContainerMount,
}: DesignStudioCreationStationProps) {
  const navigate = useNavigate();
  const cs = useCreationStation(cad);
  const [studioSegment, setStudioSegment] = useState<StudioSegment>(readStoredStudioSegment);
  const [advScript, setAdvScript] = useState(DEFAULT_SCAD);
  const [advDirty, setAdvDirty] = useState(false);
  const [mobilePane, setMobilePane] = useState<'tools' | 'view'>('view');
  const [apiOpen, setApiOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  const onSegmentChange = useCallback(
    (seg: StudioSegment) => {
      persistStudioSegment(seg);
      setStudioSegment(seg);
      setMobilePane('tools');
    },
    [],
  );

  const attachEngineContainer = useCallback(
    (el: HTMLDivElement | null) => {
      if (engineContainerRef) {
        (engineContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }
      if (el) onEngineContainerMount?.();
    },
    [engineContainerRef, onEngineContainerMount],
  );

  useEffect(() => {
    if (studioSegment !== 'advanced') return;
    const fromBp = cad.activeBlueprint?.cad_script?.trim();
    if (fromBp) {
      setAdvScript(fromBp);
      setAdvDirty(false);
    }
  }, [studioSegment, cad.activeBlueprint?.id, cad.activeBlueprint?.cad_script]);

  const onRailSelect = useCallback(
    (tool: typeof cs.activeTool) => {
      cs.setActiveTool(tool);
      persistStudioSegment('meshy');
      setStudioSegment('meshy');
      setMobilePane('tools');
    },
    [cs],
  );

  const openTerminalWithLogs = useCallback(() => {
    openStudioTerminal({ tab: 'output' });
  }, []);

  const handleCreate = () => {
    openTerminalWithLogs();
    setMobilePane('view');
    if (cs.meshyPhase === 'preview') void cs.runPreview();
    else void cs.runRefine();
  };

  const latestGlb = activeJob?.public_url || activeJob?.result_url;
  const progressPct = cad.polledJob?.progress_pct;
  const progressLabel =
    (progressPct ?? 0) >= 92 ? 'Finalizing' : 'Generating';
  const meshySegmentActive = studioSegment === 'meshy';
  const advancedActive = studioSegment === 'advanced';

  return (
    <div
      className={`${CS_GRID} absolute inset-x-0 top-0 z-10`}
      style={{ bottom: 'var(--terminal-drawer-h, 0px)' }}
    >
      <MobileMeshyToolStrip
        active={cs.activeTool}
        meshySegmentActive={meshySegmentActive}
        onSelect={onRailSelect}
      />

      <div
        className={`min-h-0 flex md:col-start-1 md:row-start-1 border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] ${
          mobilePane === 'tools' ? 'flex max-h-[52vh] md:max-h-none' : 'hidden md:flex'
        }`}
      >
        {meshySegmentActive && (
          <MeshyToolRail
            active={cs.activeTool}
            meshySegmentActive={meshySegmentActive}
            onSelect={onRailSelect}
            onOpenApiKey={() => navigate(KEYS_PATH)}
            onOpenTerminal={openTerminalWithLogs}
            className="shrink-0"
          />
        )}
        <MeshyToolkitTweaks
          studioSegment={studioSegment}
          onStudioSegment={onSegmentChange}
          railTool={cs.activeTool}
          cs={cs}
          cad={cad}
          genConfig={genConfig}
          onUpdateGenConfig={onUpdateGenConfig}
          sceneConfig={sceneConfig}
          onUpdateSceneConfig={onUpdateSceneConfig}
          sceneName={sceneName}
          onSceneNameChange={onSceneNameChange}
          savedScenes={savedScenes}
          sceneBusy={sceneBusy}
          onSaveScene={onSaveScene}
          onLoadScene={onLoadScene}
          cadJobId={cadJobId}
          glbR2Key={glbR2Key}
          customAssets={customAssets}
          onSpawnModel={onSpawnModel}
          onSpawnProcedural={onSpawnProcedural}
          onAddCustomAsset={onAddCustomAsset}
          onRemoveCustomAsset={onRemoveCustomAsset}
          onRefreshUserAssets={onRefreshUserAssets}
          onDeployJob={onDeployJob}
          onImportGlb={onImportGlb}
          onExportSceneJson={onBlenderExport ?? onExportSceneJson}
          onDownloadLatestGlb={onDownloadLatestGlb}
          latestGlbUrl={latestGlb}
          onCreate={handleCreate}
          onQuickGenerate={() => {
            openTerminalWithLogs();
            void cs.runQuickGenerate();
          }}
          advancedScript={advScript}
          advancedDirty={advDirty}
          onAdvancedDirtyChange={setAdvDirty}
          onAdvancedScriptUpdate={(s) => {
            setAdvScript(s);
            setAdvDirty(true);
          }}
          onAdvancedScriptChange={(s) => {
            setAdvScript(s);
            setAdvDirty(true);
          }}
          className="flex-1 min-w-0 h-full"
        />
      </div>

      <div
        className={`flex flex-col min-h-0 min-w-0 md:col-start-2 md:row-start-1 ${
          mobilePane === 'view' ? 'flex flex-1 row-start-2 md:row-start-1' : 'hidden md:flex'
        }`}
      >
        <header className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]/95 backdrop-blur-md">
          <div className="flex items-center gap-2 min-w-0">
            <div className="min-w-0">
              <h1 className="text-[13px] font-semibold text-main truncate">Design Studio</h1>
              <p className="text-[10px] text-muted truncate">
                {advancedActive ? 'OpenSCAD · code + preview' : 'Meshy toolkit · viewport'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="md:hidden px-2 py-1 text-[10px] font-semibold text-muted border border-[var(--border-subtle)] rounded-lg"
              onClick={() => setMobilePane((p) => (p === 'view' ? 'tools' : 'view'))}
            >
              {mobilePane === 'view' ? 'Tools' : 'View'}
            </button>
            <button
              type="button"
              className="hidden lg:flex p-2 rounded-lg text-muted hover:text-main hover:bg-[var(--bg-hover)]"
              onClick={() => setApiOpen((o) => !o)}
              title="Toggle API inspector"
            >
              <PanelRight size={16} />
            </button>
            <MeshyBalancePill refreshKey={cs.balance ?? 0} />
          </div>
        </header>

        <div className="flex-1 min-h-0 relative bg-[var(--scene-bg)] flex flex-col">
          {(cs.meshyStub || cad.meshyStub || cad.error) && (
            <div className="shrink-0 px-3 pt-2 space-y-2">
              <MeshyPlatformNotice stub={cs.meshyStub || cad.meshyStub} />
              {cad.error ? (
                <p
                  className="text-[11px] rounded-lg px-3 py-2 border leading-relaxed"
                  style={{
                    color: 'var(--text-main)',
                    background: 'color-mix(in srgb, var(--solar-red, #f87171) 12%, transparent)',
                    borderColor: 'color-mix(in srgb, var(--solar-red, #f87171) 35%, transparent)',
                  }}
                >
                  {cad.error}
                </p>
              ) : null}
            </div>
          )}
          <div className="flex-1 min-h-0 flex">
            {advancedActive ? (
              <div className="w-[42%] min-w-[240px] max-w-[50%] shrink-0 hidden md:flex">
                <OpenScadEditorStrip
                  script={advScript}
                  onChange={(s) => {
                    setAdvScript(s);
                    setAdvDirty(true);
                  }}
                />
              </div>
            ) : null}
            <div className="flex-1 min-w-0 relative min-h-[240px]">
              {engineContainerRef ? (
                <div
                  ref={attachEngineContainer}
                  className="absolute inset-0 z-0"
                  style={{ background: 'var(--scene-bg)' }}
                />
              ) : null}
              <div className="absolute inset-0 z-10">{viewport}</div>
            </div>
          </div>
          {cad.isGenerating && (progressPct ?? 0) >= 0 ? (
            <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-3 pointer-events-none">
              <div
                className="mx-auto max-w-md rounded-xl border px-4 py-3 shadow-lg backdrop-blur-md"
                style={{
                  borderColor: 'color-mix(in srgb, var(--solar-cyan) 30%, transparent)',
                  background: 'color-mix(in srgb, var(--bg-panel) 92%, transparent)',
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span
                    className="text-[10px] font-black uppercase tracking-[0.15em]"
                    style={{ color: 'var(--solar-cyan)' }}
                  >
                    {progressLabel}
                  </span>
                  <span className="text-[10px] font-mono text-muted">
                    {progressPct != null && progressPct > 0 ? `${progressPct}%` : ''}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
                  <div
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${Math.max(8, Math.min(100, progressPct || 12))}%`,
                      background: 'var(--solar-cyan)',
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>

      </div>

      {apiOpen && (
        <div className="hidden lg:flex flex-col min-h-0 lg:col-start-3 lg:row-start-1 border-l border-[var(--border-subtle)] min-w-[240px] max-w-[420px] w-[300px] resize-x overflow-auto">
          <ApiInspector
            request={cs.lastRequest}
            response={cs.lastResponse}
            open
            onToggle={() => setApiOpen(false)}
          />
        </div>
      )}

    </div>
  );
}
