/**
 * Design Studio — 3-lane creation station (/dashboard/designstudio).
 */
import React, { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  IAM_AGENT_CHAT_CONVERSATION_CHANGE,
  IAM_AGENT_RUN_CONTEXT,
  IAM_DESIGNSTUDIO_CAD_JOB,
  LS_AGENT_CHAT_CONVERSATION_ID,
} from '../agentChatConstants';
import { publishDesignStudioSurfaceContext } from '../src/lib/designStudioEvents';
import { normalizeGlbUrl } from '@inneranimalmedia/client-3d-runtime/assets';
import { DESIGN_STUDIO_BIM_EXAMPLE, isDesignStudioBimExampleUrl } from '../lib/designStudioBimExample';
import {
  fetchPlacementSidecarForGlb,
  sidecarUrlForGlb,
  spawnMetadataFromSidecar,
  type EntitySpatialSnapshot,
} from '../lib/cadPlacement';
import { useDesignStudioCad } from './designstudio/hooks/useDesignStudioCad';
import { spawnGlbInEngine } from './designstudio/spawnGlb';
import { meshyMetadataFromJob } from './designstudio/cad-studio/characterAnimationPacks';
import { useDesignStudioContext } from './designstudio/DesignStudioContext';
import type { CadJobRow } from './designstudio/api';
import { downloadCadAsset } from './designstudio/cadExportFormats';
import type { SavedSceneRow } from './designstudio/shared/ScenePanel';
import { StudioEntryScreen } from './designstudio/cad-studio/StudioEntryScreen';
import type { AgentSamGeneratorKey } from '../utils/agentSamGenerators';
import {
  ProjectType,
  AppState,
  GameEntity,
  GenerationConfig,
  ArtStyle,
  SceneConfig,
  CADTool,
  CADPlane,
  CustomAsset,
} from '../types';

const CadStudioShell = lazy(() =>
  import('./designstudio/cad-studio/CadStudioShell').then((m) => ({ default: m.CadStudioShell })),
);

const ACTIVE_PROJECT = ProjectType.CAD;

type AgentSamEngineClass = typeof import('../services/AgentSamEngine').AgentSamEngine;
type AgentSamEngineInstance = InstanceType<AgentSamEngineClass>;
type StudioEngine = AgentSamEngineInstance;

type PendingGlbState = { pendingGlb?: { url: string; name: string } };

type StudioStockAsset = {
  id: string;
  name: string;
  url: string;
  scale: number;
};

function isAgentSamEngine(engine: StudioEngine | null): engine is AgentSamEngineInstance {
  return engine != null && 'setProjectType' in engine;
}

function parseStudioAssetApiRow(row: {
  id?: string;
  label?: string;
  public_url?: string;
  scale?: number;
}): StudioStockAsset | null {
  const id = String(row.id || '').trim();
  const url = normalizeGlbUrl(row.public_url);
  if (!id || !url) return null;
  const name = String(row.label || id).trim() || id;
  const scale =
    typeof row.scale === 'number' && Number.isFinite(row.scale) && row.scale > 0 ? row.scale : 1;
  return { id, name, url, scale };
}

export type DesignStudioPageProps = {
  onEntryPhaseChange?: (entry: boolean) => void;
  onComposerHost?: (el: HTMLDivElement | null) => void;
  onMessagesHost?: (el: HTMLDivElement | null) => void;
};

export const DesignStudioPage: React.FC<DesignStudioPageProps> = ({
  onEntryPhaseChange,
  onComposerHost,
  onMessagesHost,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setStudioContext } = useDesignStudioContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const pageRootRef = useRef<HTMLDivElement>(null);
  const pendingConsumedRef = useRef(false);
  const pendingSpawnRef = useRef<{ name: string; url: string; scale: number } | null>(null);
  const lastSpawnedJobRef = useRef<string | null>(null);
  const pendingCompletedJobRef = useRef<CadJobRow | null>(null);
  const studioPhaseRef = useRef<'entry' | 'studio'>('entry');
  // Phase 1A: bootstrapDoneRef moved to top-level so engine cleanup can reset it
  const bootstrapDoneRef = useRef(false);

  const [studioPhase, setStudioPhase] = useState<'entry' | 'studio'>('entry');
  useEffect(() => {
    studioPhaseRef.current = studioPhase;
  }, [studioPhase]);
  useEffect(() => {
    onEntryPhaseChange?.(studioPhase === 'entry');
  }, [studioPhase, onEntryPhaseChange]);

  const [engineHostReady, setEngineHostReady] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [engineLoading, setEngineLoading] = useState(false);
  const [viewCubeOrientation, setViewCubeOrientation] = useState({ x: -22, y: 32, z: 0 });
  const [appState, setAppState] = useState<AppState>(AppState.EDITING);
  const [entityCount, setEntityCount] = useState(0);
  const [customAssets, setCustomAssets] = useState<CustomAsset[]>([]);
  const [undoStack, setUndoStack] = useState<GameEntity[]>([]);
  const [redoStack, setRedoStack] = useState<GameEntity[]>([]);
  const [currentSceneId, setCurrentSceneId] = useState<string | null>(null);
  const [linkedCadJobId, setLinkedCadJobId] = useState<string | null>(null);
  const [linkedGlbR2Key, setLinkedGlbR2Key] = useState<string | null>(null);

  const [entities, setEntities] = useState<GameEntity[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [spatialOverlaysEnabled, setSpatialOverlaysEnabled] = useState(true);
  const [entitySpatialTick, setEntitySpatialTick] = useState(0);

  const [genConfig, setGenConfig] = useState<GenerationConfig>({
    style: ArtStyle.CYBERPUNK,
    density: 5,
    usePhysics: true,
    cadTool: CADTool.NONE,
    cadPlane: CADPlane.XZ,
    extrusion: 1,
  });

  const [sceneConfig, setSceneConfig] = useState<SceneConfig>({
    ambientIntensity: 1.5,
    sunColor: '#ffffff',
    castShadows: true,
    showPhysicsDebug: false,
  });

  const [savedScenes, setSavedScenes] = useState<SavedSceneRow[]>([]);
  const [sceneName, setSceneName] = useState('');
  const [sceneBusy, setSceneBusy] = useState(false);
  /** Idle until a CAD job or Diagnostics — health probe starts IAM_CAD_WORKER. */
  const [computeHealth] = useState<
    'ready' | 'running' | 'degraded' | 'unavailable' | 'unknown'
  >('unknown');
  const [agentSessionId, setAgentSessionId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(LS_AGENT_CHAT_CONVERSATION_ID)?.trim() || null;
  });
  const [agentRunId, setAgentRunId] = useState<string | null>(null);

  const persistSceneAutosave = useCallback(
    async (link?: { cadJobId?: string | null; glbR2Key?: string | null }) => {
      if (!isAgentSamEngine(engineRef.current)) return;
      const entities = engineRef.current.exportEntities();
      if (!entities.length) return;
      const wsId =
        (typeof window !== 'undefined' &&
          (window as Window & { __IAM_WORKSPACE_ID__?: string }).__IAM_WORKSPACE_ID__) ||
        '';
      const cadJobId = link?.cadJobId ?? linkedCadJobId ?? null;
      const glbKey = link?.glbR2Key ?? linkedGlbR2Key ?? null;
      try {
        const res = await fetch('/api/designstudio/scenes/autosave', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            project_type: ACTIVE_PROJECT,
            entities,
            cad_job_id: cadJobId,
            glb_r2_key: glbKey,
            scene_id: currentSceneId || undefined,
            ...(wsId && wsId !== 'global' ? { workspace_id: wsId } : {}),
          }),
        });
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as {
          scene?: { id?: string; cad_job_id?: string; glb_r2_key?: string };
        };
        const scene = data.scene;
        if (scene?.id) setCurrentSceneId(scene.id);
        if (scene?.cad_job_id) setLinkedCadJobId(String(scene.cad_job_id));
        if (scene?.glb_r2_key) setLinkedGlbR2Key(String(scene.glb_r2_key));
      } catch (e) {
        console.warn('[DesignStudio] autosave failed', e);
      }
    },
    [linkedCadJobId, linkedGlbR2Key, currentSceneId],
  );

  const deployJobToScene = useCallback(async (job: CadJobRow, opts?: { auto?: boolean; save?: boolean }) => {
    const url = job.public_url || job.result_url;
    if (!url) return false;
    const name = job.prompt?.slice(0, 40) || `${job.engine} export`;
    const normalizedUrl = normalizeGlbUrl(url) ?? url;
    if (!isAgentSamEngine(engineRef.current)) {
      if (opts?.auto) {
        pendingSpawnRef.current = { name, url: normalizedUrl, scale: 1 };
      }
      return false;
    }
    const ok = await spawnGlbInEngine(engineRef.current, {
      url: normalizedUrl,
      name,
      metadata: meshyMetadataFromJob(job),
    });
    if (ok) {
      setLinkedCadJobId(job.id);
      if (job.r2_key && !String(job.r2_key).startsWith('b64:')) {
        setLinkedGlbR2Key(job.r2_key);
      }
      lastSpawnedJobRef.current = job.id;
      if (isAgentSamEngine(engineRef.current)) {
        requestAnimationFrame(() => engineRef.current?.frameCameraOnObject());
      }
      if (opts?.auto) console.info('[DesignStudio] auto-spawned GLB', job.id);
      if (opts?.auto && opts?.save) {
        void persistSceneAutosave({
          cadJobId: job.id,
          glbR2Key:
            job.r2_key && !String(job.r2_key).startsWith('b64:') ? String(job.r2_key) : null,
        });
      }
    }
    return ok;
  }, [persistSceneAutosave]);

  const cad = useDesignStudioCad({
    sessionId: agentSessionId,
    sceneId: currentSceneId,
    onJobDone: (job) => {
      const status = String(job.status || '').toLowerCase();
      const hasUrl = Boolean(job.public_url || job.result_url);
      const isComplete = (status === 'done' || status === 'complete') && hasUrl;
      if (!isComplete) return;

      if (studioPhaseRef.current === 'studio') {
        void refreshUserAssets();
        if (lastSpawnedJobRef.current !== job.id) {
          void deployJobToScene(job, { auto: true });
        }
        return;
      }

      pendingCompletedJobRef.current = job;
    },
  });

  useEffect(() => {
    const onStudioAction = (e: Event) => {
      const { action, params } = (e as CustomEvent<{ action?: string; params?: { blueprint_id?: string } }>)
        .detail || {};
      if (action !== 'select_blueprint') return;
      const id = typeof params?.blueprint_id === 'string' ? params.blueprint_id.trim() : '';
      if (!id) return;
      cad.setActiveBlueprintId(id);
      void cad.refreshBlueprints();
    };
    window.addEventListener('iam:designstudio_action', onStudioAction as EventListener);
    return () => window.removeEventListener('iam:designstudio_action', onStudioAction as EventListener);
  }, [cad.setActiveBlueprintId, cad.refreshBlueprints]);

  useEffect(() => {
    const onConv = (e: Event) => {
      const raw = (e as CustomEvent<{ id?: string | null }>).detail?.id;
      if (raw === null || raw === undefined) {
        setAgentSessionId(null);
        return;
      }
      if (typeof raw === 'string' && raw.trim()) {
        setAgentSessionId(raw.trim());
      }
    };
    window.addEventListener(IAM_AGENT_CHAT_CONVERSATION_CHANGE, onConv);
    return () => window.removeEventListener(IAM_AGENT_CHAT_CONVERSATION_CHANGE, onConv);
  }, []);

  useEffect(() => {
    const onRun = (e: Event) => {
      const raw = (e as CustomEvent<{ id?: string | null }>).detail?.id;
      setAgentRunId(typeof raw === 'string' && raw.trim() ? raw.trim() : null);
    };
    window.addEventListener(IAM_AGENT_RUN_CONTEXT, onRun);
    return () => window.removeEventListener(IAM_AGENT_RUN_CONTEXT, onRun);
  }, []);

  useEffect(() => {
    const onCadJob = (e: Event) => {
      const jobId = (e as CustomEvent<{ job_id?: string }>).detail?.job_id?.trim();
      if (jobId) {
        cad.setActiveJobId(jobId);
      }
    };
    window.addEventListener(IAM_DESIGNSTUDIO_CAD_JOB, onCadJob);
    return () => window.removeEventListener(IAM_DESIGNSTUDIO_CAD_JOB, onCadJob);
  }, [cad.setActiveJobId]);

  useEffect(() => {
    const sessionId = agentSessionId?.trim();
    const runId = agentRunId?.trim();
    if (!sessionId || !runId) return;
    cad.subscribeRunEvents(runId, sessionId);
  }, [agentSessionId, agentRunId, cad.subscribeRunEvents]);

  const refreshSceneList = useCallback(() => {
    fetch('/api/designstudio/scenes', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        const rows = Array.isArray(data?.scenes) ? data.scenes : [];
        setSavedScenes(
          rows.map(
            (s: {
              id: string;
              name: string;
              entity_count: number;
              updated_at: number;
              cad_job_id?: string | null;
              glb_r2_key?: string | null;
            }) => ({
              id: s.id,
              name: s.name,
              entity_count: s.entity_count,
              updated_at: s.updated_at,
              cad_job_id: s.cad_job_id,
              glb_r2_key: s.glb_r2_key,
            }),
          ),
        );
      })
      .catch(() => {});
  }, []);

  const refreshUserAssets = useCallback(() => {
    fetch('/api/designstudio/assets?category=3d_studio_user&is_live=1', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        const rows = Array.isArray(data?.results) ? data.results : [];
        setCustomAssets(
          rows
            .map((row: Parameters<typeof parseStudioAssetApiRow>[0]) => parseStudioAssetApiRow(row))
            .filter((a): a is StudioStockAsset => a != null)
            .map((a) => ({ id: a.id, name: a.name, url: a.url, scale: a.scale })),
        );
      })
      .catch((e) => console.warn('[Asset Library]', e));
  }, []);

  useEffect(() => {
    refreshSceneList();
    refreshUserAssets();
  }, [refreshSceneList, refreshUserAssets]);

  useEffect(() => {
    const st = (location.state as PendingGlbState | null)?.pendingGlb;
    if (st?.url) setStudioPhase('studio');
  }, [location.state]);

  useEffect(() => {
    setStudioContext({
      activeProject: ACTIVE_PROJECT,
      sceneId: currentSceneId,
      blueprintId: cad.activeBlueprintId,
      cadJobId: cad.activeJobId || linkedCadJobId,
      sessionId: agentSessionId,
      runId: agentRunId,
      computeStatus: cad.isGenerating ? 'running' : computeHealth,
      selectedObjectId: selectedEntityId,
      workspaceMode: studioPhase,
    });
  }, [
    currentSceneId,
    cad.activeBlueprintId,
    cad.activeJobId,
    cad.isGenerating,
    linkedCadJobId,
    agentSessionId,
    agentRunId,
    computeHealth,
    selectedEntityId,
    studioPhase,
    setStudioContext,
  ]);

  const getEntitySpatialInfo = useCallback(
    (id: string): EntitySpatialSnapshot | null => {
      void entitySpatialTick;
      if (!isAgentSamEngine(engineRef.current)) return null;
      return engineRef.current.getEntitySpatialInfo(id);
    },
    [entitySpatialTick],
  );

  useEffect(() => {
    const selected = selectedEntityId
      ? entities.find((e) => e.id === selectedEntityId) ?? null
      : null;
    const spatial = selectedEntityId ? getEntitySpatialInfo(selectedEntityId) : null;
    const polled = cad.polledJob;
    publishDesignStudioSurfaceContext({
      surface: 'design_studio',
      route: typeof window !== 'undefined' ? window.location.pathname : '/dashboard/designstudio',
      phase: studioPhase,
      scene_id: currentSceneId,
      scene_name: sceneName.trim() || null,
      cad_job_id: cad.activeJobId || linkedCadJobId,
      blueprint_id: cad.activeBlueprintId,
      entity_count: entityCount || entities.length,
      selected_entity_id: selectedEntityId,
      selected_entity: selected
        ? {
            id: selected.id,
            name: selected.name,
            type: selected.type,
            modelUrl: selected.modelUrl ?? null,
            scale: selected.scale ?? null,
          }
        : null,
      spatial: spatial
        ? {
            units: spatial.units,
            source_units: spatial.source_units ?? null,
            spawn_profile: spatial.spawn_profile,
            up_axis: spatial.up_axis ?? null,
            ground_y: spatial.ground_y,
            rotation_euler_deg: spatial.rotation_euler_deg,
            world_bbox: spatial.world_bbox,
          }
        : null,
      entities: entities.slice(0, 16).map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        modelUrl: e.modelUrl ?? null,
      })),
      compute_status: cad.isGenerating ? 'running' : computeHealth,
      cad_job_status: polled?.status != null ? String(polled.status) : null,
      cad_job_progress_pct:
        polled?.progress_pct != null
          ? Number(polled.progress_pct)
          : polled?.progress != null
            ? Number(polled.progress)
            : null,
      cad_public_url:
        polled?.public_url != null
          ? String(polled.public_url)
          : polled?.result_url != null
            ? String(polled.result_url)
            : null,
      engine: polled?.engine != null ? String(polled.engine) : null,
    });
  }, [
    studioPhase,
    currentSceneId,
    sceneName,
    cad.activeJobId,
    cad.activeBlueprintId,
    cad.isGenerating,
    cad.polledJob,
    linkedCadJobId,
    entityCount,
    entities,
    selectedEntityId,
    computeHealth,
    getEntitySpatialInfo,
    entitySpatialTick,
  ]);

  useEffect(() => {
    if (studioPhase !== 'studio') return;
    const container = containerRef.current;
    if (!container || !engineHostReady) return;

    let cancelled = false;
    let engine: StudioEngine | null = null;

    setEngineLoading(true);
    const mountEngine = async () => {
      const { AgentSamEngine } = await import('../services/AgentSamEngine');
      if (cancelled || !containerRef.current) return;
      engine = new AgentSamEngine(container, (s) => setAppState(s), (c) => setEntityCount(c));
      engineRef.current = engine;
      engine.setOnEntityCreated((entity) => {
        setUndoStack((prev) => [...prev, entity]);
        setRedoStack([]);
      });
      engine.setOnEntitySelected((id) => setSelectedEntityId(id));
      engine.updateLighting(sceneConfig);
      engine.setCADPlane(genConfig.cadPlane);
      engine.setExtrusion(genConfig.extrusion);
      engine.setProjectType(ACTIVE_PROJECT);
      engine.setViewTool('select');
      engine.ensureViewportNavigation();
      const settleViewport = () => {
        if (isAgentSamEngine(engine)) engine.handleResize();
      };
      requestAnimationFrame(() => {
        settleViewport();
        requestAnimationFrame(settleViewport);
      });
      setEngineReady(true);
      setEngineLoading(false);
    };

    void mountEngine();

    const handleResize = () => {
      if (isAgentSamEngine(engineRef.current)) {
        engineRef.current.handleResize();
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', handleResize);
      setEngineReady(false);
      // Phase 1A: reset bootstrap state so re-entering studio starts clean
      bootstrapDoneRef.current = false;
      engine?.cleanup();
      engineRef.current = null;
      container.innerHTML = '';
    };
  }, [engineHostReady, studioPhase]);

  useEffect(() => {
    if (isAgentSamEngine(engineRef.current)) {
      engineRef.current.updateLighting(sceneConfig);
    }
  }, [
    sceneConfig.ambientIntensity,
    sceneConfig.sunColor,
    sceneConfig.castShadows,
    sceneConfig.showPhysicsDebug,
  ]);

  useEffect(() => {
    if ((location.state as PendingGlbState | null)?.pendingGlb) {
      pendingConsumedRef.current = false;
    }
  }, [location.state]);

  useEffect(() => {
    if (!engineReady || !isAgentSamEngine(engineRef.current) || pendingConsumedRef.current) return;
    const st = (location.state as PendingGlbState | null)?.pendingGlb;
    if (!st?.url) return;
    pendingConsumedRef.current = true;
    void spawnGlbInEngine(engineRef.current, { url: st.url, name: st.name || 'Imported' });
    navigate(location.pathname, { replace: true, state: {} });
  }, [engineReady, location.state, location.pathname, navigate]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0 || !isAgentSamEngine(engineRef.current)) return;
    const last = undoStack[undoStack.length - 1];
    engineRef.current.removeEntity(last.id);
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, last]);
  }, [undoStack]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || !isAgentSamEngine(engineRef.current)) return;
    const next = redoStack[redoStack.length - 1];
    engineRef.current.spawnEntity(next);
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, next]);
  }, [redoStack]);

  const handleUpdateGenConfig = useCallback((cfg: Partial<GenerationConfig>) => {
    setGenConfig((prev) => {
      const next = { ...prev, ...cfg };
      if (isAgentSamEngine(engineRef.current)) {
        if (cfg.cadTool !== undefined) engineRef.current.setCADTool(cfg.cadTool);
        if (cfg.cadPlane !== undefined) engineRef.current.setCADPlane(cfg.cadPlane);
        if (cfg.extrusion !== undefined) engineRef.current.setExtrusion(cfg.extrusion);
      }
      return next;
    });
  }, []);

  const handleSpawnModel = useCallback(
    async (
      name: string,
      url: string,
      scale: number,
      extraMeta?: Record<string, unknown>,
    ): Promise<boolean> => {
      const normalized = normalizeGlbUrl(url) ?? url;
      if (!normalized) {
        console.warn('[DesignStudio] spawn: could not resolve URL for', name, url);
        return false;
      }
      let placementMeta: Record<string, unknown> = { ...(extraMeta || {}) };
      if (isDesignStudioBimExampleUrl(normalized)) {
        placementMeta = {
          ...placementMeta,
          spawn_profile: 'bim',
          source_units: 'mm',
          up_axis: 'Z',
          glb_up_axis: 'Y',
          fit_to_viewport: false,
          proof_lane: 'bim',
          engine: 'freecad',
          source_fcstd: DESIGN_STUDIO_BIM_EXAMPLE.sourceFile,
          cad_job_id: DESIGN_STUDIO_BIM_EXAMPLE.cadJobId,
          placement_sidecar_url: sidecarUrlForGlb(normalized),
        };
      }
      const sidecar = await fetchPlacementSidecarForGlb(normalized);
      if (sidecar) {
        placementMeta = { ...placementMeta, ...spawnMetadataFromSidecar(sidecar) };
      }
      if (!isAgentSamEngine(engineRef.current)) {
        pendingSpawnRef.current = { name, url: normalized, scale };
        setStudioPhase('studio');
        return true;
      }
      try {
        const entityId = `asset_${Date.now()}`;
        await engineRef.current.spawnEntity({
          id: entityId,
          name,
          type: 'prop',
          modelUrl: normalized,
          scale: scale > 0 ? scale : undefined,
          position: { x: 0, y: 0, z: 0 },
          behavior: {
            type: 'static',
            metadata: Object.keys(placementMeta).length ? placementMeta : undefined,
          },
        });
        setSelectedEntityId(entityId);
        engineRef.current.setSelectedSpatialEntity(entityId);
        engineRef.current.setSpatialOverlaysEnabled(spatialOverlaysEnabled);
        setEntitySpatialTick((n) => n + 1);
        requestAnimationFrame(() => engineRef.current?.frameCameraOnObject());
        return true;
      } catch (err) {
        console.warn('[DesignStudio] spawn failed', name, normalized, err);
        return false;
      }
    },
    [spatialOverlaysEnabled],
  );

  // Phase 1A: coordinated pending-spawn effect — fires after engineReady.
  // Consumes pendingSpawnRef and resolves the GLB before bootstrap can run.
  useEffect(() => {
    if (!engineReady || !isAgentSamEngine(engineRef.current)) return;
    const pending = pendingSpawnRef.current;
    if (!pending) return;
    pendingSpawnRef.current = null;

    void (async () => {
      const ok = await handleSpawnModel(pending.name, pending.url, pending.scale);
      if (!ok) {
        console.warn('[DesignStudio] pending spawn failed, scene is empty');
      }
      // Bootstrap intentionally skipped — user arrived with a GLB intent.
    })();
  }, [engineReady, handleSpawnModel]);

  // Phase 1A + 1B: bootstrap effect — only runs when no pending spawn exists.
  // Phase 1B: no Cube.001 spawn. Empty grid is the correct empty-scene default.
  useEffect(() => {
    if (!engineReady || !isAgentSamEngine(engineRef.current)) return;
    // Guard: skip if a spawn is pending (race condition prevention)
    if (pendingSpawnRef.current) return;
    if (bootstrapDoneRef.current) return;

    // Guard: skip if user navigated here with a pendingGlb intent
    const hasPendingGlb = !!(location.state as PendingGlbState | null)?.pendingGlb;
    if (hasPendingGlb) return;

    const engine = engineRef.current;
    const existing = engine.exportEntities();
    if (existing.length > 0) {
      bootstrapDoneRef.current = true;
      engine.frameCameraOnObject();
      return;
    }

    // Phase 1B: empty scene — no default Cube.001.
    // User will add content via stock click, import, or generate.
    bootstrapDoneRef.current = true;
    console.info('[DesignStudio] bootstrap: empty scene ready');
  }, [engineReady, location.state]);

  const handleSpawnProcedural = useCallback((key: AgentSamGeneratorKey) => {
    if (!isAgentSamEngine(engineRef.current)) return;
    void engineRef.current
      .spawnProceduralModel(key)
      .catch((err) => console.warn('[DesignStudio] procedural spawn failed', err));
  }, []);

  const handleAddCustomAsset = useCallback(
    async (name: string, url: string) => {
      const res = await fetch('/api/designstudio/assets', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: name, public_url: url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof (data as { error?: string }).error === 'string'
            ? (data as { error: string }).error
            : 'Failed to save asset',
        );
      }
      refreshUserAssets();
    },
    [refreshUserAssets],
  );

  const handleRemoveCustomAsset = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/designstudio/assets/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof (data as { error?: string }).error === 'string'
            ? (data as { error: string }).error
            : 'Failed to remove asset',
        );
      }
      refreshUserAssets();
    },
    [refreshUserAssets],
  );

  const handleImportGlbFile = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file);
      void handleSpawnModel(file.name.replace(/\.glb$/i, ''), url, 1);
    },
    [handleSpawnModel],
  );

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const glb = Array.from(e.dataTransfer.files).find((f) => f.name.toLowerCase().endsWith('.glb'));
      if (glb) {
        setStudioPhase('studio');
        handleImportGlbFile(glb);
      }
    },
    [handleImportGlbFile],
  );

  const onClear = useCallback(() => {
    if (!isAgentSamEngine(engineRef.current)) return;
    engineRef.current.clearWorld();
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const handleSaveScene = useCallback(async () => {
    if (!isAgentSamEngine(engineRef.current)) return;
    setSceneBusy(true);
    try {
      const entities = engineRef.current.exportEntities();
      const activeJob = cad.polledJob || cad.activeJob;
      const res = await fetch('/api/designstudio/scenes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: currentSceneId || undefined,
          name: sceneName.trim() || `Scene ${new Date().toLocaleString()}`,
          project_type: ACTIVE_PROJECT,
          entities,
          cad_job_id: linkedCadJobId || activeJob?.id || null,
          glb_r2_key:
            linkedGlbR2Key ||
            (activeJob?.r2_key && !String(activeJob.r2_key).startsWith('b64:')
              ? activeJob.r2_key
              : null),
          voxel_count: entityCount,
          style_preset: genConfig.style,
          project_id: cad.activeBlueprintId,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json().catch(() => ({}));
      const scene = (data as { scene?: { id?: string; cad_job_id?: string; glb_r2_key?: string } }).scene;
      if (scene?.id) setCurrentSceneId(scene.id);
      if (scene?.cad_job_id) setLinkedCadJobId(String(scene.cad_job_id));
      if (scene?.glb_r2_key) setLinkedGlbR2Key(String(scene.glb_r2_key));
      refreshSceneList();
    } catch (e) {
      console.warn('[DesignStudio] save scene failed', e);
    } finally {
      setSceneBusy(false);
    }
  }, [
    sceneName,
    refreshSceneList,
    cad,
    linkedCadJobId,
    linkedGlbR2Key,
    entityCount,
    genConfig.style,
    currentSceneId,
  ]);

  const handleLoadScene = useCallback(async (sceneId: string) => {
    if (!isAgentSamEngine(engineRef.current)) return;
    setSceneBusy(true);
    try {
      const [entitiesRes, metaRes] = await Promise.all([
        fetch(`/api/designstudio/scenes/${encodeURIComponent(sceneId)}/entities`, {
          credentials: 'include',
        }),
        fetch(`/api/designstudio/scenes/${encodeURIComponent(sceneId)}`, { credentials: 'include' }),
      ]);
      if (!entitiesRes.ok) throw new Error(await entitiesRes.text());
      const data = await entitiesRes.json();
      await engineRef.current.loadEntities(data.entities || [], { keepBoard: true });
      setCurrentSceneId(sceneId);
      if (metaRes.ok) {
        const meta = await metaRes.json();
        const scene = (meta as { scene?: SavedSceneRow }).scene;
        if (scene?.cad_job_id) setLinkedCadJobId(String(scene.cad_job_id));
        if (scene?.glb_r2_key) setLinkedGlbR2Key(String(scene.glb_r2_key));
        if (scene?.name) setSceneName(scene.name);
      }
      setUndoStack([]);
      setRedoStack([]);
    } catch (e) {
      console.warn('[DesignStudio] load scene failed', e);
    } finally {
      setSceneBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!engineReady || !isAgentSamEngine(engineRef.current) || !currentSceneId) return;
    const tick = window.setInterval(() => {
      void persistSceneAutosave();
    }, 60_000);
    return () => window.clearInterval(tick);
  }, [engineReady, currentSceneId, persistSceneAutosave]);

  useEffect(() => {
    if (!engineReady) return;
    let raf = 0;
    const last = { x: 0, y: 0, z: 0 };
    const tick = () => {
      const eng = engineRef.current;
      if (isAgentSamEngine(eng)) {
        const o = eng.getViewCubeOrientation();
        if (
          Math.abs(o.x - last.x) > 0.35 ||
          Math.abs(o.y - last.y) > 0.35 ||
          Math.abs(o.z - last.z) > 0.35
        ) {
          last.x = o.x;
          last.y = o.y;
          last.z = o.z;
          setViewCubeOrientation(o);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engineReady]);

  const activeJobForBar = cad.polledJob || cad.activeJob;

  useEffect(() => {
    if (!engineReady || !isAgentSamEngine(engineRef.current)) return;
    const sync = () => {
      const list = engineRef.current?.exportEntities() ?? [];
      setEntities((prev) => {
        if (
          prev.length === list.length &&
          list.every((e, i) => {
            const p = prev[i];
            return p && e.id === p.id && e.name === p.name &&
              e.position?.x === p.position?.x &&
              e.position?.y === p.position?.y &&
              e.position?.z === p.position?.z &&
              e.scale === p.scale;
          })
        ) return prev;
        return list;
      });
      setSelectedEntityId((sel) => {
        const next =
          sel && !list.some((e) => e.id === sel) ? (list[0]?.id ?? null) : sel;
        if (isAgentSamEngine(engineRef.current)) {
          engineRef.current.setSelectedSpatialEntity(next);
        }
        return next;
      });
    };
    sync();
    const id = window.setInterval(sync, 500);
    return () => window.clearInterval(id);
  }, [engineReady]);

  const handleAddCube = useCallback(() => {
    if (!isAgentSamEngine(engineRef.current)) return;
    const voxels: GameEntity['voxels'] = [];
    for (let x = -1; x <= 1; x++) {
      for (let y = 0; y <= 2; y++) {
        for (let z = -1; z <= 1; z++) {
          voxels.push({ x, y, z, color: 0xaeb5bd });
        }
      }
    }
    const id = `cube_${Date.now()}`;
    void engineRef.current
      .spawnEntity({
        id,
        name: `Cube.${String(entities.length + 1).padStart(3, '0')}`,
        type: 'prop',
        voxels,
        scale: 1,
        position: { x: 0, y: 1.5, z: 0 },
        behavior: { type: 'static' },
      })
      .then(() => setSelectedEntityId(id))
      .catch((err) => console.warn('[DesignStudio] add cube failed', err));
  }, [entities.length]);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedEntityId || !isAgentSamEngine(engineRef.current)) return;
    engineRef.current.removeEntity(selectedEntityId);
    setSelectedEntityId(null);
  }, [selectedEntityId]);

  const handleDownloadLatestGlb = useCallback(() => {
    const job = activeJobForBar;
    const url = job?.public_url;
    if (!url) return;
    downloadCadAsset(url, `${job?.engine || 'cad'}-export.glb`);
  }, [activeJobForBar]);

  const handleExportSceneJson = useCallback(() => {
    if (isAgentSamEngine(engineRef.current)) {
      engineRef.current.exportForBlender();
    }
  }, []);

  const handleFrameAll = useCallback(() => {
    if (isAgentSamEngine(engineRef.current)) {
      engineRef.current.frameCameraOnObject();
    }
  }, []);

  const handleViewportZoom = useCallback((factor: number) => {
    if (isAgentSamEngine(engineRef.current)) {
      engineRef.current.zoomViewport(factor);
    }
  }, []);

  const handleViewportPanMode = useCallback((active: boolean) => {
    if (isAgentSamEngine(engineRef.current)) {
      engineRef.current.setPanNavigation(active);
    }
  }, []);

  const handleViewportReset = useCallback(() => {
    if (isAgentSamEngine(engineRef.current)) {
      engineRef.current.resetViewportCamera();
    }
  }, []);

  const handleEntityRename = useCallback(
    async (id: string, name: string) => {
      if (!isAgentSamEngine(engineRef.current)) return;
      const list = engineRef.current.exportEntities();
      const ent = list.find((e) => e.id === id);
      if (!ent) return;
      await engineRef.current.spawnEntity({ ...ent, name });
    },
    [],
  );

  const handleEntityTransform = useCallback(
    async (id: string, patch: Partial<GameEntity>) => {
      if (!isAgentSamEngine(engineRef.current)) return;
      const list = engineRef.current.exportEntities();
      const ent = list.find((e) => e.id === id);
      if (!ent) return;
      await engineRef.current.spawnEntity({ ...ent, ...patch });
    },
    [],
  );

  const openFullStudio = useCallback(() => {
    const pending = pendingCompletedJobRef.current;
    if (pending) {
      const url = pending.public_url || pending.result_url;
      if (url) {
        const name = pending.prompt?.slice(0, 40) || `${pending.engine} export`;
        pendingSpawnRef.current = { name, url: normalizeGlbUrl(url) ?? url, scale: 1 };
        pendingCompletedJobRef.current = null;
      }
    }
    setStudioPhase('studio');
  }, []);

  const handleEntrySpawnStock = useCallback(
    (name: string, url: string, scale: number) => {
      setStudioPhase('studio');
      void handleSpawnModel(name, url, scale);
    },
    [handleSpawnModel],
  );

  const handleLoadBimExample = useCallback(() => {
    setStudioPhase('studio');
    void handleSpawnModel(
      DESIGN_STUDIO_BIM_EXAMPLE.name,
      DESIGN_STUDIO_BIM_EXAMPLE.url,
      DESIGN_STUDIO_BIM_EXAMPLE.scale,
    );
  }, [handleSpawnModel]);

  const handleSelectEntity = useCallback((id: string | null) => {
    setSelectedEntityId(id);
    if (isAgentSamEngine(engineRef.current)) {
      engineRef.current.setSelectedSpatialEntity(id);
    }
  }, []);

  const handleSnapEntityToGrid = useCallback((id: string) => {
    if (!isAgentSamEngine(engineRef.current)) return;
    engineRef.current.snapEntityToGridOrigin(id);
    setEntitySpatialTick((n) => n + 1);
  }, []);

  const handleSetEntityGroundY = useCallback((id: string, y: number) => {
    if (!isAgentSamEngine(engineRef.current)) return;
    engineRef.current.setEntityGroundY(id, y);
    setEntitySpatialTick((n) => n + 1);
  }, []);

  const handleSpatialOverlaysChange = useCallback((enabled: boolean) => {
    setSpatialOverlaysEnabled(enabled);
    if (isAgentSamEngine(engineRef.current)) {
      engineRef.current.setSpatialOverlaysEnabled(enabled);
    }
  }, []);

  const handleEntryImportGlb = useCallback(
    (file: File) => {
      handleImportGlbFile(file);
    },
    [handleImportGlbFile],
  );

  const handleCancelCadJob = useCallback(
    (cadJobId: string) => {
      void cad.cancelActiveJob(cadJobId);
    },
    [cad.cancelActiveJob],
  );

  const entryMode: 'idle' | 'generating' | 'loading-studio' =
    studioPhase === 'studio' && !engineReady ? 'loading-studio' : cad.isGenerating ? 'generating' : 'idle';

  const polledStatus = String(cad.polledJob?.status || '').toLowerCase();
  const entryJobReady =
    studioPhase === 'entry' &&
    !cad.isGenerating &&
    Boolean(cad.polledJob?.public_url || cad.polledJob?.result_url) &&
    (polledStatus === 'done' || polledStatus === 'complete');

  const entryStatusLabel = cad.isGenerating
    ? `Creating model${cad.polledJob?.progress_pct != null ? ` · ${cad.polledJob.progress_pct}%` : ''}`
    : entryJobReady
      ? 'Model ready — open full studio to view or edit'
      : studioPhase === 'studio' && (engineLoading || !engineReady)
        ? 'Initializing 3D viewport…'
        : undefined;

  return (
    <div
      ref={pageRootRef}
      className="relative flex h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--dashboard-canvas,var(--bg-app,#111214))]"
      onDrop={handleFileDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {studioPhase === 'entry' ? (
        <StudioEntryScreen
          onOpenStudio={openFullStudio}
          onImportGlb={handleEntryImportGlb}
          onSpawnStock={handleEntrySpawnStock}
          onCancelJob={handleCancelCadJob}
          onLoadBimExample={handleLoadBimExample}
          onComposerHost={onComposerHost}
          onMessagesHost={onMessagesHost}
          generating={cad.isGenerating}
          jobReady={entryJobReady}
          progressPct={cad.polledJob?.progress_pct ?? cad.polledJob?.progress ?? 0}
          activeProgressPct={cad.polledJob?.progress_pct ?? cad.polledJob?.progress ?? 0}
          activeJobId={cad.activeJobId}
          statusLabel={entryStatusLabel}
          error={cad.error}
          mode={entryMode}
        />
      ) : (
        <Suspense
          fallback={
            <StudioEntryScreen
              onOpenStudio={openFullStudio}
              mode="loading-studio"
              statusLabel="Loading Design Studio…"
            />
          }
        >
          <CadStudioShell
        engineContainerRef={containerRef}
        onEngineContainerMount={() => setEngineHostReady(true)}
        cad={cad}
        entities={entities}
        entityCount={entityCount}
        selectedId={selectedEntityId}
        onSelectEntity={handleSelectEntity}
        onClear={onClear}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onAddCube={handleAddCube}
        onDeleteSelected={handleDeleteSelected}
        onDeployJob={(job) => void deployJobToScene(job)}
        onDownloadLatestGlb={handleDownloadLatestGlb}
        sceneName={sceneName}
        onSceneNameChange={setSceneName}
        onSaveScene={() => void handleSaveScene()}
        onLoadScene={(id) => void handleLoadScene(id)}
        savedScenes={savedScenes}
        sceneBusy={sceneBusy}
        computeHealth={computeHealth}
        currentSceneId={currentSceneId}
        customAssets={customAssets}
        genConfig={genConfig}
        onUpdateGenConfig={handleUpdateGenConfig}
        sceneConfig={sceneConfig}
        onUpdateSceneConfig={(c) => setSceneConfig((prev) => ({ ...prev, ...c }))}
        onSpawnModel={handleSpawnModel}
        onSpawnProcedural={handleSpawnProcedural}
        onAddCustomAsset={handleAddCustomAsset}
        onRemoveCustomAsset={handleRemoveCustomAsset}
        onRefreshUserAssets={refreshUserAssets}
        onImportGlb={handleImportGlbFile}
        onExportSceneJson={handleExportSceneJson}
        onEntityRename={(id, name) => void handleEntityRename(id, name)}
        onEntityTransform={(id, patch) => void handleEntityTransform(id, patch)}
        onSetBackground={(hex) => { if (isAgentSamEngine(engineRef.current)) engineRef.current.setBackground(hex); }}
        onSetFog={(v) => { if (isAgentSamEngine(engineRef.current)) engineRef.current.setFog(v); }}
        onSetGridVisible={(v) => { if (isAgentSamEngine(engineRef.current)) engineRef.current.setGridVisible(v); }}
        onSnapView={(face) => { if (isAgentSamEngine(engineRef.current)) engineRef.current.snapViewTo(face as 'top' | 'front' | 'right' | 'left' | 'back' | 'bottom'); }}
        onToggleOrtho={(ortho) => { if (isAgentSamEngine(engineRef.current)) engineRef.current.toggleOrtho(ortho); }}
        onEntityPositionChange={(id, pos) => { if (isAgentSamEngine(engineRef.current)) engineRef.current.patchEntityPosition(id, pos); }}
        onEntityScaleChange={(id, scale) => { if (isAgentSamEngine(engineRef.current)) engineRef.current.patchEntityScale(id, scale); }}
        onUpdateSceneEnvironment={(patch) => {
          if (isAgentSamEngine(engineRef.current)) engineRef.current.updateSceneEnvironment(patch);
        }}
        onApplyEntityMaterial={(id, patch) => {
          if (isAgentSamEngine(engineRef.current)) engineRef.current.applyEntityMaterial(id, patch);
        }}
        onPatchEntityDimensions={(id, dims) => {
          if (isAgentSamEngine(engineRef.current)) engineRef.current.patchEntityDimensions(id, dims);
        }}
        onRunBlenderJob={async (prompt) => {
          await cad.runBlenderScriptGenerate(prompt);
        }}
        getEntityMeshStats={(id) =>
          isAgentSamEngine(engineRef.current)
            ? engineRef.current.getEntityMeshStats(id)
            : { verts: 0, edges: 0, faces: 0, tris: 0 }
        }
        getEntitySpatialInfo={getEntitySpatialInfo}
        onSnapEntityToGrid={handleSnapEntityToGrid}
        onSetEntityGroundY={handleSetEntityGroundY}
        spatialOverlaysEnabled={spatialOverlaysEnabled}
        onSpatialOverlaysChange={handleSpatialOverlaysChange}
        onFrameAll={handleFrameAll}
        onViewportZoom={handleViewportZoom}
        onViewportPanMode={handleViewportPanMode}
        onViewportReset={handleViewportReset}
        onViewToolChange={(tool) => {
          if (isAgentSamEngine(engineRef.current)) {
            engineRef.current.setViewTool(tool);
          }
        }}
        engineReady={engineReady}
        engineLoading={engineLoading}
        viewCubeOrientation={viewCubeOrientation}
        linkedCadJobId={linkedCadJobId}
        linkedGlbR2Key={linkedGlbR2Key}
          />
        </Suspense>
      )}
    </div>
  );
};
