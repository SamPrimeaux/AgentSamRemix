import React, { useMemo } from 'react';
import type { LessonAsset } from '../learn.types';

function groupAssets(assets: LessonAsset[]) {
  const m = new Map<string, LessonAsset[]>();
  for (const a of assets || []) {
    const t = String(a?.asset_type || 'asset');
    if (!m.has(t)) m.set(t, []);
    m.get(t)!.push(a);
  }
  for (const [k, v] of m.entries()) {
    v.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    m.set(k, v);
  }
  return m;
}

function AssetRow({ a }: { a: LessonAsset }) {
  const label = a.file_name || a.r2_key || a.asset_url || 'asset';
  const href = a.asset_url || null;
  return (
    <a
      href={href || undefined}
      target={href ? '_blank' : undefined}
      rel={href ? 'noreferrer' : undefined}
      className="learn-asset-row"
      onClick={(e) => {
        if (!href) e.preventDefault();
      }}
    >
      <div className="learn-asset-row__label" title={label}>
        {label}
      </div>
      <div className="learn-asset-row__meta">
        {a.mime_type ? <span className="learn-asset-pill">{a.mime_type}</span> : null}
        {a.file_size ? <span className="learn-asset-pill">{Math.round(a.file_size / 1024)}kb</span> : null}
      </div>
    </a>
  );
}

export function LessonAssetsView({ assets }: { assets: LessonAsset[] }) {
  const groups = useMemo(() => groupAssets(assets || []), [assets]);
  const keys = [...groups.keys()];

  if (!assets?.length) {
    return <div className="learn-muted">No assets attached to this lesson.</div>;
  }

  return (
    <div className="learn-assets">
      {keys.map((k) => (
        <div key={k} className="learn-asset-group">
          <div className="learn-asset-group__title">{k}</div>
          <div className="learn-asset-group__list">
            {(groups.get(k) || []).map((a, i) => (
              <AssetRow key={a.id || `${a.lesson_id}:${k}:${i}`} a={a} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

