import React, { useRef } from 'react';
import { Clapperboard, Loader2, Search, Sparkles, Upload } from 'lucide-react';
import type { MeshyRailTool } from './meshyToolkitTypes';
import { MESHY_RAIL_TOOLS } from './meshyToolkitTypes';
import { StudioSegmentBar } from './StudioSegmentBar';
import { CadPipelinePanel } from './CadPipelinePanel';
import { MotionTweaksPanel } from '../MotionTweaksPanel';
import { AnimationTweaksPanel } from '../AnimationTweaksPanel';
import { MeshyPlatformNotice } from './MeshyPlatformNotice';
import { MeshyKeysLink, MeshyPromptField, MeshyTaskIdField } from './MeshyRailFields';
import { AdvancedEngineerPanel } from './AdvancedEngineerPanel';
import { TweaksPanel } from './TweaksPanel';
import type { StudioSegment } from './meshyToolkitTypes';
import type { useDesignStudioCad } from '../hooks/useDesignStudioCad';
import type { CustomAsset, GenerationConfig, SceneConfig } from '../../../types';
import type { SavedSceneRow } from '../shared/ScenePanel';
import type { CadJobRow } from '../api';

type CadHook = ReturnType<typeof useDesignStudioCad>;

type MeshyCs = ReturnType<typeof import('./useCreationStation').useCreationStation>;

type Props = {
  studioSegment: StudioSegment;
  onStudioSegment: (s: StudioSegment) => void;
  railTool: MeshyRailTool;
  cs: MeshyCs;
  cad: CadHook;
  genConfig: GenerationConfig;
  onUpdateGenConfig: (c: Partial<GenerationConfig>) => void;
  sceneConfig: SceneConfig;
  onUpdateSceneConfig: (c: Partial<SceneConfig>) => void;
  sceneName: string;
  onSceneNameChange: (n: string) => void;
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
  latestGlbUrl?: string | null;
  onCreate: () => void;
  onQuickGenerate: () => void;
  advancedScript?: string;
  advancedDirty?: boolean;
  onAdvancedDirtyChange?: (dirty: boolean) => void;
  onAdvancedScriptUpdate?: (script: string) => void;
  onAdvancedScriptChange?: (script: string) => void;
  className?: string;
};

// ── Image-to-3D panel ────────────────────────────────────────────────────────

function ImageTo3DPanel({ cs }: { cs: MeshyCs }) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold text-main">Image to 3D</p>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) cs.setImageFile(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="w-full rounded-xl border border-dashed border-[var(--border-subtle)] text-center hover:border-[var(--solar-cyan)] transition-colors overflow-hidden"
        style={{ background: 'var(--bg-hover)' }}
      >
        {cs.imageDataUrl ? (
          <img
            src={cs.imageDataUrl}
            alt="Upload preview"
            className="w-full max-h-40 object-contain"
          />
        ) : (
          <div className="py-8">
            <Upload size={22} className="mx-auto mb-2 text-muted" />
            <p className="text-[12px] font-medium text-main">Click or drop image</p>
            <p className="text-[10px] text-muted mt-1">PNG, JPG, WEBP — max 20 MB</p>
          </div>
        )}
      </button>
      {cs.imageFile && (
        <p className="text-[10px] text-muted truncate px-1">{cs.imageFile.name}</p>
      )}
      <MeshyKeysLink />
    </div>
  );
}

// ── Animate panel ────────────────────────────────────────────────────────────

const ANIM_CLIPS_FALLBACK = ['Walking', 'Running', 'Idle', 'Jump', 'Wave'] as const;

function AnimatePanel({ cs }: { cs: MeshyCs }) {
  const clips =
    cs.animationClips.length > 0
      ? cs.animationClips
      : ANIM_CLIPS_FALLBACK.map((name, i) => ({ action_id: 92 + i, name }));

  return (
    <div className="space-y-4">
      <MeshyTaskIdField
        label="Source model task ID (for rigging)"
        value={cs.rigTaskId}
        onChange={cs.setRigTaskId}
      />
      <p className="text-[10px] text-muted leading-snug">
        Textured humanoid GLB only. Face must point +Z for model URLs. Max 300,000 faces via
        input_task_id — remesh first if needed.
      </p>
      <MeshyTaskIdField
        label="Rigging task ID (for animation)"
        value={cs.rigCompletedTaskId}
        onChange={cs.setRigCompletedTaskId}
        placeholder="Filled automatically after rigging, or paste Meshy rig task ID"
      />
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Search size={12} className="text-muted" />
          <p className="text-[10px] font-bold text-muted uppercase tracking-[0.14em]">
            Animation library
          </p>
        </div>
        <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto custom-scrollbar">
          {clips.map((clip) => {
            const active = cs.animationActionId === clip.action_id;
            return (
              <button
                key={`${clip.action_id}-${clip.name}`}
                type="button"
                className={`flex items-center gap-1.5 px-2 py-2 rounded-lg border text-[10px] font-medium transition-colors text-left ${
                  active
                    ? 'border-[var(--solar-cyan)] text-[var(--solar-cyan)]'
                    : 'border-[var(--border-subtle)] text-muted hover:text-[var(--solar-cyan)] hover:border-[var(--solar-cyan)]'
                }`}
                style={{
                  background: active
                    ? 'color-mix(in srgb, var(--solar-cyan) 10%, transparent)'
                    : 'var(--bg-hover)',
                }}
                onClick={() => cs.setAnimationActionId(clip.action_id)}
              >
                <Clapperboard size={11} className="shrink-0" />
                <span className="truncate">{clip.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-[9px] text-muted">
        Step 1: Rig & Animate CTA runs rigging. Step 2: pick a clip and run again for full animation GLB.
      </p>
      <MeshyKeysLink />
    </div>
  );
}

function SourceTaskPanel({
  cs,
  children,
}: {
  cs: MeshyCs;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <MeshyTaskIdField value={cs.sourceTaskId} onChange={cs.setSourceTaskId} />
      {children}
      <MeshyKeysLink />
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

export function MeshyToolkitTweaks({
  studioSegment,
  onStudioSegment,
  railTool,
  cs,
  cad,
  genConfig,
  onUpdateGenConfig,
  sceneConfig,
  onUpdateSceneConfig,
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
  latestGlbUrl,
  onCreate,
  onQuickGenerate,
  advancedScript = '',
  advancedDirty = false,
  onAdvancedDirtyChange,
  onAdvancedScriptUpdate,
  onAdvancedScriptChange,
  className = '',
}: Props) {
  const railMeta = MESHY_RAIL_TOOLS.find((t) => t.id === railTool);
  const showMeshyCta =
    studioSegment === 'meshy' &&
    [
      'text-to-3d',
      'image-to-3d',
      'text-to-texture',
      'texture',
      'animate',
      'post-process',
      'image',
      'print',
    ].includes(railTool);

  const meshyBody =
    studioSegment === 'meshy' ? (
      <>
        <MeshyPlatformNotice stub={cs.meshyStub} className="mb-3" />
        {railTool === 'text-to-3d' ? (
        <TweaksPanel
          tool="text-to-3d"
          meshyPhase={cs.meshyPhase}
          onMeshyPhase={cs.setMeshyPhase}
          settings={cs.settings}
          onPatch={cs.patchSettings}
          meshyStub={cs.meshyStub}
          ctaCost={cs.ctaCost}
          isGenerating={cs.isGenerating}
          progressPct={cad.polledJob?.progress_pct}
          onCreate={onCreate}
          onQuickGenerate={onQuickGenerate}
          latestGlbUrl={latestGlbUrl}
          onDownloadGlb={onDownloadLatestGlb}
          embedded
        />
      ) : railTool === 'image-to-3d' ? (
        <ImageTo3DPanel cs={cs} />
      ) : railTool === 'animate' ? (
        <AnimatePanel cs={cs} />
      ) : railTool === 'text-to-texture' ? (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold text-main">Text to Texture</p>
          <MeshyTaskIdField
            value={cs.sourceTaskId}
            onChange={cs.setSourceTaskId}
            label="Model task ID"
            placeholder="Completed Meshy text/image-to-3D task ID"
          />
          <MeshyPromptField
            label="Texture prompt"
            value={cs.texturePrompt}
            onChange={cs.setTexturePrompt}
            placeholder="Weathered bronze armor with emerald inlays"
            maxLength={600}
          />
          <p className="text-[10px] text-muted leading-snug">
            Source must be a SUCCEEDED Text-to-3D, Image-to-3D, or Remesh task. Max 600 characters.
          </p>
          <MeshyKeysLink />
        </div>
      ) : railTool === 'texture' ? (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold text-main">Retexture</p>
          <SourceTaskPanel cs={cs}>
            <MeshyPromptField
              label="Texture prompt"
              value={cs.texturePrompt}
              onChange={cs.setTexturePrompt}
              rows={3}
              maxLength={600}
            />
          </SourceTaskPanel>
          <p className="text-[10px] text-muted leading-snug">
            Provide text_style_prompt or image_style_url (image takes priority). model_url supports
            glb, gltf, obj, fbx, stl.
          </p>
        </div>
      ) : railTool === 'post-process' ? (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold text-main">Post-Process / Remesh</p>
          <SourceTaskPanel cs={cs} />
          <p className="text-[10px] text-muted">Exports GLB + FBX with optimized topology.</p>
        </div>
      ) : railTool === 'image' ? (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold text-main">Text to Image</p>
          <MeshyPromptField
            label="Prompt"
            value={cs.imageGenPrompt}
            onChange={cs.setImageGenPrompt}
            placeholder="A majestic dragon soaring through clouds at sunset"
          />
          <MeshyKeysLink />
        </div>
      ) : railTool === 'print' ? (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold text-main">3D Print Export</p>
          <SourceTaskPanel cs={cs} />
          <p className="text-[10px] text-muted leading-snug">
            Converts textured models to multi-color 3MF (10 credits). Download from Properties →
            Export after the job completes.
          </p>
          <p className="text-[10px] text-muted leading-snug">
            Workflow: analyze geometry → remesh/cleanup → orient on bed → export STL → verify in
            slicer.
          </p>
        </div>
      ) : null}
      </>
    ) : null;

  const ctaLabel = (() => {
    if (railTool === 'image-to-3d') return 'Generate from Image';
    if (railTool === 'animate') {
      return cs.rigCompletedTaskId.trim() && cs.animationActionId != null
        ? 'Apply Animation'
        : 'Rig Character';
    }
    if (railTool === 'text-to-texture') return 'Generate Texture';
    if (railTool === 'texture') return 'Retexture Model';
    if (railTool === 'post-process') return 'Remesh & Export';
    if (railTool === 'image') return 'Generate Image';
    if (railTool === 'print') return 'Export for Print';
    return cs.meshyPhase === 'preview' ? 'Create Preview' : 'Create Refine';
  })();

  const ctaAction = (() => {
    if (railTool === 'image-to-3d') return () => { void cs.runImageTo3D(); };
    if (railTool === 'animate') {
      return () => {
        if (cs.rigCompletedTaskId.trim() && cs.animationActionId != null) void cs.runAnimateClip();
        else void cs.runRig();
      };
    }
    if (railTool === 'text-to-texture') return () => { void cs.runTextToTexture(); };
    if (railTool === 'texture') return () => { void cs.runTexture(); };
    if (railTool === 'post-process') return () => { void cs.runPostProcess(); };
    if (railTool === 'image') return () => { void cs.runTextToImage(); };
    if (railTool === 'print') return () => { void cs.runPrintExport(); };
    return onCreate;
  })();

  const ctaDisabled =
    cs.isGenerating ||
    (railTool === 'image-to-3d' && !cs.imageDataUrl) ||
    (railTool === 'animate' && !cs.rigTaskId.trim() && !cs.rigCompletedTaskId.trim()) ||
    (railTool === 'texture' && !cs.sourceTaskId.trim()) ||
    (railTool === 'texture' && !cs.texturePrompt.trim()) ||
    (railTool === 'post-process' && !cs.sourceTaskId.trim()) ||
    (railTool === 'print' && !cs.sourceTaskId.trim()) ||
    (railTool === 'text-to-texture' && !cs.texturePrompt.trim()) ||
    (railTool === 'text-to-texture' && !cs.sourceTaskId.trim()) ||
    (railTool === 'image' && !cs.imageGenPrompt.trim()) ||
    (railTool === 'animate' &&
      cs.rigCompletedTaskId.trim() &&
      cs.animationActionId == null);

  return (
    <div className={`flex flex-col min-h-0 min-w-0 bg-[var(--bg-panel)] ${className}`}>
      <div className="shrink-0 px-3 pt-2 pb-2 space-y-2 border-b border-[var(--border-subtle)]">
        <StudioSegmentBar active={studioSegment} onChange={onStudioSegment} />
        <p className="text-[10px] text-muted uppercase tracking-[0.18em] font-bold">
          {studioSegment === 'meshy' ? railMeta?.label : studioSegment}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-3">
        {studioSegment === 'cad' && (
          <CadPipelinePanel
            cad={cad}
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
            onAddCustomAsset={onAddCustomAsset}
            onRemoveCustomAsset={onRemoveCustomAsset}
            onRefreshUserAssets={onRefreshUserAssets}
            onDeployJob={onDeployJob}
            onImportGlb={onImportGlb}
            onExportSceneJson={onExportSceneJson}
            onDownloadLatestGlb={onDownloadLatestGlb}
            genConfig={genConfig}
            onUpdateGenConfig={onUpdateGenConfig}
          />
        )}
        {studioSegment === 'motion' && (
          <MotionTweaksPanel
            genConfig={genConfig}
            onUpdateGenConfig={onUpdateGenConfig}
            sceneConfig={sceneConfig}
            onUpdateSceneConfig={onUpdateSceneConfig}
          />
        )}
        {studioSegment === 'animation' && (
          <AnimationTweaksPanel
            genConfig={genConfig}
            onUpdateGenConfig={onUpdateGenConfig}
            onSpawnModel={onSpawnModel}
          />
        )}
        {studioSegment === 'advanced' && (
          <AdvancedEngineerPanel
            cad={cad}
            customAssets={customAssets}
            advancedScript={advancedScript}
            advancedDirty={advancedDirty}
            onAdvancedDirtyChange={onAdvancedDirtyChange}
            onAdvancedScriptUpdate={onAdvancedScriptUpdate}
            onAdvancedScriptChange={onAdvancedScriptChange}
          />
        )}
        {meshyBody}
      </div>

      {showMeshyCta && (
        <div
          className="shrink-0 px-3 py-3 border-t border-[var(--border-subtle)]"
          style={{ background: 'linear-gradient(0deg, var(--bg-panel) 70%, transparent)' }}
        >
          {railTool === 'text-to-3d' && (
            <p className="text-[10px] text-center text-muted mb-2">
              ~{cs.ctaCost} credits · opens terminal output
            </p>
          )}
          <button
            type="button"
            disabled={ctaDisabled}
            onClick={ctaAction}
            className="w-full py-3 rounded-full font-bold text-[13px] flex items-center justify-center gap-2 disabled:opacity-40"
            style={{
              background: 'linear-gradient(90deg, var(--solar-cyan), var(--solar-violet))',
              color: 'var(--bg-app)',
            }}
          >
            {cs.isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {ctaLabel}
          </button>
        </div>
      )}
    </div>
  );
}
