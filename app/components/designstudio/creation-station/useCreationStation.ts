import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMeshyAnimationLibrary, fetchMeshyBalance } from '../api';
import type { useDesignStudioCad } from '../hooks/useDesignStudioCad';
import {
  DEFAULT_MESHY_SETTINGS,
  buildMeshyPreviewBody,
  buildMeshyRefineBody,
  buildCurl,
  estimatePreviewCost,
  estimateRefineCost,
  type MeshyPhase,
  type MeshySettings,
} from './meshyTypes';
import { appendStudioTerminalOutput, openStudioTerminal } from '../studioTerminalOutput';

import type { MeshyRailTool } from './meshyToolkitTypes';
import { readStoredMeshyRail } from './meshyToolkitTypes';

export type CreationTool = MeshyRailTool;

export type LogLine = { ts: number; level: 'info' | 'warn' | 'error' | 'ok'; text: string };

type CadHook = ReturnType<typeof useDesignStudioCad>;

export function useCreationStation(cad: CadHook) {
  const [activeTool, setActiveTool] = useState<CreationTool>(readStoredMeshyRail);
  const [panelOpen, setPanelOpen] = useState(true);
  const [apiOpen, setApiOpen] = useState(true);
  const [meshyPhase, setMeshyPhase] = useState<MeshyPhase>('preview');
  const [settings, setSettings] = useState<MeshySettings>(DEFAULT_MESHY_SETTINGS);
  const [lastRequest, setLastRequest] = useState('');
  const [lastResponse, setLastResponse] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [meshyStub, setMeshyStub] = useState(cad.meshyStub);

  // image-to-3d
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);

  // animate / rigging
  const [rigTaskId, setRigTaskId] = useState('');
  const [rigCompletedTaskId, setRigCompletedTaskId] = useState('');
  const [animationActionId, setAnimationActionId] = useState<number | null>(null);
  const [animationClips, setAnimationClips] = useState<{ action_id: number; name: string }[]>([]);

  // retexture / remesh / print
  const [sourceTaskId, setSourceTaskId] = useState('');
  const [texturePrompt, setTexturePrompt] = useState('');
  const [imageGenPrompt, setImageGenPrompt] = useState('');

  const appendLog = useCallback(
    (text: string, level: LogLine['level'] = 'info', opts?: { open?: boolean }) => {
      appendStudioTerminalOutput(text, level, { open: opts?.open, tab: 'output' });
    },
    [],
  );

  const refreshBalance = useCallback(async () => {
    try {
      const data = await fetchMeshyBalance();
      setMeshyStub(!!data.stub);
      setBalance(data.stub ? null : data.balance ?? null);
    } catch (e) {
      appendLog(e instanceof Error ? e.message : 'Balance fetch failed', 'warn');
    }
  }, [appendLog]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  const lastLoggedStatusRef = useRef<string>('');

  useEffect(() => {
    const job = cad.polledJob;
    if (!job) return;
    const key = `${job.id}:${job.status}:${job.progress_pct ?? ''}`;
    if (lastLoggedStatusRef.current === key) return;
    lastLoggedStatusRef.current = key;
    const pct = job.progress_pct != null ? ` ${job.progress_pct}%` : '';
    appendLog(`Job ${job.id} → ${job.status}${pct}`, job.status === 'failed' ? 'error' : 'info');
    if (job.status === 'done' && job.public_url) {
      appendLog('Model ready in viewport', 'ok');
    }
    if (job.error) appendLog(String(job.error), 'error');
  }, [cad.polledJob, appendLog]);

  useEffect(() => {
    if (cad.error) appendLog(cad.error, 'error');
  }, [cad.error, appendLog]);

  useEffect(() => {
    if (activeTool !== 'animate') return;
    void fetchMeshyAnimationLibrary()
      .then((data) => {
        const raw = (data as { animations?: unknown }).animations ?? data;
        const rows = Array.isArray(raw) ? raw : [];
        setAnimationClips(
          rows
            .map((row) => {
              const r = row as { action_id?: number; name?: string };
              if (r.action_id == null || !r.name) return null;
              return { action_id: Number(r.action_id), name: String(r.name) };
            })
            .filter((r): r is { action_id: number; name: string } => r != null)
            .slice(0, 24),
        );
      })
      .catch(() => setAnimationClips([]));
  }, [activeTool]);

  const submitMeshyTask = useCallback(
    async (taskType: string, body: Record<string, unknown>, label: string) => {
      const path = '/api/cad/meshy/task';
      setLastRequest(buildCurl('POST', path, { task_type: taskType, ...body }));
      appendLog(`Starting ${label}…`, 'info', { open: true });
      try {
        const result = await cad.runMeshyTask(taskType, body);
        setLastResponse(JSON.stringify(result, null, 2));
        const ext = (result as { external_task_id?: string; task_id?: string })?.external_task_id
          || (result as { task_id?: string })?.task_id;
        if (ext) appendLog(`Meshy task ${ext}`, 'ok');
        void refreshBalance();
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLastResponse(JSON.stringify({ error: msg }, null, 2));
        appendLog(msg, 'error');
        return null;
      }
    },
    [cad, appendLog, refreshBalance],
  );

  const patchSettings = useCallback((patch: Partial<MeshySettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const previewCost = useMemo(() => estimatePreviewCost(settings), [settings]);
  const refineCost = estimateRefineCost();
  const ctaCost = meshyPhase === 'preview' ? previewCost : refineCost;

  // ── text-to-3d ─────────────────────────────────────────────────────────────

  const runPreview = useCallback(async () => {
    const body = buildMeshyPreviewBody(settings);
    if (!body.prompt) {
      appendLog('Enter a prompt first', 'warn');
      return;
    }
    const path = '/api/cad/meshy/text-to-3d/preview';
    setLastRequest(buildCurl('POST', path, body));
    appendLog('Creating Meshy preview…', 'info', { open: true });
    try {
      const result = await cad.runMeshyPreview(body);
      const resJson = JSON.stringify(result, null, 2);
      setLastResponse(resJson);
      if (result.stub) {
        setMeshyStub(true);
        appendLog(result.message || 'Meshy not configured — add key in Settings → Keys', 'error');
        return;
      }
      if (result.task_id) {
        patchSettings({ preview_task_id: result.task_id });
        appendLog(`Preview task ${result.task_id}`, 'ok');
      }
      void refreshBalance();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastResponse(JSON.stringify({ error: msg }, null, 2));
      appendLog(msg, 'error');
    }
  }, [settings, cad, appendLog, patchSettings, refreshBalance]);

  const runRefine = useCallback(async () => {
    const body = buildMeshyRefineBody(settings);
    if (!body.preview_task_id) {
      appendLog('Preview task ID required — run Preview first', 'warn');
      return;
    }
    const path = '/api/cad/meshy/text-to-3d/refine';
    setLastRequest(buildCurl('POST', path, body));
    appendLog('Starting Meshy refine…', 'info', { open: true });
    try {
      const result = await cad.runMeshyRefine(body);
      setLastResponse(JSON.stringify(result, null, 2));
      appendLog(`Refine job ${result.job_id}`, 'ok');
      void refreshBalance();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastResponse(JSON.stringify({ error: msg }, null, 2));
      appendLog(msg, 'error');
    }
  }, [settings, cad, appendLog, refreshBalance]);

  const runQuickGenerate = useCallback(async () => {
    const prompt = settings.prompt.trim();
    if (!prompt) {
      appendLog('Enter a prompt first', 'warn');
      return;
    }
    const body = {
      prompt,
      ...buildMeshyPreviewBody(settings),
    };
    const path = '/api/cad/meshy/generate';
    setLastRequest(buildCurl('POST', path, body));
    appendLog('Quick generate (preview + refine)…', 'info', { open: true });
    try {
      const result = await cad.runMeshyGenerate(prompt, body);
      setLastResponse(JSON.stringify(result, null, 2));
      void refreshBalance();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastResponse(JSON.stringify({ error: msg }, null, 2));
      appendLog(msg, 'error');
    }
  }, [settings, cad, appendLog, refreshBalance]);

  // ── image-to-3d ────────────────────────────────────────────────────────────

  const setImageFileWithPreview = useCallback((file: File | null) => {
    setImageFile(file);
    if (!file) { setImageDataUrl(null); return; }
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const runImageTo3D = useCallback(async () => {
    if (!imageDataUrl) {
      appendLog('Upload an image first', 'warn');
      return;
    }
    const path = '/api/cad/meshy/image-to-3d';
    const body = {
      image_url: imageDataUrl,
      topology: 'triangle' as const,
      should_texture: true,
      enable_pbr: true,
    };
    setLastRequest(buildCurl('POST', path, body));
    appendLog('Submitting image-to-3D…', 'info', { open: true });
    try {
      const result = await cad.runMeshyImageTo3d(body);
      setLastResponse(JSON.stringify(result, null, 2));
      appendLog(`Image-to-3D job ${result?.job_id ?? 'queued'}`, 'ok');
      void refreshBalance();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastResponse(JSON.stringify({ error: msg }, null, 2));
      appendLog(msg, 'error');
    }
  }, [imageDataUrl, cad, appendLog, refreshBalance]);

  // ── animate / rigging ──────────────────────────────────────────────────────

  const runRig = useCallback(async () => {
    const taskId = rigTaskId.trim();
    if (!taskId) {
      appendLog('Paste a source model task ID first', 'warn');
      return;
    }
    const path = '/api/cad/meshy/rigging';
    const body = { input_task_id: taskId, height_meters: 1.7 };
    setLastRequest(buildCurl('POST', path, body));
    appendLog('Submitting rigging job…', 'info', { open: true });
    try {
      const result = await cad.runMeshyRigging(body);
      setLastResponse(JSON.stringify(result, null, 2));
      const rigId = result?.task_id || (result as { external_task_id?: string })?.external_task_id;
      if (rigId) setRigCompletedTaskId(String(rigId));
      appendLog(`Rigging job ${result?.job_id ?? 'queued'}`, 'ok');
      void refreshBalance();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastResponse(JSON.stringify({ error: msg }, null, 2));
      appendLog(msg, 'error');
    }
  }, [rigTaskId, cad, appendLog, refreshBalance]);

  const runAnimateClip = useCallback(async () => {
    const rigId = rigCompletedTaskId.trim();
    if (!rigId || animationActionId == null) {
      appendLog('Complete rigging first and pick an animation clip', 'warn');
      return;
    }
    const path = '/api/cad/meshy/animations';
    const body = { rig_task_id: rigId, action_id: animationActionId };
    setLastRequest(buildCurl(path, body));
    appendLog('Submitting animation job…', 'info', { open: true });
    try {
      const result = await cad.runMeshyAnimation({
        rig_task_id: rigId,
        action_id: animationActionId,
      });
      setLastResponse(JSON.stringify(result, null, 2));
      appendLog(`Animation job ${result?.job_id ?? 'queued'}`, 'ok');
      void refreshBalance();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastResponse(JSON.stringify({ error: msg }, null, 2));
      appendLog(msg, 'error');
    }
  }, [rigCompletedTaskId, animationActionId, cad, appendLog, refreshBalance]);

  const runTextToTexture = useCallback(async () => {
    if (!texturePrompt.trim()) {
      appendLog('Enter a texture prompt', 'warn');
      return;
    }
    if (!sourceTaskId.trim()) {
      appendLog('Paste a source model task ID', 'warn');
      return;
    }
    const path = '/api/cad/meshy/retexture';
    const body = {
      input_task_id: sourceTaskId.trim(),
      text_style_prompt: texturePrompt.trim(),
    };
    setLastRequest(buildCurl('POST', path, body));
    appendLog('Starting retexture…', 'info', { open: true });
    try {
      const result = await cad.runMeshyRetexture(body);
      setLastResponse(JSON.stringify(result, null, 2));
      const ext = (result as { external_task_id?: string; task_id?: string })?.external_task_id
        ?? (result as { task_id?: string })?.task_id;
      if (ext) appendLog(`Meshy task ${ext}`, 'ok');
      await refreshBalance();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastResponse(JSON.stringify({ error: msg }, null, 2));
      appendLog(msg, 'error');
    }
  }, [sourceTaskId, texturePrompt, cad, appendLog, refreshBalance]);

  const runTexture = useCallback(async () => {
    if (!sourceTaskId.trim()) {
      appendLog('Paste a source model task ID', 'warn');
      return;
    }
    if (!texturePrompt.trim()) {
      appendLog('Enter a texture prompt or provide image_style_url', 'warn');
      return;
    }
    const path = '/api/cad/meshy/retexture';
    const body = {
      input_task_id: sourceTaskId.trim(),
      text_style_prompt: texturePrompt.trim(),
    };
    setLastRequest(buildCurl('POST', path, body));
    appendLog('Starting retexture…', 'info', { open: true });
    try {
      const result = await cad.runMeshyRetexture(body);
      setLastResponse(JSON.stringify(result, null, 2));
      const ext = (result as { external_task_id?: string; task_id?: string })?.external_task_id
        ?? (result as { task_id?: string })?.task_id;
      if (ext) appendLog(`Meshy task ${ext}`, 'ok');
      await refreshBalance();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastResponse(JSON.stringify({ error: msg }, null, 2));
      appendLog(msg, 'error');
    }
  }, [sourceTaskId, texturePrompt, cad, appendLog, refreshBalance]);

  const runPostProcess = useCallback(async () => {
    if (!sourceTaskId.trim()) {
      appendLog('Paste a source model task ID', 'warn');
      return;
    }
    const path = '/api/cad/meshy/remesh';
    const body = {
      input_task_id: sourceTaskId.trim(),
      target_formats: ['glb', 'fbx'],
      topology: 'triangle' as const,
      target_polycount: 30000,
    };
    setLastRequest(buildCurl('POST', path, body));
    appendLog('Starting Meshy remesh…', 'info', { open: true });
    try {
      const result = await cad.runMeshyRemesh(body);
      setLastResponse(JSON.stringify(result, null, 2));
      appendLog(`Remesh job ${result?.job_id ?? 'queued'}`, 'ok');
      void refreshBalance();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastResponse(JSON.stringify({ error: msg }, null, 2));
      appendLog(msg, 'error');
    }
  }, [sourceTaskId, cad, appendLog, refreshBalance]);

  const runPrintExport = useCallback(async () => {
    if (!sourceTaskId.trim()) {
      appendLog('Paste a source model task ID', 'warn');
      return;
    }
    const path = '/api/cad/meshy/print-multi-color';
    const body = { input_task_id: sourceTaskId.trim() };
    setLastRequest(buildCurl('POST', path, body));
    appendLog('Starting multi-color 3MF export (10 credits)…', 'info', { open: true });
    try {
      const result = await cad.runMeshyPrintMultiColor(body);
      setLastResponse(JSON.stringify(result, null, 2));
      const ext = (result as { external_task_id?: string; task_id?: string })?.external_task_id
        ?? (result as { task_id?: string })?.task_id;
      if (ext) appendLog(`Meshy task ${ext}`, 'ok');
      await refreshBalance();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastResponse(JSON.stringify({ error: msg }, null, 2));
      appendLog(msg, 'error');
    }
  }, [sourceTaskId, cad, appendLog, refreshBalance]);

  const runTextToImage = useCallback(async () => {
    if (!imageGenPrompt.trim()) {
      appendLog('Enter an image prompt', 'warn');
      return;
    }
    await submitMeshyTask('image', { prompt: imageGenPrompt.trim(), ai_model: 'nano-banana' }, 'text-to-image');
  }, [imageGenPrompt, submitMeshyTask]);

  // ── terminal ───────────────────────────────────────────────────────────────

  const openTerminal = useCallback((cmd?: string) => {
    openStudioTerminal({ tab: cmd ? 'terminal' : 'output' });
    if (cmd) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('iam-run-command', { detail: { cmd } }));
      });
    }
  }, []);

  return {
    activeTool,
    setActiveTool,
    panelOpen,
    setPanelOpen,
    apiOpen,
    setApiOpen,
    meshyPhase,
    setMeshyPhase,
    settings,
    patchSettings,
    appendLog,
    lastRequest,
    lastResponse,
    balance,
    meshyStub,
    previewCost,
    refineCost,
    ctaCost,
    runPreview,
    runRefine,
    runQuickGenerate,
    // image-to-3d
    imageFile,
    imageDataUrl,
    setImageFile: setImageFileWithPreview,
    runImageTo3D,
    sourceTaskId,
    setSourceTaskId,
    texturePrompt,
    setTexturePrompt,
    runTextToTexture,
    runTexture,
    runPostProcess,
    runPrintExport,
    imageGenPrompt,
    setImageGenPrompt,
    runTextToImage,
    rigTaskId,
    setRigTaskId,
    rigCompletedTaskId,
    setRigCompletedTaskId,
    animationActionId,
    setAnimationActionId,
    animationClips,
    runRig,
    runAnimateClip,
    openTerminal,
    refreshBalance,
    isGenerating: cad.isGenerating,
  };
}
