import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createBlueprint,
  executeCadJob,
  fetchBlueprints,
  fetchCadJobs,
  cancelCadJob,
  generateMeshy,
  meshyRigging,
  meshyRetexture,
  meshyPrintMultiColor,
  meshyCreateTask,
  meshyCreateAnimation,
  meshyCreateImageTo3d,
  meshyCreateRemesh,
  meshyCreateConvert,
  meshyCreateResize,
  meshyUvUnwrap,
  generateOpenScad,
  generateBlenderScript,
  generateFreecadScript,
  meshyTextTo3dPreview,
  meshyTextTo3dRefine,
  patchBlueprint,
  type BlueprintRow,
  type CadJobRow,
} from '../api';
import type { MeshyImageTo3dBody, MeshyRetextureBody, MeshyPrintMultiColorBody } from '../api';
import { useCadJobPoll } from './useCadJobPoll';

export type UseDesignStudioCadOpts = {
  sessionId?: string | null;
  sceneId?: string | null;
  onJobDone?: (job: CadJobRow) => void;
  onBlueprintsChange?: () => void;
  /** Sync visible Meshy prompt fields when a generation starts (text mode). */
  onPromptUsed?: (prompt: string) => void;
};

export function useDesignStudioCad(opts: UseDesignStudioCadOpts = {}) {
  const [blueprints, setBlueprints] = useState<BlueprintRow[]>([]);
  const [jobs, setJobs] = useState<CadJobRow[]>([]);
  const [activeBlueprintId, setActiveBlueprintId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meshyStub, setMeshyStub] = useState(false);
  const sseRef = useRef<EventSource | null>(null);
  const activeJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeJobIdRef.current = activeJobId;
  }, [activeJobId]);

  const activeBlueprint = blueprints.find((b) => String(b.id) === activeBlueprintId) ?? null;
  const activeJob = jobs.find((j) => j.id === activeJobId) ?? null;

  const refreshBlueprints = useCallback(async () => {
    try {
      const rows = await fetchBlueprints(50);
      setBlueprints(rows);
    } catch (e) {
      console.warn('[useDesignStudioCad] blueprints', e);
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const rows = await fetchCadJobs(50);
      setJobs(rows);
    } catch (e) {
      console.warn('[useDesignStudioCad] jobs', e);
    }
  }, []);

  useEffect(() => {
    void refreshBlueprints();
    void refreshJobs();
  }, [refreshBlueprints, refreshJobs]);

  const scopeBody = useCallback(
    () => ({
      session_id: opts.sessionId || undefined,
      scene_snapshot_id: opts.sceneId || undefined,
      blueprint_id: activeBlueprintId || undefined,
    }),
    [opts.sessionId, opts.sceneId, activeBlueprintId],
  );

  const handleJobDone = useCallback(
    (job: CadJobRow) => {
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === job.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...job };
          return next;
        }
        return [job, ...prev];
      });
      void refreshJobs();
      opts.onJobDone?.(job);
    },
    [opts, refreshJobs],
  );

  const { job: polledJob, polling } = useCadJobPoll(activeJobId, {
    enabled: !!activeJobId,
    engine: activeJob?.engine,
    realtime: true,
    onDone: handleJobDone,
    onFailed: handleJobDone,
  });

  const isGenerating =
    busy ||
    polling ||
    (polledJob != null &&
      !['done', 'complete', 'failed', 'script_ready', 'cancelled'].includes(
        String(polledJob.status || '').toLowerCase(),
      ));

  const createNewBlueprint = useCallback(
    async (title: string, originalPrompt?: string) => {
      setBusy(true);
      setError(null);
      try {
        const bp = await createBlueprint({
          title,
          original_prompt: originalPrompt || title,
        });
        await refreshBlueprints();
        setActiveBlueprintId(String(bp.id));
        opts.onBlueprintsChange?.();
        return bp;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refreshBlueprints, opts],
  );

  const runBlenderScriptGenerate = useCallback(
    async (promptOverride?: string) => {
      const prompt = promptOverride?.trim() || '';
      if (!prompt) {
        setError('Enter a prompt for Blender script generation');
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await generateBlenderScript({ prompt, ...scopeBody() });
        setActiveJobId(result.job_id);
        await refreshJobs();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody, refreshJobs],
  );

  const runFreecadScriptGenerate = useCallback(
    async (promptOverride?: string) => {
      const prompt = promptOverride?.trim() || '';
      if (!prompt) {
        setError('Enter a prompt for FreeCAD script generation');
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await generateFreecadScript({ prompt, ...scopeBody() });
        setActiveJobId(result.job_id);
        await refreshJobs();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody, refreshJobs],
  );

  const runOpenScadGenerate = useCallback(
    async (promptOverride?: string) => {
      const prompt =
        promptOverride?.trim() ||
        activeBlueprint?.original_prompt?.trim() ||
        activeBlueprint?.title?.trim() ||
        '';
      if (!prompt) {
        setError('Enter a prompt or select a blueprint');
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await generateOpenScad({ prompt, ...scopeBody() });
        setActiveJobId(result.job_id);
        await refreshJobs();
        if (activeBlueprintId) {
          await patchBlueprint(activeBlueprintId, { status: 'generated' }).catch(() => {});
          await refreshBlueprints();
        }
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [activeBlueprint, activeBlueprintId, scopeBody, refreshBlueprints, refreshJobs],
  );

  const runExecuteJob = useCallback(
    async (jobId?: string) => {
      const id = jobId || activeJobId;
      if (!id) return null;
      setBusy(true);
      setError(null);
      try {
        const result = await executeCadJob(id, scopeBody());
        setActiveJobId(id);
        await refreshJobs();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [activeJobId, scopeBody, refreshJobs],
  );

  const saveBlueprintScript = useCallback(
    async (script: string) => {
      if (!activeBlueprintId) return null;
      setBusy(true);
      setError(null);
      try {
        await patchBlueprint(activeBlueprintId, {
          cad_script: script,
          cad_engine: 'openscad',
        });
        await refreshBlueprints();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [activeBlueprintId, refreshBlueprints],
  );

  const runMeshyGenerate = useCallback(
    async (prompt: string, extra?: Record<string, unknown>) => {
      const mode = extra?.mode === 'image' ? 'image' : 'text';
      if (mode === 'text' && !prompt.trim()) {
        setError('Meshy prompt required');
        return null;
      }
      if (mode === 'image' && !String(extra?.image_url || '').trim()) {
        setError('image_url required for image mode');
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const usedPrompt =
          mode === 'text' ? prompt.trim() : prompt.trim() || 'image-to-3d';
        const result = await generateMeshy({
          prompt: usedPrompt,
          mode,
          ...scopeBody(),
          ...extra,
        });
        setActiveJobId(result.job_id);
        if (result.status === 'stub') setMeshyStub(true);
        if (mode === 'text' && usedPrompt) opts.onPromptUsed?.(usedPrompt);
        await refreshJobs();
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.toLowerCase().includes('stub') || msg.includes('MESHY')) setMeshyStub(true);
        setError(msg);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody, refreshJobs, opts],
  );

  const runMeshyRigging = useCallback(
    async (body: {
      input_task_id?: string;
      model_task_id?: string;
      model_url?: string;
      height_meters?: number;
      texture_image_url?: string;
    }) => {
      const inputTaskId = String(body.input_task_id || body.model_task_id || '').trim();
      if (!inputTaskId && !String(body.model_url || '').trim()) {
        setError('input_task_id or model_url required');
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await meshyRigging({ ...body, ...scopeBody() });
        setActiveJobId(result.job_id);
        await refreshJobs();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody, refreshJobs],
  );

  const runMeshyRetexture = useCallback(
    async (body: MeshyRetextureBody) => {
      const inputTaskId = String(body.input_task_id || body.model_task_id || '').trim();
      const modelUrl = String(body.model_url || '').trim();
      const textStyle = String(
        body.text_style_prompt || body.texture_prompt || body.prompt || '',
      ).trim();
      const imageStyle = String(body.image_style_url || '').trim();
      if (!inputTaskId && !modelUrl) {
        setError('input_task_id or model_url required');
        return null;
      }
      if (!textStyle && !imageStyle) {
        setError('text_style_prompt or image_style_url required');
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await meshyRetexture({ ...body, ...scopeBody() });
        setActiveJobId(result.job_id);
        await refreshJobs();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody, refreshJobs],
  );

  const runMeshyPrintMultiColor = useCallback(
    async (body: MeshyPrintMultiColorBody) => {
      const inputTaskId = String(body.input_task_id || body.model_task_id || '').trim();
      const modelUrl = String(body.model_url || '').trim();
      if (!inputTaskId && !modelUrl) {
        setError('input_task_id or model_url required');
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await meshyPrintMultiColor({ ...body, ...scopeBody() });
        setActiveJobId(result.job_id);
        await refreshJobs();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody, refreshJobs],
  );

  const runMeshyImageTo3d = useCallback(
    async (body: MeshyImageTo3dBody) => {
      const imageUrl = String(body.image_url || '').trim();
      const inputTaskId = String(body.input_task_id || '').trim();
      if (!imageUrl && !inputTaskId) {
        setError('image_url or input_task_id required');
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await meshyCreateImageTo3d({ ...body, ...scopeBody() });
        setActiveJobId(result.job_id);
        await refreshJobs();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody, refreshJobs],
  );

  const runMeshyAnimation = useCallback(
    async (body: {
      rig_task_id: string;
      action_id: number;
      post_process?: {
        operation_type: 'change_fps' | 'fbx2usdz' | 'extract_armature';
        fps?: number;
      };
    }) => {
      const rigTaskId = String(body.rig_task_id || '').trim();
      const actionId = Number(body.action_id);
      if (!rigTaskId || !Number.isFinite(actionId)) {
        setError('rig_task_id and action_id required');
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await meshyCreateAnimation({ ...body, ...scopeBody() });
        setActiveJobId(result.job_id);
        await refreshJobs();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody, refreshJobs],
  );

  const runMeshyRemesh = useCallback(
    async (body: Parameters<typeof meshyCreateRemesh>[0]) => {
      setBusy(true);
      setError(null);
      try {
        const result = await meshyCreateRemesh({ ...body, ...scopeBody() });
        setActiveJobId(result.job_id);
        await refreshJobs();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody, refreshJobs],
  );

  const runMeshyConvert = useCallback(
    async (body: Parameters<typeof meshyCreateConvert>[0]) => {
      setBusy(true);
      setError(null);
      try {
        const result = await meshyCreateConvert({ ...body, ...scopeBody() });
        setActiveJobId(result.job_id);
        await refreshJobs();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody, refreshJobs],
  );

  const runMeshyResize = useCallback(
    async (body: Parameters<typeof meshyCreateResize>[0]) => {
      setBusy(true);
      setError(null);
      try {
        const result = await meshyCreateResize({ ...body, ...scopeBody() });
        setActiveJobId(result.job_id);
        await refreshJobs();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody, refreshJobs],
  );

  const runMeshyUvUnwrap = useCallback(
    async (body: Parameters<typeof meshyUvUnwrap>[0]) => {
      setBusy(true);
      setError(null);
      try {
        const result = await meshyUvUnwrap({ ...body, ...scopeBody() });
        setActiveJobId(result.job_id);
        await refreshJobs();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody, refreshJobs],
  );

  const runMeshyTask = useCallback(
    async (taskType: string, body: Record<string, unknown> = {}) => {
      if (!taskType.trim()) {
        setError('task_type required');
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await meshyCreateTask({
          task_type: taskType,
          ...scopeBody(),
          ...body,
        });
        setActiveJobId(result.job_id);
        if (result.status === 'stub') setMeshyStub(true);
        await refreshJobs();
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.toLowerCase().includes('stub') || msg.includes('MESHY')) setMeshyStub(true);
        setError(msg);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody, refreshJobs],
  );

  const runMeshyPreview = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const result = await meshyTextTo3dPreview({ ...scopeBody(), ...body });
        if (result.stub) {
          setMeshyStub(true);
          setError(result.message || 'No Meshy API key configured. Add one in Settings → Keys.');
          return result;
        }
        if (!result.job_id) {
          setError('Meshy preview did not return a job id');
          return result;
        }
        setActiveJobId(result.job_id);
        const usedPrompt = String(body.prompt || '').trim();
        if (usedPrompt) opts.onPromptUsed?.(usedPrompt);
        await refreshJobs();
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.toLowerCase().includes('stub') || msg.includes('MESHY')) setMeshyStub(true);
        setError(msg);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody, refreshJobs, opts],
  );

  const runMeshyRefine = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const result = await meshyTextTo3dRefine({ ...scopeBody(), ...body } as {
          preview_task_id: string;
          enable_pbr?: boolean;
          texture_prompt?: string;
        });
        if ((result as { stub?: boolean }).stub) {
          setMeshyStub(true);
          setError('No Meshy API key configured. Add one in Settings → Keys.');
          return result;
        }
        if (!result.job_id) {
          setError('Meshy refine did not return a job id');
          return result;
        }
        setActiveJobId(result.job_id);
        await refreshJobs();
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.toLowerCase().includes('stub') || msg.includes('MESHY')) setMeshyStub(true);
        setError(msg);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody, refreshJobs],
  );

  const subscribeRunEvents = useCallback(
    (runId: string, sessionId: string) => {
      sseRef.current?.close();
      const url = `/api/designstudio/runs/${encodeURIComponent(runId)}/events?session_id=${encodeURIComponent(sessionId)}`;
      const es = new EventSource(url, { withCredentials: true });
      sseRef.current = es;
      es.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data);
          const envelope = payload?.envelope ?? payload;
          if (envelope?.type === 'cad_glb_ready') {
            const evtRunId =
              typeof envelope.agent_run_id === 'string' ? envelope.agent_run_id.trim() : '';
            if (evtRunId && evtRunId !== runId) return;
            const jobId = envelope.job_id ? String(envelope.job_id) : null;
            const trackedJobId = activeJobIdRef.current;
            if (jobId && trackedJobId && jobId !== trackedJobId) return;
            const publicUrl = envelope.public_url || envelope.url;
            if (jobId) setActiveJobId(jobId);
            handleJobDone({
              id: jobId || `sse_${Date.now()}`,
              engine: envelope.engine || 'cad',
              status: 'done',
              public_url: publicUrl,
              result_url: publicUrl,
              r2_key: envelope.r2_key ?? null,
            });
          }
        } catch {
          /* ignore malformed SSE */
        }
      };
      es.onerror = () => {
        es.close();
        if (sseRef.current === es) sseRef.current = null;
      };
    },
    [handleJobDone],
  );

  const cancelActiveJob = useCallback(
    async (jobId?: string) => {
      const id = jobId || activeJobId;
      if (!id) return null;
      setError(null);
      try {
        const result = await cancelCadJob(id);
        setJobs((prev) =>
          prev.map((j) => (j.id === id ? { ...j, status: 'cancelled' } : j)),
        );
        if (activeJobId === id) setActiveJobId(null);
        await refreshJobs();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
    [activeJobId, refreshJobs],
  );

  useEffect(() => () => sseRef.current?.close(), []);

  return {
    blueprints,
    jobs,
    activeBlueprint,
    activeBlueprintId,
    setActiveBlueprintId,
    activeJob,
    activeJobId,
    setActiveJobId,
    polledJob,
    busy,
    error,
    meshyStub,
    isGenerating,
    refreshBlueprints,
    refreshJobs,
    createNewBlueprint,
    runOpenScadGenerate,
    runBlenderScriptGenerate,
    runFreecadScriptGenerate,
    runExecuteJob,
    saveBlueprintScript,
    runMeshyGenerate,
    runMeshyRigging,
    runMeshyRetexture,
    runMeshyPrintMultiColor,
    runMeshyImageTo3d,
    runMeshyAnimation,
    runMeshyRemesh,
    runMeshyConvert,
    runMeshyResize,
    runMeshyUvUnwrap,
    runMeshyTask,
    runMeshyPreview,
    runMeshyRefine,
    subscribeRunEvents,
    cancelActiveJob,
  };
}
