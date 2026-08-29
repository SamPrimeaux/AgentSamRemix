import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AlertCircle, Pencil } from 'lucide-react';
import './AppIcon.css';
import { resolveIntegrationIconUrl } from '../../src/lib/resolveIntegrationIconUrl';

export type AppIconSize = 'sm' | 'md' | 'lg';
export type AppIconStatus = 'ok' | 'warning' | 'error';
export type AppIconPresentation = 'app' | 'brand';

export type AppIconProps = {
  title: string;
  /** integration_registry.provider_key — used for brand map / prefix fallback */
  providerKey?: string;
  /** Full-bleed artwork (Cloudflare Images, R2, etc.) */
  imageUrl?: string | null;
  /** Per-tenant registry override (integration_registry.custom_icon_url) */
  registryIconUrl?: string | null;
  /** Integration catalog slug — uses contained brand presentation when no custom image. */
  iconSlug?: string;
  size?: AppIconSize;
  /** 0.5–1.2 — artwork scale within the icon shell (app tiles only). */
  artScale?: number;
  /** Optional shell background (hex/rgb). */
  backgroundColor?: string | null;
  /** Force app (full tile artwork) vs brand (integration logo). Auto when omitted. */
  presentation?: AppIconPresentation;
  subtitle?: string;
  status?: AppIconStatus | null;
  disabled?: boolean;
  editable?: boolean;
  editActive?: boolean;
  onPress?: () => void;
  onEdit?: () => void;
  onImageDrop?: (file: File) => void | Promise<void>;
  className?: string;
};

function initials(name: string): string {
  const p = name.trim().split(/\s+/).slice(0, 2);
  return p.map((w) => w[0]).join('').toUpperCase() || '?';
}

function deliveryUrl(url: string, presentation: AppIconPresentation): string {
  const raw = url.trim();
  if (!raw.includes('imagedelivery.net')) return raw;
  if (presentation === 'brand') return raw;
  return raw.replace(/\/(small|thumbnail|avatar|hero)$/, '/public');
}

function isBrandDeliveryUrl(url: string): boolean {
  return /\/(avatar|thumbnail|small)(?:\?|$)/i.test(url);
}

function resolvePresentation(
  imageUrl: string | null | undefined,
  iconSlug: string | undefined,
  registryIconUrl: string | null | undefined,
  resolvedSrc: string | null,
): AppIconPresentation {
  const explicit = String(imageUrl || registryIconUrl || '').trim();
  if (registryIconUrl?.trim() && !imageUrl?.trim()) return 'app';
  if (iconSlug && !explicit) return 'brand';
  if (explicit && isBrandDeliveryUrl(explicit)) return 'brand';
  if (resolvedSrc && isBrandDeliveryUrl(resolvedSrc)) return 'brand';
  return 'app';
}

function clampScale(n: number | undefined): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.min(1.2, Math.max(0.5, v));
}

export function AppIcon({
  title,
  providerKey,
  imageUrl,
  registryIconUrl,
  iconSlug,
  size = 'md',
  artScale = 1,
  backgroundColor,
  presentation: presentationProp,
  subtitle,
  status,
  disabled,
  editable,
  editActive,
  onPress,
  onEdit,
  onImageDrop,
  className = '',
}: AppIconProps) {
  const [iconFailed, setIconFailed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const longPressRef = useRef<number | null>(null);

  const rawResolved = resolveIntegrationIconUrl(
    providerKey || iconSlug,
    imageUrl,
    iconSlug,
    registryIconUrl,
  );
  const presentation = presentationProp ?? resolvePresentation(imageUrl, iconSlug, registryIconUrl, rawResolved);
  const scale = presentation === 'app' ? clampScale(artScale) : 1;

  const artSrc = useMemo(() => {
    if (!rawResolved || iconFailed) return null;
    return deliveryUrl(rawResolved, presentation);
  }, [rawResolved, iconFailed, presentation]);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (!onImageDrop) return;
      const file = e.dataTransfer.files?.[0];
      if (file?.type.startsWith('image/')) await onImageDrop(file);
    },
    [onImageDrop],
  );

  const shellStyle = useMemo(() => {
    const style: React.CSSProperties & Record<string, string> = {};
    if (backgroundColor?.trim()) {
      style.background = backgroundColor.trim();
    }
    style['--iam-icon-art-scale'] = `${Math.round(scale * 100)}%`;
    return style;
  }, [backgroundColor, scale]);

  const showPencil = !!editable;

  return (
    <article className={`iam-app-icon-wrap iam-app-icon-wrap--${size} ${className}`.trim()}>
      <div
        className={[
          'iam-app-icon-shell',
          presentation === 'brand' ? 'iam-app-icon-shell--brand' : 'iam-app-icon-shell--app',
          editActive ? 'is-edit-active' : '',
          dragOver ? 'is-drag-over' : '',
          disabled ? 'is-disabled' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onDragOver={(e) => {
          if (!onImageDrop) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => void handleDrop(e)}
      >
        <button
          type="button"
          className="iam-app-icon-hit"
          style={shellStyle}
          disabled={disabled}
          aria-label={title}
          onClick={onPress}
          onTouchStart={() => {
            if (!editable || !onEdit) return;
            longPressRef.current = window.setTimeout(() => onEdit(), 520);
          }}
          onTouchEnd={() => {
            if (longPressRef.current) {
              window.clearTimeout(longPressRef.current);
              longPressRef.current = null;
            }
          }}
        >
          {artSrc ? (
            <img
              src={artSrc}
              alt=""
              className={presentation === 'brand' ? 'iam-app-icon-brand' : 'iam-app-icon-art'}
              loading="lazy"
              decoding="async"
              onError={() => setIconFailed(true)}
            />
          ) : (
            <span className="iam-app-icon-fallback">{initials(title)}</span>
          )}
          {status === 'warning' || status === 'error' ? (
            <span
              className={`iam-app-icon-status iam-app-icon-status--${status}`}
              title={status === 'error' ? 'Needs attention' : 'Degraded'}
            >
              <AlertCircle size={12} strokeWidth={2.25} aria-hidden />
            </span>
          ) : null}
        </button>
        {showPencil ? (
          <button
            type="button"
            className="iam-app-icon-edit"
            aria-label={`Edit ${title} icon`}
            onClick={(e) => {
              e.stopPropagation();
              onEdit?.();
            }}
          >
            <Pencil size={11} strokeWidth={2.25} aria-hidden />
          </button>
        ) : null}
      </div>
      <p className="iam-app-icon-label">{title}</p>
      {subtitle ? <p className="iam-app-icon-sub">{subtitle}</p> : null}
    </article>
  );
}
