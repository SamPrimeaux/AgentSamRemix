import React, { useEffect, useMemo, useState } from 'react';
import { Link as LinkIcon } from 'lucide-react';
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import type { ImagesOutletContext } from './ImagesShell';
import { ImagesToastStack } from './ImagesUsageAccountSidebar';
import { Dropdown, type DropdownOption } from './Dropdown';
import { Breadcrumb } from './Breadcrumb';
import { Toggle } from './Toggle';
import {
  imagesDetailPath,
  imagesDetailUrl,
  imagesPreviewUrl,
  imagesStoragePath,
  imagesTransformUrl,
  useImagesToast,
} from './imagesApi';

const DOCS_URL = 'https://developers.cloudflare.com/images/optimization/features/';

/** Binding + flexible delivery fit modes (Features doc). Named-variant create API is a subset. */
const FIT_OPTIONS: DropdownOption[] = [
  { value: 'scale-down', label: 'Scale down' },
  { value: 'contain', label: 'Contain' },
  { value: 'cover', label: 'Cover' },
  { value: 'crop', label: 'Crop' },
  { value: 'pad', label: 'Pad' },
  { value: 'aspect-crop', label: 'Aspect crop' },
  { value: 'squeeze', label: 'Squeeze (stretch)' },
  { value: 'scale-up', label: 'Scale up' },
];

const FORMAT_OPTIONS: DropdownOption[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'webp', label: 'WebP' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'baseline-jpeg', label: 'Baseline JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'avif', label: 'AVIF' },
];

const GRAVITY_OPTIONS: DropdownOption[] = [
  { value: 'auto', label: 'Auto (saliency)' },
  { value: 'face', label: 'Face' },
  { value: 'center', label: 'Center' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
];

const FLIP_OPTIONS: DropdownOption[] = [
  { value: '', label: 'None' },
  { value: 'h', label: 'Horizontal' },
  { value: 'v', label: 'Vertical' },
  { value: 'hv', label: 'Both' },
];

const UPSCALE_OPTIONS: DropdownOption[] = [
  { value: 'interpolate', label: 'Interpolate (bicubic)' },
  { value: 'generate', label: 'Generate (AI / ESRGAN)' },
];

type OpsState = {
  width: string;
  height: string;
  fit: string;
  gravity: string;
  zoom: string;
  dpr: string;
  background: string;
  brightness: string;
  contrast: string;
  saturation: string;
  gamma: string;
  blur: string;
  sharpen: string;
  rotate: string;
  flip: string;
  format: string;
  quality: string;
  upscale: string;
  trim: string;
  segment: boolean;
  anim: boolean;
  watermark: boolean;
};

const DEFAULT_OPS: OpsState = {
  width: '',
  height: '',
  fit: 'scale-down',
  gravity: 'auto',
  zoom: '0',
  dpr: '1',
  background: '',
  brightness: '1',
  contrast: '1',
  saturation: '1',
  gamma: '1',
  blur: '0',
  sharpen: '0',
  rotate: '0',
  flip: '',
  format: 'webp',
  quality: '85',
  upscale: 'interpolate',
  trim: '',
  segment: false,
  anim: true,
  watermark: false,
};

function opsToRecord(ops: OpsState): Record<string, string | number | boolean | Record<string, number>> {
  const out: Record<string, string | number | boolean | Record<string, number>> = {};
  if (ops.width) out.width = Number(ops.width);
  if (ops.height) out.height = Number(ops.height);
  if (ops.fit) out.fit = ops.fit;
  if (ops.gravity && (ops.fit === 'cover' || ops.fit === 'crop' || ops.fit === 'aspect-crop')) {
    out.gravity = ops.gravity;
  }
  if (ops.gravity === 'face' && ops.zoom && ops.zoom !== '0') out.zoom = Number(ops.zoom);
  if (ops.dpr && ops.dpr !== '1') out.dpr = Number(ops.dpr);
  if (ops.background.trim()) out.background = ops.background.trim();
  if (ops.brightness !== '' && ops.brightness !== '1') out.brightness = Number(ops.brightness);
  if (ops.contrast !== '' && ops.contrast !== '1') out.contrast = Number(ops.contrast);
  if (ops.saturation !== '' && ops.saturation !== '1') out.saturation = Number(ops.saturation);
  if (ops.gamma !== '' && ops.gamma !== '1' && ops.gamma !== '0') out.gamma = Number(ops.gamma);
  if (ops.blur && ops.blur !== '0') out.blur = Number(ops.blur);
  if (ops.sharpen && ops.sharpen !== '0') out.sharpen = Number(ops.sharpen);
  if (ops.rotate && ops.rotate !== '0') out.rotate = Number(ops.rotate);
  if (ops.flip) out.flip = ops.flip;
  if (ops.format && ops.format !== 'auto') out.format = ops.format;
  if (ops.quality) out.quality = Number(ops.quality);
  if (
    ops.upscale &&
    ops.upscale !== 'interpolate' &&
    (ops.fit === 'contain' || ops.fit === 'cover' || ops.fit === 'scale-up' || ops.fit === 'pad')
  ) {
    out.upscale = ops.upscale;
  }
  if (ops.trim.trim()) {
    const parts = ops.trim.split(';').map((p) => p.trim());
    if (parts.length === 4 && parts.every((p) => p !== '' && Number.isFinite(Number(p)))) {
      out.trim = {
        top: Number(parts[0]),
        right: Number(parts[1]),
        bottom: Number(parts[2]),
        left: Number(parts[3]),
      };
    }
  }
  if (ops.segment) out.segment = 'foreground';
  if (!ops.anim) out.anim = false;
  return out;
}

export function ImagesEditPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { workspaceId, setDocsUrl } = useOutletContext<ImagesOutletContext>();
  const navigate = useNavigate();
  const { toasts, add: toast } = useImagesToast();

  useEffect(() => {
    setDocsUrl(DOCS_URL);
    return () => setDocsUrl(null);
  }, [setDocsUrl]);

  const [filename, setFilename] = useState('');
  const [ops, setOps] = useState<OpsState>(DEFAULT_OPS);
  const [previewSrc, setPreviewSrc] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newId, setNewId] = useState<string | null>(null);
  const [browseOnly, setBrowseOnly] = useState(false);
  const [detailItem, setDetailItem] = useState<{
    id: string;
    source?: string;
    r2_bucket?: string | null;
    r2_key?: string | null;
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(
      imagesDetailUrl(id, workspaceId, {
        r2Bucket: searchParams.get('r2_bucket'),
        r2Key: searchParams.get('r2_key'),
      }),
      { credentials: 'same-origin' },
    )
      .then((r) => r.json())
      .then((d) => {
        const row = d.item || d.image || d;
        if (row?.filename) setFilename(String(row.filename));
        if (row?.url) setPreviewSrc(String(row.url));
        const r2Browse =
          d.browse_only === true ||
          row?.browse_only === true ||
          String(id).startsWith('r2obj_') ||
          (row?.source === 'r2' && !row?.cloudflare_image_id);
        setBrowseOnly(!!r2Browse);
        if (row?.id) {
          setDetailItem({
            id: String(row.id),
            source: row.source,
            r2_bucket: row.r2_bucket,
            r2_key: row.r2_key,
          });
        }
      })
      .catch(() => {});
  }, [id, workspaceId, searchParams]);

  const previewQueryUrl = useMemo(() => {
    if (!id) return '';
    const record = opsToRecord(ops);
    const flat: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(record)) {
      if (k === 'trim' && typeof v === 'object') {
        flat.trim = `${v.top};${v.right};${v.bottom};${v.left}`;
      } else if (typeof v !== 'object') {
        flat[k] = v as string | number | boolean;
      }
    }
    const base = imagesPreviewUrl(id, flat, workspaceId);
    if (!ops.watermark) return base;
    return base.includes('?') ? `${base}&watermark=1` : `${base}?watermark=1`;
  }, [id, ops, workspaceId]);

  useEffect(() => {
    if (!id || !previewQueryUrl) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setPreviewBusy(true);
      const src = previewQueryUrl;
      const img = new Image();
      img.onload = () => {
        if (!cancelled) {
          setPreviewSrc(src);
          setPreviewBusy(false);
        }
      };
      img.onerror = () => {
        if (!cancelled) setPreviewBusy(false);
      };
      img.src = src;
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [id, previewQueryUrl]);

  const setNum =
    (key: keyof OpsState) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setOps((p) => ({ ...p, [key]: e.target.value }));
    };

  const onSave = async () => {
    if (!id) return;
    setSaving(true);
    setNewId(null);
    try {
      const body = {
        ops: opsToRecord(ops),
        mode: 'derivative' as const,
        watermark: ops.watermark,
      };
      const r = await fetch(imagesTransformUrl(id, workspaceId), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || d.error) {
        toast(d.error || `Transform failed (${r.status})`, 'err');
        return;
      }
      const row = d.item || d.image;
      const nid = row?.id ? String(row.id) : null;
      setNewId(nid);
      toast(nid ? `Derivative saved` : 'Transform saved');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Transform failed', 'err');
    } finally {
      setSaving(false);
    }
  };

  const fieldLabel: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    color: 'var(--text-muted)',
    marginBottom: 5,
    fontWeight: 500,
  };

  const input: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-main)',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
  };

  const card: React.CSSProperties = {
    padding: 20,
    borderRadius: 6,
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-panel)',
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    margin: '16px 0 10px',
  };

  if (!id) {
    return <div style={{ padding: 24, color: '#f87171' }}>Missing image id</div>;
  }

  const storageBack = imagesStoragePath({
    source: browseOnly ? 'r2' : undefined,
    r2Bucket: detailItem?.r2_bucket || searchParams.get('r2_bucket'),
    workspaceId,
  });
  const detailBack = detailItem
    ? imagesDetailPath(detailItem)
    : `/dashboard/images/${encodeURIComponent(id)}`;

  if (browseOnly) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 24px 32px' }}>
        <Breadcrumb
          items={[
            { label: 'Hosted images', to: storageBack, icon: true },
            { label: 'Storage', to: storageBack },
            { label: filename || id, to: detailBack },
            { label: 'Edit' },
          ]}
        />
        <h2 style={{ margin: '12px 0 10px', fontSize: 18, fontWeight: 600 }}>Edit unavailable</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', maxWidth: 520, lineHeight: 1.5 }}>
          This transform editor is for Cloudflare Images (named variants, derivatives, fit/crop).
          R2 browse objects stay in-bucket — use <strong>Rename</strong> on the detail page for the
          display label. Object-key move / folder reorganize is tracked as{' '}
          <code style={{ color: 'var(--solar-cyan)' }}>tkt_r2_hosted_images_rename_reorg</code>.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={() => navigate(detailBack)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--solar-cyan)',
              color: '#000',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Back to image
          </button>
          <Link to={storageBack} style={{ fontSize: 12, color: 'var(--solar-cyan)', alignSelf: 'center' }}>
            Back to Storage
          </Link>
        </div>
        <ImagesToastStack toasts={toasts} />
      </div>
    );
  }

  const showGravity = ops.fit === 'cover' || ops.fit === 'crop' || ops.fit === 'aspect-crop';
  const showUpscale =
    ops.fit === 'contain' || ops.fit === 'cover' || ops.fit === 'scale-up' || ops.fit === 'pad';

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 24px 32px' }}>
      <Breadcrumb
        items={[
          { label: 'Hosted images', to: storageBack, icon: true },
          { label: 'Storage', to: storageBack },
          {
            label: filename || id,
            to: detailBack,
          },
          { label: 'Edit' },
        ]}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 18,
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Edit image</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => navigate(detailBack)}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-muted)',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onSave()}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--solar-cyan)',
              color: '#000',
              fontSize: 12,
              fontWeight: 600,
              cursor: saving ? 'wait' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {saving ? 'Saving…' : 'Save derivative'}
          </button>
        </div>
      </div>

      {newId && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 12px',
            borderRadius: 6,
            border: '1px solid color-mix(in srgb, var(--solar-cyan) 40%, var(--border-subtle))',
            background: 'color-mix(in srgb, var(--solar-cyan) 8%, var(--bg-panel))',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <LinkIcon size={13} style={{ color: 'var(--solar-cyan)' }} />
          Derivative created:{' '}
          <Link
            to={`/dashboard/images/${encodeURIComponent(newId)}`}
            style={{ color: 'var(--solar-cyan)', fontWeight: 600 }}
          >
            {newId}
          </Link>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 420px) 1fr',
          gap: 24,
          alignItems: 'start',
        }}
      >
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Configuration</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.45 }}>
            Cloudflare Images Features params via Workers binding. Preview updates live.
          </div>

          <div style={sectionTitle}>Size</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={fieldLabel}>Width</label>
              <input
                type="number"
                min={1}
                max={4096}
                value={ops.width}
                onChange={setNum('width')}
                style={input}
                placeholder="auto"
              />
            </div>
            <div>
              <label style={fieldLabel}>Height</label>
              <input
                type="number"
                min={1}
                max={4096}
                value={ops.height}
                onChange={setNum('height')}
                style={input}
                placeholder="auto"
              />
            </div>
          </div>

          <label style={fieldLabel}>Fit</label>
          <div style={{ marginBottom: 12 }}>
            <Dropdown
              value={ops.fit}
              options={FIT_OPTIONS}
              onChange={(v) => setOps((p) => ({ ...p, fit: v }))}
            />
          </div>

          {showGravity ? (
            <>
              <label style={fieldLabel}>Gravity</label>
              <div style={{ marginBottom: 12 }}>
                <Dropdown
                  value={ops.gravity}
                  options={GRAVITY_OPTIONS}
                  onChange={(v) => setOps((p) => ({ ...p, gravity: v }))}
                />
              </div>
              {ops.gravity === 'face' ? (
                <div style={{ marginBottom: 12 }}>
                  <label style={fieldLabel}>Face zoom (0–1)</label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={ops.zoom}
                    onChange={setNum('zoom')}
                    style={input}
                  />
                </div>
              ) : null}
            </>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={fieldLabel}>DPR (1–2)</label>
              <input
                type="number"
                min={1}
                max={2}
                step={0.1}
                value={ops.dpr}
                onChange={setNum('dpr')}
                style={input}
              />
            </div>
            <div>
              <label style={fieldLabel}>Background (pad)</label>
              <input
                value={ops.background}
                onChange={setNum('background')}
                style={input}
                placeholder="#FFFFFF or red"
              />
            </div>
          </div>

          {showUpscale ? (
            <>
              <label style={fieldLabel}>Upscale</label>
              <div style={{ marginBottom: 12 }}>
                <Dropdown
                  value={ops.upscale}
                  options={UPSCALE_OPTIONS}
                  onChange={(v) => setOps((p) => ({ ...p, upscale: v }))}
                />
              </div>
            </>
          ) : null}

          <label style={fieldLabel}>Trim (top;right;bottom;left)</label>
          <input
            value={ops.trim}
            onChange={setNum('trim')}
            style={{ ...input, marginBottom: 4 }}
            placeholder="e.g. 0.1;0.1;0.1;0.1"
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
            Pixels or 0–1 fractions. Applied before resize.
          </div>

          <div style={sectionTitle}>Tone</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={fieldLabel}>Brightness</label>
              <input
                type="number"
                min={0}
                max={2}
                step={0.05}
                value={ops.brightness}
                onChange={setNum('brightness')}
                style={input}
              />
            </div>
            <div>
              <label style={fieldLabel}>Contrast</label>
              <input
                type="number"
                min={0}
                max={2}
                step={0.05}
                value={ops.contrast}
                onChange={setNum('contrast')}
                style={input}
              />
            </div>
            <div>
              <label style={fieldLabel}>Saturation</label>
              <input
                type="number"
                min={0}
                max={2}
                step={0.05}
                value={ops.saturation}
                onChange={setNum('saturation')}
                style={input}
              />
            </div>
            <div>
              <label style={fieldLabel}>Gamma</label>
              <input
                type="number"
                min={0}
                max={2}
                step={0.05}
                value={ops.gamma}
                onChange={setNum('gamma')}
                style={input}
              />
            </div>
          </div>

          <div style={sectionTitle}>Filters & orient</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={fieldLabel}>Blur (0–250)</label>
              <input
                type="number"
                min={0}
                max={250}
                value={ops.blur}
                onChange={setNum('blur')}
                style={input}
              />
            </div>
            <div>
              <label style={fieldLabel}>Sharpen (0–10)</label>
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={ops.sharpen}
                onChange={setNum('sharpen')}
                style={input}
              />
            </div>
            <div>
              <label style={fieldLabel}>Rotate</label>
              <input
                type="number"
                min={0}
                max={359}
                value={ops.rotate}
                onChange={setNum('rotate')}
                style={input}
              />
            </div>
            <div>
              <label style={fieldLabel}>Flip</label>
              <Dropdown
                value={ops.flip}
                options={FLIP_OPTIONS}
                onChange={(v) => setOps((p) => ({ ...p, flip: v }))}
              />
            </div>
          </div>

          <div style={sectionTitle}>Output</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={fieldLabel}>Format</label>
              <Dropdown
                value={ops.format}
                options={FORMAT_OPTIONS}
                onChange={(v) => setOps((p) => ({ ...p, format: v }))}
              />
            </div>
            <div>
              <label style={fieldLabel}>Quality</label>
              <input
                type="number"
                min={1}
                max={100}
                value={ops.quality}
                onChange={setNum('quality')}
                style={input}
              />
            </div>
          </div>

          <div
            style={{
              ...card,
              padding: 12,
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 500 }}>Preserve animation</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Off = first frame only (anim=false)
              </div>
            </div>
            <Toggle
              checked={ops.anim}
              onChange={(v) => setOps((p) => ({ ...p, anim: v }))}
              label="Preserve animation"
            />
          </div>

          <div
            style={{
              ...card,
              padding: 12,
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 500 }}>Segment foreground</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                BiRefNet cutout → transparent background
              </div>
            </div>
            <Toggle
              checked={ops.segment}
              onChange={(v) => setOps((p) => ({ ...p, segment: v }))}
              label="Segment foreground"
            />
          </div>

          <div
            style={{
              ...card,
              padding: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 500 }}>Watermark</span>
            <Toggle
              checked={ops.watermark}
              onChange={(v) => setOps((p) => ({ ...p, watermark: v }))}
              label="Watermark"
            />
          </div>
        </div>

        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>Preview</div>
            {previewBusy && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Updating…</span>
            )}
          </div>
          <div
            style={{
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-elevated)',
              padding: previewSrc ? 16 : 0,
              minHeight: 480,
              display: previewSrc ? 'block' : 'flex',
              alignItems: previewSrc ? undefined : 'center',
              justifyContent: previewSrc ? undefined : 'center',
              color: previewSrc ? undefined : 'var(--text-muted)',
              fontSize: previewSrc ? undefined : 12,
            }}
          >
            {previewSrc ? (
              <img
                key={previewSrc}
                src={previewSrc}
                alt="Transform preview"
                style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
              />
            ) : (
              'No preview'
            )}
          </div>
        </div>
      </div>

      <ImagesToastStack toasts={toasts} />
    </div>
  );
}

export default ImagesEditPage;
