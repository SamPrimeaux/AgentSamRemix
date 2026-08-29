/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ChatGPT-shaped image turn: quiet placeholder while generating,
 * then a clean image (no card chrome). Click opens a lightbox to inspect.
 */

import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, CloudUpload, Download, ThumbsDown, ThumbsUp } from 'lucide-react';
import { IAM_AGENT_CHAT_COMPOSE } from '../agentChatConstants';
import type { ImageGenerationPreviewFrame, ImageGenerationState } from './ChatAssistant/types';
import { ProgressiveImagePreview } from './ProgressiveImagePreview';
import {
  saveImageDraft,
  discardImageDraft,
  rateImageDraft,
} from '../lib/imageDraftActions';
import '../styles/image-generation.css';

export type AgentImageGenerationCardProps = {
  state: ImageGenerationState;
  workspaceId?: string | null;
  /** Legacy prop — lightbox is owned here; kept for call-site compatibility. */
  onImagePreview?: (url: string) => void;
};

function titleFromPrompt(prompt?: string): string {
  const raw = String(prompt || '')
    .replace(/^create a visual for\s*/i, '')
    .replace(/^generate an image of\s*/i, '')
    .replace(/^edit this image:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return 'Generated image';
  const words = raw.split(' ').slice(0, 8).join(' ');
  return words.length > 56 ? `${words.slice(0, 53)}…` : words;
}

function shortId(generationId?: string): string {
  const id = String(generationId || '').replace(/^igen_/, '').replace(/^imgxb_/, '');
  return id ? id.slice(0, 8) : 'draft';
}

function sortedFrames(state: ImageGenerationState): ImageGenerationPreviewFrame[] {
  const count = Math.max(state.variationCount ?? 0, state.previewFrames?.length ?? 0);
  if (count > 1) {
    const byIndex = new Map((state.previewFrames || []).map((f) => [f.frameIndex, f]));
    return Array.from({ length: count }, (_, i) => {
      const existing = byIndex.get(i);
      if (existing) return existing;
      return {
        frameIndex: i,
        phase: 'initializing' as const,
        progress: 0,
        message: `Variation ${i + 1} of ${count}…`,
      };
    });
  }
  if (state.previewFrames?.length) {
    return [...state.previewFrames].sort((a, b) => a.frameIndex - b.frameIndex);
  }
  const url = state.previewUrl || state.imageUrl || state.committedUrl;
  if (!url) return [];
  return [{ frameIndex: 0, previewUrl: url, generationId: state.generationId, phase: state.phase, progress: state.progress }];
}

export function AgentImageGenerationCard({
  state,
  workspaceId,
}: AgentImageGenerationCardProps) {
  const titleId = useId();
  const pathId = useId();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxFocusUrl, setLightboxFocusUrl] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [committedUrl, setCommittedUrl] = useState<string | null>(state.committedUrl || null);
  const [userRating, setUserRating] = useState<1 | -1 | null>(state.userRating ?? null);

  const frames = useMemo(() => sortedFrames(state), [state]);
  const readyFrames = useMemo(
    () => frames.filter((f) => Boolean(f.previewUrl) && !f.failed),
    [frames],
  );
  const previewUrl =
    frames.find((f) => f.frameIndex === state.activeFrameIndex)?.previewUrl ||
    readyFrames[readyFrames.length - 1]?.previewUrl ||
    state.previewUrl ||
    state.imageUrl;

  const multi = frames.length > 1 || (state.variationCount ?? 0) > 1;
  const isComplete = state.phase === 'completed' && (Boolean(previewUrl) || readyFrames.length > 0);
  const isFailed = state.phase === 'failed' && readyFrames.length === 0;
  const isDraft = isComplete && (state.status === 'draft' || !state.persist);
  const displayUrl = lightboxFocusUrl || committedUrl || previewUrl;
  const activeFrame =
    frames.find((f) => f.previewUrl === displayUrl) ||
    frames.find((f) => f.frameIndex === state.activeFrameIndex) ||
    readyFrames[readyFrames.length - 1] ||
    null;
  const activeGenId = activeFrame?.generationId || state.generationId;
  const lightboxIndex = Math.max(
    0,
    readyFrames.findIndex((f) => f.previewUrl === displayUrl),
  );
  const imageTitle = useMemo(() => titleFromPrompt(state.prompt), [state.prompt]);
  const pathLabel = useMemo(
    () => `Agent / Images / ${isDraft ? 'Draft' : 'Library'} / ${shortId(activeGenId)}`,
    [isDraft, activeGenId],
  );

  const openLightbox = useCallback(
    (url?: string) => {
      const target = (url || committedUrl || previewUrl || '').trim();
      if (!target) return;
      setLightboxFocusUrl(target);
      setActionMsg(null);
      setEditText('');
      setLightboxOpen(true);
    },
    [committedUrl, previewUrl],
  );

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    setLightboxFocusUrl(null);
    setEditBusy(false);
  }, []);

  const stepLightbox = useCallback(
    (delta: number) => {
      if (readyFrames.length < 2) return;
      const i = lightboxIndex >= 0 ? lightboxIndex : 0;
      const next = readyFrames[(i + delta + readyFrames.length) % readyFrames.length];
      if (next?.previewUrl) setLightboxFocusUrl(next.previewUrl);
    },
    [readyFrames, lightboxIndex],
  );

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepLightbox(-1);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepLightbox(1);
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [lightboxOpen, closeLightbox, stepLightbox]);

  const submitEdit = useCallback(
    (text: string) => {
      const url = displayUrl;
      const trimmed = text.trim();
      if (!url || !trimmed || editBusy) return;
      setEditBusy(true);
      setActionMsg('Sending edit…');
      closeLightbox();
      window.dispatchEvent(
        new CustomEvent(IAM_AGENT_CHAT_COMPOSE, {
          detail: {
            message: `Edit this image: ${trimmed}\n\nImage URL: ${url}`,
            send: true,
          },
        }),
      );
    },
    [closeLightbox, displayUrl, editBusy],
  );

  const handleRate = async (rating: 1 | -1) => {
    if (!activeGenId || busyAction === 'rate') return;
    setBusyAction('rate');
    setActionMsg(null);
    try {
      await rateImageDraft(activeGenId, rating, workspaceId);
      setUserRating(rating);
      setActionMsg(rating === 1 ? 'Thanks — noted' : 'Thanks — we will learn from that');
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Rating failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownload = async () => {
    const url = displayUrl;
    if (!url) return;
    try {
      const res = await fetch(url, { credentials: 'include' });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `agentsam-${shortId(activeGenId)}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  /** Host the currently viewed frame on Cloudflare Images (no local download step). */
  const handleSaveToCfImages = async () => {
    const url = displayUrl;
    if (!url || busyAction === 'cf') return;
    setBusyAction('cf');
    setActionMsg(null);
    try {
      // Prefer draft→library when still a draft; then always host on CF Images from the bytes.
      if (isDraft && activeGenId) {
        try {
          const out = await saveImageDraft(activeGenId, {
            workspaceId,
            label: imageTitle,
            category: 'agent_backdrops',
            register_cms_asset: true,
          });
          const libraryUrl = out.url || out.public_url;
          if (libraryUrl) setCommittedUrl(libraryUrl);
        } catch {
          /* draft may already be saved — still host bytes on CF Images */
        }
      }

      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
      const blob = await res.blob();
      const mime = blob.type || 'image/jpeg';
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const file = new File([blob], `agentsam-${shortId(activeGenId)}.${ext}`, { type: mime });
      const fd = new FormData();
      fd.append('file', file);
      fd.append('alt_text', imageTitle);
      const qs = workspaceId?.trim()
        ? `?workspace_id=${encodeURIComponent(workspaceId.trim())}`
        : '';
      const up = await fetch(`/api/images/upload${qs}`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const json = (await up.json().catch(() => null)) as {
        error?: string;
        item?: { url?: string; public_url?: string };
        image?: { url?: string; public_url?: string };
        url?: string;
      } | null;
      if (!up.ok) throw new Error(json?.error || 'Cloudflare Images upload failed');
      const cfUrl =
        json?.item?.url ||
        json?.item?.public_url ||
        json?.image?.url ||
        json?.image?.public_url ||
        json?.url ||
        '';
      if (cfUrl) setCommittedUrl(cfUrl);
      setActionMsg('Saved to Cloudflare Images');
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDiscard = async () => {
    if (!activeGenId || !isDraft) return;
    if (!window.confirm('Discard this draft?')) return;
    setBusyAction('discard');
    setActionMsg(null);
    try {
      await discardImageDraft(activeGenId);
      setActionMsg('Discarded');
      closeLightbox();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Discard failed');
    } finally {
      setBusyAction(null);
    }
  };

  const renderRatingControls = () =>
    isComplete && activeGenId ? (
      <div className="iam-image-gen-rate" role="group" aria-label="Rate this image">
        <button
          type="button"
          className={`iam-image-gen-rate__btn${userRating === 1 ? ' is-active' : ''}`}
          aria-pressed={userRating === 1}
          aria-label="Thumbs up"
          disabled={busyAction === 'rate'}
          onClick={() => void handleRate(1)}
        >
          <ThumbsUp size={16} strokeWidth={2.25} absoluteStrokeWidth aria-hidden />
        </button>
        <button
          type="button"
          className={`iam-image-gen-rate__btn${userRating === -1 ? ' is-active' : ''}`}
          aria-pressed={userRating === -1}
          aria-label="Thumbs down"
          disabled={busyAction === 'rate'}
          onClick={() => void handleRate(-1)}
        >
          <ThumbsDown size={16} strokeWidth={2.25} absoluteStrokeWidth aria-hidden />
        </button>
      </div>
    ) : null;

  if (isFailed) {
    return (
      <p className="iam-image-gen-fail" role="alert">
        {state.message || 'Image generation failed'}
      </p>
    );
  }

  return (
    <>
      <div
        className={`iam-image-gen${isComplete ? ' iam-image-gen--ready' : ' iam-image-gen--pending'}${
          multi ? ' iam-image-gen--multi' : ''
        }`}
        aria-busy={!isComplete}
      >
        {!isComplete ? (
          <p className="iam-image-gen-status" aria-live="polite">
            {state.message?.trim() ||
              (multi
                ? `Creating ${frames.length} images… (${readyFrames.length}/${frames.length})`
                : 'Generating image…')}
          </p>
        ) : null}
        {multi ? (
          <div className="iam-image-gen-variants" role="list">
            {frames.map((frame) => {
              const frameDone = Boolean(frame.previewUrl) && (frame.phase === 'completed' || isComplete);
              const framePhase = frame.failed
                ? 'failed'
                : frameDone
                  ? 'completed'
                  : frame.phase || state.phase;
              const frameProgress = frameDone ? 100 : (frame.progress ?? state.progress);
              return (
                <div
                  key={`slot-${frame.frameIndex}`}
                  className={`iam-image-gen-variants__item${
                    frame.frameIndex === state.activeFrameIndex ? ' is-active' : ''
                  }${!frameDone ? ' is-pending' : ''}${frame.failed ? ' is-failed' : ''}`}
                  role="listitem"
                >
                  <span className="iam-image-gen-variants__label">
                    {frame.message?.trim() ||
                      (frameDone
                        ? `Variation ${frame.frameIndex + 1}`
                        : `Variation ${frame.frameIndex + 1}…`)}
                  </span>
                  <ProgressiveImagePreview
                    phase={framePhase}
                    progress={frameProgress}
                    previewUrl={frame.previewUrl}
                    finalUrl={frame.previewUrl}
                    onImageClick={frame.previewUrl ? openLightbox : undefined}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <ProgressiveImagePreview
            phase={state.phase}
            progress={state.progress}
            previewUrl={previewUrl}
            finalUrl={displayUrl}
            onImageClick={isComplete ? openLightbox : undefined}
          />
        )}
        {isComplete ? (
          <div className="iam-image-gen-footer">
            {renderRatingControls()}
            <button type="button" className="iam-image-gen-expand-hint" onClick={() => openLightbox()}>
              Click to enlarge
            </button>
          </div>
        ) : null}
      </div>

      {lightboxOpen && displayUrl
        ? createPortal(
            <div
              className="iam-image-gen-lightbox"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={pathId}
              onClick={closeLightbox}
            >
              <div
                className="iam-image-gen-lightbox__panel"
                onClick={(e) => e.stopPropagation()}
              >
                <header className="iam-image-gen-lightbox__bar">
                  <button
                    type="button"
                    className="iam-image-gen-lightbox__icon-btn"
                    onClick={closeLightbox}
                    aria-label="Close"
                  >
                    ×
                  </button>
                  <div className="iam-image-gen-lightbox__meta">
                    <p id={pathId} className="iam-image-gen-lightbox__path">
                      {pathLabel}
                      {readyFrames.length > 1
                        ? ` · ${lightboxIndex + 1} / ${readyFrames.length}`
                        : ''}
                    </p>
                    <h2 id={titleId} className="iam-image-gen-lightbox__title">
                      {imageTitle}
                    </h2>
                  </div>
                  <div className="iam-image-gen-lightbox__actions">
                    {renderRatingControls()}
                    <button
                      type="button"
                      className="iam-image-gen-lightbox__icon-action"
                      disabled={busyAction != null}
                      title="Save to Cloudflare Images"
                      aria-label="Save to Cloudflare Images"
                      onClick={() => void handleSaveToCfImages()}
                    >
                      <CloudUpload size={16} strokeWidth={2.25} absoluteStrokeWidth aria-hidden />
                      <span>{busyAction === 'cf' ? 'Saving…' : 'Save'}</span>
                    </button>
                    <button
                      type="button"
                      className="iam-image-gen-lightbox__icon-action"
                      title="Download"
                      aria-label="Download"
                      onClick={() => void handleDownload()}
                    >
                      <Download size={16} strokeWidth={2.25} absoluteStrokeWidth aria-hidden />
                      <span>Download</span>
                    </button>
                    {isDraft ? (
                      <button
                        type="button"
                        disabled={busyAction != null}
                        onClick={() => void handleDiscard()}
                      >
                        Discard
                      </button>
                    ) : null}
                  </div>
                </header>
                <div className="iam-image-gen-lightbox__stage">
                  {readyFrames.length > 1 ? (
                    <button
                      type="button"
                      className="iam-image-gen-lightbox__nav iam-image-gen-lightbox__nav--prev"
                      aria-label="Previous image"
                      onClick={() => stepLightbox(-1)}
                    >
                      <ChevronLeft size={28} strokeWidth={2} absoluteStrokeWidth aria-hidden />
                    </button>
                  ) : null}
                  <img src={displayUrl} alt={imageTitle} />
                  {readyFrames.length > 1 ? (
                    <button
                      type="button"
                      className="iam-image-gen-lightbox__nav iam-image-gen-lightbox__nav--next"
                      aria-label="Next image"
                      onClick={() => stepLightbox(1)}
                    >
                      <ChevronRight size={28} strokeWidth={2} absoluteStrokeWidth aria-hidden />
                    </button>
                  ) : null}
                </div>
                {actionMsg ? (
                  <p className="iam-image-gen-lightbox__msg" aria-live="polite">
                    {actionMsg}
                  </p>
                ) : null}
                <form
                  className="iam-image-gen-lightbox__edit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitEdit(editText);
                  }}
                >
                  <input
                    name="edit"
                    type="text"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    placeholder="Describe edits"
                    autoComplete="off"
                    aria-label="Describe edits"
                    disabled={editBusy}
                    autoFocus
                  />
                  <button
                    type="submit"
                    aria-label="Send edit"
                    disabled={editBusy || !editText.trim()}
                  >
                    ↑
                  </button>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
