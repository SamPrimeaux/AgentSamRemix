import React, { useCallback, useRef, useState } from 'react';
import { Minus, Plus, Upload } from 'lucide-react';
import { uploadDashboardImage } from '../../client-api/uploadImage';
import { AppIcon, type AppIconPresentation } from '../ui/AppIcon';

const BG_PRESETS: { label: string; value: string | null }[] = [
  { label: 'None', value: null },
  { label: 'White', value: '#ffffff' },
  { label: 'Dark', value: '#0b1018' },
  { label: 'Blue', value: '#1a6fe8' },
];

const SCALE_MIN = 0.5;
const SCALE_MAX = 1.2;
const SCALE_STEP = 0.05;

export function clampIconScale(n: number | undefined): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(v * 100) / 100));
}

export type IconEditorDraft = {
  title: string;
  subtitle?: string;
  image_url: string | null;
  icon_slug?: string;
  icon_scale?: number;
  icon_bg?: string | null;
};

type Props = {
  draft: IconEditorDraft;
  onChange: (patch: Partial<IconEditorDraft>) => void;
  workspaceId?: string | null;
  presentation?: AppIconPresentation;
  previewSize?: 'sm' | 'md' | 'lg';
};

export function IconEditorControls({
  draft,
  onChange,
  workspaceId,
  presentation = 'app',
  previewSize = 'md',
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const scale = clampIconScale(draft.icon_scale);

  const applyFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        setUploadErr('Please choose an image file (PNG, JPG, WebP…)');
        return;
      }
      setUploadBusy(true);
      setUploadErr(null);
      const res = await uploadDashboardImage(file, workspaceId);
      setUploadBusy(false);
      if (!res.ok || !res.url) {
        setUploadErr(res.error || 'Upload failed');
        return;
      }
      onChange({ image_url: res.url });
    },
    [onChange, workspaceId],
  );

  const bumpScale = (delta: number) => {
    onChange({ icon_scale: clampIconScale(scale + delta) });
  };

  return (
    <>
      <div className="iam-home-tile-preview">
        <p className="iam-home-tile-preview-label">Live preview</p>
        <AppIcon
          title={draft.title}
          imageUrl={draft.image_url}
          iconSlug={draft.icon_slug}
          size={previewSize}
          artScale={scale}
          backgroundColor={draft.icon_bg}
          presentation={presentation}
          subtitle={draft.subtitle}
          editActive
          onImageDrop={(file) => applyFile(file)}
        />
      </div>

      <div
        className={`iam-home-tile-dropzone ${dragOver ? 'is-over' : ''} ${uploadBusy ? 'is-busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void applyFile(file);
        }}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click();
        }}
        role="button"
        tabIndex={0}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void applyFile(file);
            e.target.value = '';
          }}
        />
        <Upload size={20} strokeWidth={1.75} aria-hidden />
        <strong>{uploadBusy ? 'Uploading…' : 'Drop icon here'}</strong>
        <span>or click to browse — PNG, JPG, WebP</span>
      </div>
      {uploadErr ? <p className="iam-home-customize-error">{uploadErr}</p> : null}
      {draft.image_url ? (
        <p className="iam-home-tile-upload-ok">Icon ready — tune scale and background below.</p>
      ) : null}

      <div className="iam-home-tile-control-row">
        <span className="iam-home-tile-control-label">Icon scale</span>
        <div className="iam-home-tile-stepper">
          <button
            type="button"
            aria-label="Decrease icon scale"
            disabled={scale <= SCALE_MIN}
            onClick={() => bumpScale(-SCALE_STEP)}
          >
            <Minus size={14} />
          </button>
          <span className="iam-home-tile-stepper-value">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            aria-label="Increase icon scale"
            disabled={scale >= SCALE_MAX}
            onClick={() => bumpScale(SCALE_STEP)}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="iam-home-tile-control-row iam-home-tile-control-row--stack">
        <span className="iam-home-tile-control-label">Background</span>
        <div className="iam-home-tile-bg-presets">
          {BG_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={`iam-home-tile-bg-chip${draft.icon_bg === preset.value ? ' active' : ''}`}
              onClick={() => onChange({ icon_bg: preset.value })}
            >
              {preset.value ? (
                <span className="iam-home-tile-bg-swatch" style={{ background: preset.value }} aria-hidden />
              ) : (
                <span className="iam-home-tile-bg-swatch iam-home-tile-bg-swatch--none" aria-hidden />
              )}
              {preset.label}
            </button>
          ))}
        </div>
        <label className="iam-home-tile-field iam-home-tile-field--inline">
          Custom color
          <input
            type="color"
            value={draft.icon_bg && draft.icon_bg.startsWith('#') ? draft.icon_bg : '#ffffff'}
            onChange={(e) => onChange({ icon_bg: e.target.value })}
          />
        </label>
      </div>
    </>
  );
}
