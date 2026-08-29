import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import type { ImagesOutletContext } from './ImagesShell';
import { ImagesToastStack } from './ImagesUsageAccountSidebar';
import { createNamedVariant, useImagesToast } from './imagesApi';
import { Dropdown, type DropdownOption } from './Dropdown';
import { Toggle } from './Toggle';
import { Breadcrumb } from './Breadcrumb';

const DOCS_URL = 'https://developers.cloudflare.com/images/optimization/hosted-images/create-variants/';

/**
 * Named-variant param catalog. Per CF create API schema, options are limited to
 * width, height, fit, metadata. Blur is Features-doc / flexible-preview only —
 * shown via + Add for live preview, stripped on Create (API rejects unknown keys).
 */
type RowKey = 'width' | 'height' | 'fit' | 'metadata' | 'blur';

const FIT_OPTIONS: (DropdownOption & { help: string })[] = [
  { value: 'scale-down', label: 'Scale down', help: 'Fits within dimensions while preserving aspect ratio, but never upscales.' },
  { value: 'contain', label: 'Contain', help: 'Resized to be as large as possible within the dimensions while preserving aspect ratio.' },
  { value: 'cover', label: 'Cover', help: 'Resized to exactly fill the target area; cropped if necessary.' },
  { value: 'crop', label: 'Crop', help: 'Shrunk and cropped to fit; never enlarged.' },
  { value: 'pad', label: 'Pad', help: 'Resized to fit within dimensions while preserving aspect ratio, padding remaining space.' },
];

const METADATA_OPTIONS: (DropdownOption & { help: string })[] = [
  { value: 'none', label: 'Strip all metadata', help: 'Removes all EXIF metadata from the output image.' },
  { value: 'copyright', label: 'Strip all except copyright', help: 'Discards all metadata except the EXIF copyright tag.' },
  { value: 'keep', label: 'Keep all metadata', help: 'Preserves all original EXIF metadata in the output image.' },
];

const ROW_CATALOG: { key: RowKey; label: string; addable: boolean }[] = [
  { key: 'width', label: 'Width', addable: false },
  { key: 'height', label: 'Height', addable: false },
  { key: 'fit', label: 'Fit', addable: false },
  { key: 'metadata', label: 'Metadata', addable: false },
  { key: 'blur', label: 'Blur', addable: true },
];

const ROW_DEFAULTS: Record<RowKey, string> = {
  width: '1366',
  height: '768',
  fit: 'scale-down',
  metadata: 'copyright',
  blur: '0',
};

const DEMO_ACCOUNT_HASH = 'g7wf09fCONpnidkRnR_5vw';
const DEMO_IMAGE_ID = 'bc060aee-1285-4ab2-0885-12ad3ef68c00';

function buildFlexiblePreviewUrl(values: Partial<Record<RowKey, string>>): string {
  const parts: string[] = [];
  const w = Number(values.width);
  const h = Number(values.height);
  if (Number.isFinite(w) && w > 0) parts.push(`width=${Math.round(w)}`);
  if (Number.isFinite(h) && h > 0) parts.push(`height=${Math.round(h)}`);
  if (values.fit) parts.push(`fit=${values.fit}`);
  if (values.metadata && values.metadata !== 'none') parts.push(`metadata=${values.metadata}`);
  const blur = Number(values.blur);
  if (Number.isFinite(blur) && blur > 0) parts.push(`blur=${Math.round(blur)}`);
  const segment = parts.length ? parts.join(',') : 'public';
  return `https://imagedelivery.net/${DEMO_ACCOUNT_HASH}/${DEMO_IMAGE_ID}/${segment}`;
}

export function ImagesDeliveryVariantCreatePage() {
  const { setDocsUrl } = useOutletContext<ImagesOutletContext>();
  const navigate = useNavigate();
  const { toasts, add: toast } = useImagesToast();

  useEffect(() => {
    setDocsUrl(DOCS_URL);
    return () => setDocsUrl(null);
  }, [setDocsUrl]);

  const [variantId, setVariantId] = useState('');
  const [rowKeys, setRowKeys] = useState<RowKey[]>(['width', 'height', 'fit', 'metadata']);
  const [values, setValues] = useState<Record<RowKey, string>>({ ...ROW_DEFAULTS });
  const [watermark, setWatermark] = useState(false);
  const [publicAccess, setPublicAccess] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const availableToAdd = useMemo(
    () => ROW_CATALOG.filter((r) => r.addable && !rowKeys.includes(r.key)),
    [rowKeys],
  );

  const removeRow = (key: RowKey) => setRowKeys((prev) => prev.filter((k) => k !== key));
  const addRow = (key: RowKey) => {
    setRowKeys((prev) => [...prev, key]);
    setAddMenuOpen(false);
  };
  const setValue = (key: RowKey, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const activeValues = useMemo(() => {
    const out: Partial<Record<RowKey, string>> = {};
    for (const k of rowKeys) out[k] = values[k];
    return out;
  }, [rowKeys, values]);

  const previewUrl = useMemo(() => buildFlexiblePreviewUrl(activeValues), [activeValues]);

  const onCreate = async () => {
    const id = variantId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 99);
    if (!id) {
      toast('Enter a variant id', 'err');
      return;
    }
    const w = Number(values.width);
    const h = Number(values.height);
    if ((!Number.isFinite(w) || w < 1) && (!Number.isFinite(h) || h < 1)) {
      toast('Width and/or height required', 'err');
      return;
    }
    if (watermark) {
      // CF account watermark is a dashboard setting; our .draw() path is Edit-only.
    }
    setCreating(true);
    try {
      const result = await createNamedVariant({
        id,
        width: Number.isFinite(w) && w >= 1 ? Math.round(w) : undefined,
        height: Number.isFinite(h) && h >= 1 ? Math.round(h) : undefined,
        fit: values.fit || 'scale-down',
        metadata: values.metadata || 'copyright',
        neverRequireSignedURLs: publicAccess,
      });
      if (!result.ok) {
        toast(result.error || 'Create failed', 'err');
        return;
      }
      toast(`Variant “${id}” created`);
      navigate('/dashboard/images/delivery');
    } finally {
      setCreating(false);
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
    borderRadius: 6,
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-panel)',
  };

  const rowWrap: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 14,
  };

  const trashBtn = (onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove"
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px',
        marginTop: 2,
        borderRadius: 6,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        color: 'var(--text-muted)',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <Trash2 size={13} />
    </button>
  );

  const renderRow = (key: RowKey) => {
    const catalogEntry = ROW_CATALOG.find((r) => r.key === key)!;
    if (key === 'fit') {
      const selected = FIT_OPTIONS.find((o) => o.value === values.fit);
      return (
        <div key={key} style={rowWrap}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={fieldLabel}>{catalogEntry.label}</label>
            <Dropdown value={values.fit} options={FIT_OPTIONS} onChange={(v) => setValue('fit', v)} />
            {selected ? (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>{selected.help}</div>
            ) : null}
          </div>
          {trashBtn(() => removeRow('fit'))}
        </div>
      );
    }
    if (key === 'metadata') {
      const selected = METADATA_OPTIONS.find((o) => o.value === values.metadata);
      return (
        <div key={key} style={rowWrap}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={fieldLabel}>{catalogEntry.label}</label>
            <Dropdown value={values.metadata} options={METADATA_OPTIONS} onChange={(v) => setValue('metadata', v)} />
            {selected ? (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>{selected.help}</div>
            ) : null}
          </div>
          {trashBtn(() => removeRow('metadata'))}
        </div>
      );
    }
    // width / height / blur — plain numeric fields
    return (
      <div key={key} style={rowWrap}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label style={fieldLabel}>{catalogEntry.label}</label>
          <input
            type="number"
            min={key === 'blur' ? 0 : 1}
            max={key === 'blur' ? 250 : 4096}
            value={values[key]}
            onChange={(e) => setValue(key, e.target.value)}
            style={input}
          />
        </div>
        {trashBtn(() => removeRow(key))}
      </div>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 24px 32px' }}>
      <Breadcrumb
        items={[
          { label: 'Hosted images', to: '/dashboard/images/storage', icon: true },
          { label: 'Variants', to: '/dashboard/images/delivery' },
          { label: 'Create variant' },
        ]}
      />

      <h2 style={{ margin: '0 0 18px', fontSize: 18, fontWeight: 600 }}>Create a variant</h2>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 420px) minmax(280px, 900px)',
          gap: 24,
          alignItems: 'start',
        }}
      >
        {/* Configuration */}
        <div style={{ ...card, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Configuration</div>

          <label style={fieldLabel}>Variant ID</label>
          <input
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            placeholder="e.g. product_thumb"
            style={{ ...input, marginBottom: 6 }}
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.45 }}>
            Name your variant. The variant ID cannot be changed after it has been created.
          </div>

          {rowKeys.map(renderRow)}

          <div style={{ position: 'relative', marginBottom: 20 }}>
            <button
              type="button"
              onClick={() => setAddMenuOpen((o) => !o)}
              disabled={!availableToAdd.length}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 12px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-elevated)',
                color: availableToAdd.length ? 'var(--text-main)' : 'var(--text-muted)',
                fontSize: 12,
                fontWeight: 500,
                cursor: availableToAdd.length ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
              }}
            >
              <Plus size={13} />
              Add
            </button>
            {addMenuOpen && availableToAdd.length ? (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  zIndex: 20,
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-elevated)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                  minWidth: 160,
                  overflow: 'hidden',
                }}
              >
                {availableToAdd.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => addRow(r.key)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-main)',
                      fontSize: 12,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div style={{ ...card, padding: 14, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>Watermark</span>
            <Toggle checked={watermark} onChange={setWatermark} label="Watermark" />
          </div>

          <div style={{ ...card, padding: 14, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 500 }}>Always allow public access</span>
              <Toggle checked={publicAccess} onChange={setPublicAccess} label="Always allow public access" />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
              Checking "Always allow public access" overrides image-level access control. If checked,
              images that require signed URLs can be accessed publicly.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => navigate('/dashboard/images/delivery')}
              style={{
                flex: 1,
                padding: '9px 12px',
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
              disabled={creating}
              onClick={() => void onCreate()}
              style={{
                flex: 1,
                padding: '9px 12px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--solar-cyan)',
                color: '#000',
                fontSize: 12,
                fontWeight: 600,
                cursor: creating ? 'wait' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>

        {/* Preview — single card, capped width so it doesn't stretch into a dead gutter */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Preview</div>
          <div style={{ ...card, overflow: 'hidden' }}>
            <img
              key={previewUrl}
              src={previewUrl}
              alt="Live variant preview"
              style={{ display: 'block', width: '100%', height: 'auto' }}
            />
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            {values.width || '—'} × {values.height || '—'}
          </div>
        </div>
      </div>

      <ImagesToastStack toasts={toasts} />
    </div>
  );
}

export default ImagesDeliveryVariantCreatePage;
