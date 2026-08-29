/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { ImageGenerationPhase } from './ChatAssistant/types';

export type ProgressiveImagePreviewProps = {
  phase: ImageGenerationPhase;
  progress: number;
  previewUrl?: string | null;
  finalUrl?: string | null;
  onImageClick?: (url: string) => void;
};

function blurForProgress(progress: number, phase: ImageGenerationPhase): number {
  if (phase === 'completed') return 0;
  if (phase === 'failed') return 12;
  return Math.max(0, 20 - progress * 0.2);
}

function scaleForProgress(progress: number, phase: ImageGenerationPhase): number {
  if (phase === 'completed') return 1;
  return 1 + Math.max(0, 0.04 - progress * 0.0004);
}

export function ProgressiveImagePreview({
  phase,
  progress,
  previewUrl,
  finalUrl,
  onImageClick,
}: ProgressiveImagePreviewProps) {
  const displayUrl = phase === 'completed' && finalUrl ? finalUrl : previewUrl || finalUrl;
  const canOpen = phase === 'completed' && Boolean(displayUrl) && typeof onImageClick === 'function';
  const blur = blurForProgress(progress, phase);
  const scale = scaleForProgress(progress, phase);
  const showAmbient = phase !== 'completed' && phase !== 'failed';

  const handleClick = () => {
    const url = finalUrl || previewUrl;
    if (url && onImageClick) onImageClick(url);
  };

  return (
    <div
      className="iam-image-gen-preview"
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      aria-label={canOpen ? 'Enlarge image' : undefined}
      onClick={canOpen ? handleClick : undefined}
      onKeyDown={
        canOpen
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
    >
      {showAmbient ? (
        <>
          <div className="iam-image-gen-preview__ambient" aria-hidden />
          <div className="iam-image-gen-preview__shimmer" aria-hidden />
          <div className="iam-image-gen-preview__pulse" aria-hidden />
        </>
      ) : null}
      {displayUrl ? (
        <img
          src={displayUrl}
          alt=""
          className="iam-image-gen-preview__img"
          style={{
            filter: blur > 0 ? `blur(${blur}px)` : 'none',
            opacity: phase === 'completed' ? 1 : Math.min(0.95, 0.35 + progress / 130),
            transform: `scale(${scale})`,
          }}
          draggable={false}
        />
      ) : (
        <div className="iam-image-gen-preview__img iam-image-gen-preview__img--placeholder" aria-hidden />
      )}
    </div>
  );
}
