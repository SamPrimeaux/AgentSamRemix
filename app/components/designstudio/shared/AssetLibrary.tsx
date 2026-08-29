import React, { useEffect, useState } from 'react';
import {
  Activity,
  Box,
  Link,
  Package,
  Plane,
  Plus,
  Shield,
  Trash2,
} from 'lucide-react';
import { GlbAssetThumb } from '../cad-studio/editors/GlbAssetThumb';
import { AGENT_SAM_GENERATOR_KEYS } from '../../../utils/agentSamGenerators';
import type { AgentSamGeneratorKey } from '../../../utils/agentSamGenerators';
import type { CustomAsset } from '../../../types';
import { normalizeGlbUrl } from '@inneranimalmedia/client-3d-runtime/assets';

export type StudioStockAsset = {
  id: string;
  name: string;
  url: string;
  scale: number;
  iconKey: string | null;
  tags: string | null;
  /** Poster/thumbnail only — never use model url for card preview */
  thumbnailUrl: string | null;
};

function normalizeThumbnailUrl(input: string | null | undefined): string | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (s.startsWith('/')) return s;
  try {
    const base =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://inneranimalmedia.com';
    const u = new URL(s, base);
    if (u.hostname.includes('inneranimalmedia.com') && u.pathname.startsWith('/assets/')) {
      return u.pathname;
    }
    return u.href;
  } catch {
    return s;
  }
}

function parseStudioAssetApiRow(row: {
  id?: string;
  label?: string;
  public_url?: string;
  thumbnail_url?: string | null;
  icon?: string | null;
  scale?: number;
  tags?: string | null;
}): StudioStockAsset | null {
  const id = String(row.id || '').trim();
  const url = normalizeGlbUrl(row.public_url);
  if (!id || !url) return null;
  const name = String(row.label || id).trim() || id;
  const scale =
    typeof row.scale === 'number' && Number.isFinite(row.scale) && row.scale > 0 ? row.scale : 1;
  const iconKey = row.icon != null && String(row.icon).trim() ? String(row.icon).trim() : null;
  const tags = row.tags != null && String(row.tags).trim() ? String(row.tags).trim() : null;
  const thumbnailUrl = normalizeThumbnailUrl(row.thumbnail_url);
  return { id, name, url, scale, iconKey, tags, thumbnailUrl };
}

function studioAssetIcon(iconKey: string | null): React.ReactNode {
  const k = String(iconKey || '').toLowerCase();
  switch (k) {
    case 'shield':
    case 'building':
      return <Shield size={14} />;
    case 'activity':
      return <Activity size={14} />;
    case 'plane':
      return <Plane size={14} />;
    case 'link':
      return <Link size={14} />;
    default:
      return <Box size={14} />;
  }
}

type Props = {
  customAssets: CustomAsset[];
  onSpawnModel: (name: string, url: string, scale: number) => void;
  onSpawnProcedural?: (key: AgentSamGeneratorKey) => void;
  onAddCustomAsset: (name: string, url: string) => void | Promise<void>;
  onRemoveCustomAsset: (id: string) => void | Promise<void>;
  onRefreshUserAssets?: () => void;
  showDirectUrlLoader?: boolean;
};

export function AssetLibrary({
  customAssets,
  onSpawnModel,
  onSpawnProcedural,
  onAddCustomAsset,
  onRemoveCustomAsset,
  onRefreshUserAssets,
  showDirectUrlLoader = true,
}: Props) {
  const [newAssetName, setNewAssetName] = useState('');
  const [newAssetUrl, setNewAssetUrl] = useState('');
  const [directUrl, setDirectUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [stockAssets, setStockAssets] = useState<StudioStockAsset[]>([]);
  const [stockAssetsLoading, setStockAssetsLoading] = useState(true);

  useEffect(() => {
    setStockAssetsLoading(true);
    fetch('/api/designstudio/assets?category=3d_studio&is_live=1', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        const rows = Array.isArray(data?.results) ? data.results : [];
        const parsed = rows
          .map((row: Parameters<typeof parseStudioAssetApiRow>[0]) => parseStudioAssetApiRow(row))
          .filter((a): a is StudioStockAsset => a != null);
        const byUrl = new Map<string, StudioStockAsset>();
        for (const a of parsed) {
          const k = a.url.trim().toLowerCase();
          if (!k || byUrl.has(k)) continue;
          byUrl.set(k, a);
        }
        setStockAssets(Array.from(byUrl.values()));
      })
      .catch((e) => console.warn('[Asset Library] stock fetch failed', e))
      .finally(() => setStockAssetsLoading(false));
  }, []);

  useEffect(() => {
    onRefreshUserAssets?.();
  }, [onRefreshUserAssets]);

  const handleQuickSpawn = () => {
    if (newAssetUrl) onSpawnModel(newAssetName || 'Imported Asset', newAssetUrl, 1);
  };

  const handleDirectSpawn = () => {
    if (directUrl.trim()) {
      onSpawnModel('Remote Asset', directUrl.trim(), 1);
      setDirectUrl('');
    }
  };

  const handleAddAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newAssetName && newAssetUrl) {
      try {
        await onAddCustomAsset(newAssetName, newAssetUrl);
        setNewAssetName('');
        setNewAssetUrl('');
        setIsAdding(false);
      } catch (err) {
        console.warn('[Asset Library] save failed', err);
      }
    }
  };

  const astronautAssets = stockAssets.filter((a) =>
    String(a.tags || '').toLowerCase().includes('astronaut'),
  );
  const otherStockAssets = stockAssets.filter(
    (a) => !String(a.tags || '').toLowerCase().includes('astronaut'),
  );

  const renderStockCard = (asset: StudioStockAsset) => (
    <button
      type="button"
      key={asset.id}
      onClick={() => onSpawnModel(asset.name, asset.url, asset.scale)}
      className="cad-assets__card asset-library__stock-card"
      title={asset.name}
    >
      <div className="cad-assets__thumb asset-library__thumb">
        <GlbAssetThumb url={asset.url} thumbnail={asset.thumbnailUrl} alt={asset.name} />
      </div>
      <div className="cad-assets__meta asset-library__meta">
        <span className="cad-assets__name">{asset.name}</span>
      </div>
    </button>
  );

  return (
    <>
      {showDirectUrlLoader && (
        <section className="bg-gradient-to-br from-indigo-500/10 to-blue-500/5 p-4 rounded-2xl border border-[var(--border-subtle)] space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Link size={14} className="text-[var(--solar-cyan)]" />
            <p className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">
              Direct URL Loader
            </p>
          </div>
          <input
            type="url"
            placeholder="https://.../model.glb"
            className="w-full bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-[11px] font-mono text-[var(--solar-cyan)] focus:outline-none focus:border-[var(--solar-cyan)]/50"
            value={directUrl}
            onChange={(e) => setDirectUrl(e.target.value)}
          />
          <button
            type="button"
            onClick={handleDirectSpawn}
            disabled={!directUrl.trim()}
            className="w-full bg-[var(--solar-cyan)] hover:opacity-90 disabled:opacity-30 text-black py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wide flex items-center justify-center gap-2"
          >
            <Plus size={14} />
            Deploy to Scene
          </button>
        </section>
      )}

      <section className="bg-[var(--bg-hover)] p-4 rounded-2xl border border-[var(--border-subtle)] space-y-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Package size={14} className="text-[var(--solar-green)]" />
            <p className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">
              Asset Library
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsAdding(!isAdding)}
            className={`p-1 rounded-md ${isAdding ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}
          >
            <Plus size={14} className={isAdding ? 'rotate-45 transition-transform' : ''} />
          </button>
        </div>

        {isAdding && (
          <form onSubmit={handleAddAsset} className="space-y-2 p-3 bg-[var(--bg-app)] rounded-xl border border-[var(--border-subtle)]">
            <input
              type="text"
              placeholder="Name"
              className="w-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[11px]"
              value={newAssetName}
              onChange={(e) => setNewAssetName(e.target.value)}
            />
            <input
              type="url"
              placeholder="https://.../model.glb"
              className="w-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[11px] font-mono"
              value={newAssetUrl}
              onChange={(e) => setNewAssetUrl(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleQuickSpawn}
                disabled={!newAssetUrl}
                className="flex-1 bg-[var(--text-main)] text-[var(--bg-app)] py-2 rounded-lg text-[9px] font-black uppercase disabled:opacity-30"
              >
                Quick Spawn
              </button>
              <button
                type="submit"
                disabled={!newAssetUrl || !newAssetName}
                className="flex-1 bg-emerald-500 text-black py-2 rounded-lg text-[9px] font-black uppercase disabled:opacity-30"
              >
                Save to List
              </button>
            </div>
          </form>
        )}

        <p className="text-[9px] font-bold text-muted uppercase mb-1">
          AgentSam Procedural
        </p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {AGENT_SAM_GENERATOR_KEYS.map((key) => (
            <button
              type="button"
              key={key}
              disabled={!onSpawnProcedural}
              onClick={() => onSpawnProcedural?.(key)}
              className="flex items-center justify-center gap-2 p-2 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-[10px] font-bold uppercase disabled:opacity-40"
            >
              <Box size={14} className="text-[var(--solar-cyan)] shrink-0" />
              {key}
            </button>
          ))}
        </div>

        <p className="text-[9px] font-bold text-muted uppercase mb-1">
          Stock Presets
          {!stockAssetsLoading && stockAssets.length > 0 ? (
            <span className="text-muted font-normal normal-case ml-1">
              ({stockAssets.length})
            </span>
          ) : null}
        </p>
        <div className="asset-library__stock-grid max-h-[320px] overflow-y-auto pr-1">
          {stockAssetsLoading && (
            <p className="text-[10px] text-muted px-2 py-1">Loading presets…</p>
          )}
          {!stockAssetsLoading && stockAssets.length === 0 && (
            <p className="text-[10px] text-muted px-2 py-1">
              No live stock assets in D1 (<code className="font-mono">3d_studio</code>).
            </p>
          )}
          {!stockAssetsLoading && astronautAssets.length > 0 && (
            <>
              <p className="text-[9px] font-bold text-muted uppercase px-1">
                Astronaut Pack ({astronautAssets.length})
              </p>
              <div className="asset-library__stock-row">
                {astronautAssets.map((asset) => renderStockCard(asset))}
              </div>
            </>
          )}
          {!stockAssetsLoading && otherStockAssets.length > 0 && (
            <>
              <p className="text-[9px] font-bold text-muted uppercase px-1 mt-2">
                Other Stock ({otherStockAssets.length})
              </p>
              <div className="asset-library__stock-row">
                {otherStockAssets.map((asset) => renderStockCard(asset))}
              </div>
            </>
          )}
          {customAssets.length > 0 && (
            <p className="text-[9px] font-bold text-muted uppercase mb-1 mt-2">Your Assets</p>
          )}
          {customAssets.map((asset) => (
            <div key={asset.id} className="group relative flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSpawnModel(asset.name, asset.url, asset.scale ?? 1)}
                className="flex-1 flex items-center gap-3 p-2 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[10px] font-bold uppercase text-left"
              >
                <span className="text-[var(--solar-cyan)] shrink-0">{studioAssetIcon('link')}</span>
                {asset.name}
              </button>
              <button
                type="button"
                onClick={() => void onRemoveCustomAsset(asset.id)}
                className="p-2 text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 rounded-lg"
                title="Remove"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
