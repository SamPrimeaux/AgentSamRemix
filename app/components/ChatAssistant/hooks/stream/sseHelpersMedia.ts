/**
 * Image/video/plan helpers for Agent Sam SSE consume.
 */
import type React from 'react';
import type {
  Message,
  ExecutionPlanState,
  ExecutionPlanTask,
  ImageGenerationState,
  VideoGenerationState,
  AgentGeneratedFile,
} from '../../types';

/** Prefer extension from R2/object URL; fall back to png (platform default). */
export function imageExtFromUrl(url: string): string {
  const path = String(url || '').split('?')[0];
  const m = path.match(/\.(png|jpe?g|webp|gif|svg)$/i);
  if (!m) return 'png';
  const ext = m[1].toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

/** Stamp generated image URLs onto the assistant bubble for Scratchpad. */
export function agentFilesFromImageSse(data: unknown): AgentGeneratedFile[] {
  if (!data || typeof data !== 'object') return [];
  const o = data as Record<string, unknown>;
  const out: AgentGeneratedFile[] = [];
  const push = (url: unknown, idHint: string, label?: string) => {
    const u = typeof url === 'string' ? url.trim() : '';
    if (!u || !(/^(https?:|data:|\/)/i.test(u))) return;
    if (out.some((f) => f.r2Url === u)) return;
    const id = String(idHint || `img_${out.length + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 28);
    const ext = imageExtFromUrl(u);
    const filename = label || `generated-${id || out.length + 1}.${ext}`;
    out.push({
      filename,
      r2Url: u,
      workspacePath: `images/${filename}`,
      kind: 'image',
    });
  };

  const genId = typeof o.generation_id === 'string' ? o.generation_id.trim() : '';
  const varIndex =
    typeof o.variation_index === 'number' && Number.isFinite(o.variation_index)
      ? Math.floor(o.variation_index) + 1
      : null;

  if (Array.isArray(o.variations)) {
    o.variations.forEach((v, i) => {
      if (!v || typeof v !== 'object') return;
      const row = v as Record<string, unknown>;
      const id = typeof row.generation_id === 'string' ? row.generation_id : `${genId || 'var'}_${i + 1}`;
      const u = row.image_url || row.preview_url;
      const ext = typeof u === 'string' ? imageExtFromUrl(u) : 'png';
      push(u, id, `variation-${i + 1}.${ext}`);
    });
  }
  if (Array.isArray(o.preview_urls)) {
    o.preview_urls.forEach((u, i) => {
      const ext = typeof u === 'string' ? imageExtFromUrl(u) : 'png';
      push(u, `${genId || 'preview'}_${i + 1}`, `variation-${i + 1}.${ext}`);
    });
  }
  const primaryUrl = o.image_url || o.preview_url;
  const primaryExt = typeof primaryUrl === 'string' ? imageExtFromUrl(primaryUrl) : 'png';
  push(
    primaryUrl,
    genId || `frame_${varIndex || out.length + 1}`,
    varIndex != null ? `variation-${varIndex}.${primaryExt}` : undefined,
  );
  return out;
}

export function appendAgentFilesToAssistantTail(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  files: AgentGeneratedFile[],
) {
  if (!files.length) return;
  setMessages((prev) => {
    const next = [...prev];
    const idx = next.length - 1;
    if (idx < 0 || next[idx].role !== 'assistant') return prev;
    const existing = next[idx].agentFiles ?? [];
    const seen = new Set(
      existing.map((x) => x.r2Url || x.workspacePath || x.filename).filter(Boolean) as string[],
    );
    const fresh = files.filter((f) => {
      const key = f.r2Url || f.workspacePath || f.filename;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!fresh.length) return prev;
    next[idx] = { ...next[idx], agentFiles: [...existing, ...fresh] };
    return next;
  });
}

export function mapTaskCompleteStatus(status: string | undefined): ExecutionPlanTask['status'] {
  if (status === 'done') return 'done';
  if (status === 'skipped') return 'skipped';
  if (status === 'blocked') return 'blocked';
  if (status === 'in_progress') return 'running';
  return 'failed';
}

export function planStatusFromSummary(status: string | undefined, failed: number): ExecutionPlanState['status'] {
  const s = String(status || '').toLowerCase();
  if (s === 'complete' || s === 'completed' || s === 'ok') return failed > 0 ? 'partial' : 'complete';
  if (s === 'partial') return 'partial';
  if (s === 'failed') return 'failed';
  return failed > 0 ? 'partial' : 'complete';
}

export function mergeImageGenerationState(
  prev: ImageGenerationState | null | undefined,
  patch: Partial<ImageGenerationState>,
  eventType: string,
): ImageGenerationState {
  const generationId = patch.generationId || prev?.generationId || '';
  const base: ImageGenerationState = prev ?? {
    generationId,
    phase: 'initializing',
    progress: 0,
    message: 'Creating image…',
    previewFrames: [],
    activeFrameIndex: 0,
    failed: false,
  };

  let previewFrames = base.previewFrames;
  if (patch.previewFrames?.length) {
    const next = [...base.previewFrames];
    for (const frame of patch.previewFrames) {
      const idx = next.findIndex(
        (f) =>
          f.frameIndex === frame.frameIndex ||
          (frame.previewUrl && f.previewUrl && f.previewUrl === frame.previewUrl),
      );
      if (idx >= 0) {
        next[idx] = {
          ...next[idx],
          ...frame,
          previewUrl: frame.previewUrl || next[idx].previewUrl,
          generationId: frame.generationId || next[idx].generationId,
          phase: frame.phase ?? next[idx].phase,
          progress: frame.progress ?? next[idx].progress,
          message: frame.message ?? next[idx].message,
          failed: frame.failed ?? next[idx].failed,
        };
      } else next.push(frame);
    }
    next.sort((a, b) => a.frameIndex - b.frameIndex);
    previewFrames = next;
  }

  // Never shrink reserved multi-variation slots once started.
  const variationCount = Math.max(
    patch.variationCount ?? 0,
    base.variationCount ?? 0,
    previewFrames.length > 1 ? previewFrames.length : 0,
  );
  if (variationCount > 1 && previewFrames.length < variationCount) {
    const byIndex = new Map(previewFrames.map((f) => [f.frameIndex, f]));
    previewFrames = Array.from({ length: variationCount }, (_, i) => {
      const existing = byIndex.get(i);
      if (existing) return existing;
      return {
        frameIndex: i,
        phase: 'initializing' as const,
        progress: 0,
        message: `Variation ${i + 1} of ${variationCount}…`,
      };
    });
  }

  const activeFrameIndex =
    patch.activeFrameIndex != null ? patch.activeFrameIndex : base.activeFrameIndex;

  // Batch is complete only when every reserved slot has a URL (or failed).
  let phase = patch.phase ?? base.phase;
  let progress = patch.progress ?? base.progress;
  let message = patch.message !== undefined ? patch.message : base.message;
  let failed = patch.failed ?? base.failed;
  if (variationCount > 1) {
    const doneSlots = previewFrames.filter((f) => f.previewUrl || f.failed).length;
    const allDone = doneSlots >= variationCount;
    const anyOk = previewFrames.some((f) => Boolean(f.previewUrl) && !f.failed);
    if (!allDone) {
      failed = false;
      phase =
        previewFrames.some((f) => f.phase === 'refining' || f.phase === 'generating')
          ? 'generating'
          : 'initializing';
      progress = Math.round(
        previewFrames.reduce((sum, f) => sum + (f.progress ?? 0), 0) / variationCount,
      );
      const active =
        previewFrames.find((f) => f.frameIndex === activeFrameIndex) ||
        previewFrames.find((f) => !f.previewUrl && !f.failed);
      message = active?.message || `Creating ${variationCount} images… (${doneSlots}/${variationCount})`;
    } else if (anyOk) {
      failed = false;
      phase = 'completed';
      progress = 100;
      message = '';
    } else {
      failed = true;
      phase = 'failed';
      progress = 0;
      message =
        previewFrames.find((f) => f.failed)?.message ||
        patch.message ||
        base.message ||
        'Image generation failed';
    }
  }

  return {
    ...base,
    ...patch,
    generationId,
    previewFrames,
    activeFrameIndex,
    variationCount: variationCount > 1 ? variationCount : patch.variationCount ?? base.variationCount,
    phase,
    progress,
    failed,
    imageUrl: patch.imageUrl ?? base.imageUrl,
    message,
  };
}

/** URLs already shown by AgentImageGenerationCard — strip duplicate markdown/links from model text. */
export function imageGenerationDisplayUrls(ig: ImageGenerationState | null | undefined): string[] {
  if (!ig) return [];
  const out: string[] = [];
  for (const u of [
    ig.committedUrl,
    ig.imageUrl,
    ig.previewUrl,
    ...ig.previewFrames.map((f) => f.previewUrl),
  ]) {
    const s = typeof u === 'string' ? u.trim() : '';
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function stripRedundantImageRefs(content: string, urls: string[]): string {
  if (!content || !urls.length) return content;
  let out = content;
  for (const url of urls) {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`!\\[[^\\]]*\\]\\(\\s*${escaped}\\s*\\)`, 'gi'), '');
    out = out.replace(new RegExp(`\\[[^\\]]*\\]\\(\\s*${escaped}\\s*\\)`, 'gi'), '');
    out = out.replace(new RegExp(escaped, 'gi'), '');
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function parseVeoToolPayload(raw: string | null | undefined): {
  jobId: string | null;
  destination: 'local' | 'stream';
  status: string | null;
  model: string | null;
} {
  const empty = { jobId: null as string | null, destination: 'local' as const, status: null as string | null, model: null as string | null };
  if (!raw?.trim()) return empty;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const jobId =
      typeof parsed.job_id === 'string'
        ? parsed.job_id.trim()
        : typeof parsed.jobId === 'string'
          ? parsed.jobId.trim()
          : null;
    const destination =
      String(parsed.destination || 'local').toLowerCase() === 'stream' ? 'stream' : 'local';
    return {
      jobId,
      destination,
      status: typeof parsed.status === 'string' ? parsed.status : null,
      model: typeof parsed.model_used === 'string' ? parsed.model_used : null,
    };
  } catch {
    return empty;
  }
}

export function patchAssistantVideoGeneration(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  patch: Partial<VideoGenerationState> & { jobId: string },
) {
  setMessages((prev) => {
    const next = [...prev];
    const idx = next.length - 1;
    if (idx < 0 || next[idx].role !== 'assistant') return prev;
    const prevMsg = next[idx];
    let prompt = patch.prompt || prevMsg.videoGenerationState?.prompt;
    if (!prompt) {
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (next[i].role === 'user' && next[i].content?.trim()) {
          prompt = next[i].content.trim();
          break;
        }
      }
    }
    const base: VideoGenerationState = prevMsg.videoGenerationState ?? {
      jobId: patch.jobId,
      phase: 'queued',
      progress: 0,
      message: 'Queued…',
    };
    next[idx] = {
      ...prevMsg,
      videoGenerationState: {
        ...base,
        ...patch,
        prompt: prompt || base.prompt,
      },
    };
    return next;
  });
}

export function patchAssistantImageGeneration(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  assistantContent: string,
  patch: Partial<ImageGenerationState>,
  eventType: string,
  scratchpadFiles: AgentGeneratedFile[] = [],
) {
  setMessages((prev) => {
    const next = [...prev];
    const idx = next.length - 1;
    if (idx < 0 || next[idx].role !== 'assistant') return prev;
    const prevMsg = next[idx];
    const merged = mergeImageGenerationState(prevMsg.imageGenerationState, patch, eventType);
    // Prefer prompt from prior user turn when SSE didn't include one.
    if (!merged.prompt) {
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (next[i].role === 'user' && next[i].content?.trim()) {
          merged.prompt = next[i].content.trim();
          break;
        }
      }
    }
    // Card owns the image. Keep any prose already streamed; do not replace the bubble
    // with markdown that later text deltas will overwrite / fight.
    let content = stripRedundantImageRefs(
      String(prevMsg.content || assistantContent || ''),
      imageGenerationDisplayUrls(merged),
    );
    if (eventType === 'image_generation_complete' && !content.trim()) {
      // Persist a markdown image only when there is no other assistant text yet
      // (reload/fallback). Live UI still prefers AgentImageGenerationCard.
      const urls = imageGenerationDisplayUrls(merged);
      if (urls.length) {
        content = urls
          .map((url, i) => {
            const alt = ((merged.prompt || 'Generated image').replace(/\s+/g, ' ').trim().slice(0, 80) ||
              'Generated image') + (urls.length > 1 ? ` (${i + 1})` : '');
            return `![${alt}](${url})`;
          })
          .join('\n');
      }
    }

    let agentFiles = prevMsg.agentFiles ?? [];
    if (scratchpadFiles.length) {
      const seen = new Set(
        agentFiles.map((x) => x.r2Url || x.workspacePath || x.filename).filter(Boolean) as string[],
      );
      const fresh = scratchpadFiles.filter((f) => {
        const key = f.r2Url || f.workspacePath || f.filename;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (fresh.length) agentFiles = [...agentFiles, ...fresh];
    }
    // Also derive scratchpad entries from accumulated frames (belt-and-suspenders).
    if (merged.previewFrames?.length) {
      const fromFrames: AgentGeneratedFile[] = merged.previewFrames
        .filter((f) => Boolean(f.previewUrl))
        .map((f) => {
          const url = String(f.previewUrl || '');
          const ext = imageExtFromUrl(url);
          const filename = `variation-${f.frameIndex + 1}.${ext}`;
          return {
            filename,
            r2Url: f.previewUrl,
            workspacePath: `images/${filename}`,
            kind: 'image' as const,
          };
        });
      const seen = new Set(
        agentFiles.map((x) => x.r2Url || x.workspacePath || x.filename).filter(Boolean) as string[],
      );
      const fresh = fromFrames.filter((f) => {
        const key = f.r2Url || f.workspacePath || f.filename;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (fresh.length) agentFiles = [...agentFiles, ...fresh];
    }

    next[idx] = {
      ...prevMsg,
      content,
      imageGenerationState: merged,
      ...(agentFiles.length ? { agentFiles } : {}),
    };
    return next;
  });
}
