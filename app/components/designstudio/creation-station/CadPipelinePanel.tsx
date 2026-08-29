import React, { useState } from 'react';
import { Download, Layers } from 'lucide-react';
import { ArtStyle, CADPlane, CADTool, type CustomAsset, type GenerationConfig } from '../../../types';
import { BlueprintPanel } from '../BlueprintPanel';
import { CadGeneratePanel } from '../CadGeneratePanel';
import { CadJobPanel } from '../CadJobPanel';
import { AssetLibrary } from '../shared/AssetLibrary';
import { ScenePanel, type SavedSceneRow } from '../shared/ScenePanel';
import type { useDesignStudioCad } from '../hooks/useDesignStudioCad';
import type { CadJobRow } from '../api';

type CadHook = ReturnType<typeof useDesignStudioCad>;

type Props = {
  cad: CadHook;
  sceneName: string;
  onSceneNameChange: (name: string) => void;
  savedScenes: SavedSceneRow[];
  sceneBusy: boolean;
  onSaveScene: () => void;
  onLoadScene: (id: string) => void;
  cadJobId?: string | null;
  glbR2Key?: string | null;
  customAssets: CustomAsset[];
  onSpawnModel: (name: string, url: string, scale: number) => void;
  onSpawnProcedural?: (key: import('../../../utils/agentSamGenerators').AgentSamGeneratorKey) => void;
  onAddCustomAsset: (name: string, url: string) => void | Promise<void>;
  onRemoveCustomAsset: (id: string) => void | Promise<void>;
  onRefreshUserAssets?: () => void;
  onDeployJob: (job: CadJobRow) => void;
  onImportGlb?: (file: File) => void;
  onExportSceneJson?: () => void;
  onDownloadLatestGlb?: () => void;
  genConfig: GenerationConfig;
  onUpdateGenConfig: (cfg: Partial<GenerationConfig>) => void;
};

export function CadPipelinePanel({
  cad,
  sceneName,
  onSceneNameChange,
  savedScenes,
  sceneBusy,
  onSaveScene,
  onLoadScene,
  cadJobId,
  glbR2Key,
  customAssets,
  onSpawnModel,
  onSpawnProcedural,
  onAddCustomAsset,
  onRemoveCustomAsset,
  onRefreshUserAssets,
  onDeployJob,
  onImportGlb,
  onExportSceneJson,
  onDownloadLatestGlb,
  genConfig,
  onUpdateGenConfig,
}: Props) {
  const [sketchOpen, setSketchOpen] = useState(false);
  const activeJob = cad.polledJob || cad.activeJob;
  const blueprintLinkedJob =
    cad.activeBlueprintId != null
      ? cad.jobs.find((j) => String(j.project_id || '') === String(cad.activeBlueprintId)) ??
        (activeJob?.project_id != null && String(activeJob.project_id) === String(cad.activeBlueprintId)
          ? activeJob
          : null)
      : null;

  return (
    <div className="space-y-4">
      <BlueprintPanel
        blueprints={cad.blueprints}
        activeBlueprintId={cad.activeBlueprintId}
        onSelect={cad.setActiveBlueprintId}
        onCreate={async (title, prompt) => {
          await cad.createNewBlueprint(title, prompt);
        }}
        busy={cad.busy}
        linkedJob={blueprintLinkedJob}
      />

      <CadGeneratePanel
        activeBlueprint={cad.activeBlueprint}
        busy={cad.busy}
        meshyStub={cad.meshyStub}
        onGenerateOpenScad={cad.runOpenScadGenerate}
        onExecuteJob={() => cad.runExecuteJob()}
        onMeshyGenerate={cad.runMeshyGenerate}
        onImportGlb={onImportGlb}
        activeJobStatus={activeJob?.status ?? null}
      />

      <CadJobPanel
        jobs={cad.jobs}
        activeJob={activeJob}
        polling={cad.isGenerating}
        onSelectJob={cad.setActiveJobId}
        onDeploy={onDeployJob}
      />

      {cad.error ? <p className="text-[10px] text-red-400 px-1">{cad.error}</p> : null}

      <ScenePanel
        sceneName={sceneName}
        onSceneNameChange={onSceneNameChange}
        savedScenes={savedScenes}
        sceneBusy={sceneBusy}
        onSaveScene={onSaveScene}
        onLoadScene={onLoadScene}
        cadJobId={cadJobId}
        glbR2Key={glbR2Key}
      />

      <AssetLibrary
        customAssets={customAssets}
        onSpawnModel={onSpawnModel}
        onSpawnProcedural={onSpawnProcedural}
        onAddCustomAsset={onAddCustomAsset}
        onRemoveCustomAsset={onRemoveCustomAsset}
        onRefreshUserAssets={onRefreshUserAssets}
        showDirectUrlLoader
      />

      <section className="bg-[var(--bg-hover)] p-3 rounded-2xl border border-[var(--border-subtle)] space-y-2">
        <button
          type="button"
          onClick={() => setSketchOpen((v) => !v)}
          className="w-full flex items-center justify-between text-[10px] font-black text-muted uppercase tracking-[0.2em]"
        >
          <span className="flex items-center gap-2">
            <Layers size={14} style={{ color: 'var(--solar-cyan)' }} />
            Sketch (plane & extrusion)
          </span>
        </button>
        {sketchOpen && (
          <div className="space-y-3 pt-1">
            <div className="flex gap-2">
              {[CADPlane.XZ, CADPlane.XY, CADPlane.YZ].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onUpdateGenConfig({ cadPlane: p })}
                  className="flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase border"
                  style={{
                    background: genConfig.cadPlane === p ? 'var(--solar-cyan)' : 'var(--bg-panel)',
                    color: genConfig.cadPlane === p ? 'var(--bg-app)' : 'var(--text-muted)',
                    borderColor: genConfig.cadPlane === p ? 'var(--solar-cyan)' : 'var(--border-subtle)',
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
            <div>
              <div className="flex justify-between text-[9px] text-muted mb-1">
                <span>Extrusion</span>
                <span className="font-mono" style={{ color: 'var(--solar-cyan)' }}>
                  {genConfig.extrusion}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={30}
                value={genConfig.extrusion}
                onChange={(e) => onUpdateGenConfig({ extrusion: parseInt(e.target.value, 10) })}
                className="w-full"
                style={{ accentColor: 'var(--solar-cyan)' }}
              />
            </div>
            <p className="text-[9px] text-muted">
              Style: {genConfig.style || ArtStyle.CYBERPUNK} · Tool: {genConfig.cadTool || CADTool.NONE}
            </p>
          </div>
        )}
      </section>

      <div className="space-y-2">
        {onDownloadLatestGlb && activeJob?.public_url ? (
          <button
            type="button"
            onClick={onDownloadLatestGlb}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[var(--border-subtle)] text-[10px] font-black uppercase text-main"
          >
            <Download size={14} />
            Download Latest GLB
          </button>
        ) : null}
        {onExportSceneJson ? (
          <button
            type="button"
            onClick={onExportSceneJson}
            className="w-full py-2 text-[9px] font-bold text-muted uppercase hover:text-main"
          >
            Export scene JSON (dev)
          </button>
        ) : null}
      </div>
    </div>
  );
}
