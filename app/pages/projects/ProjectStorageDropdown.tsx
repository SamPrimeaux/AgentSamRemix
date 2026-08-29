import React, { useEffect, useMemo, useRef } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { AppIcon } from '../../components/ui/AppIcon';
import type { ProjectStorageScope } from './projectDetailMeta';
import {
  storageSourceLabel,
  type ProjectStoragePref,
  type ProjectWorkContextBindings,
} from './projectStoragePreferences';

export type ProjectStorageConnection = {
  id: string;
  providerKey: string;
  label: string;
  detail: string;
  configured: boolean;
};

type ProjectStorageDropdownProps = {
  open: boolean;
  isMobile: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  scope: ProjectStorageScope | null;
  bindings: ProjectWorkContextBindings | null;
  pref: ProjectStoragePref | null;
  draft: ProjectStoragePref;
  busy: boolean;
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  onDraftChange: (next: ProjectStoragePref) => void;
  onClose: () => void;
  onSave: () => void;
  onOpenAssetBrowser: () => void;
};

function trimOrEmpty(value: string | null | undefined): string {
  return value != null ? String(value).trim() : '';
}

export function projectStorageConnections(
  scope: ProjectStorageScope | null,
  bindings: ProjectWorkContextBindings | null,
): ProjectStorageConnection[] {
  const bucket = scope?.bucket || trimOrEmpty(bindings?.r2Bucket) || '';
  const prefix = scope?.prefix || trimOrEmpty(bindings?.r2Prefix) || '';
  const worker = trimOrEmpty(bindings?.workerName);
  const d1 = trimOrEmpty(bindings?.d1DatabaseId) || trimOrEmpty(bindings?.d1Binding);
  const kv = trimOrEmpty(bindings?.kvNamespaceId);
  const github = trimOrEmpty(bindings?.githubRepo);

  return [
    {
      id: 'r2',
      providerKey: 'cloudflare_r2',
      label: 'Cloudflare R2',
      detail: bucket ? (prefix ? `${bucket} · ${prefix}` : bucket) : 'Not configured',
      configured: Boolean(bucket),
    },
    {
      id: 'worker',
      providerKey: 'cloudflare_workers',
      label: 'Cloudflare Worker',
      detail: worker || 'Not configured',
      configured: Boolean(worker),
    },
    {
      id: 'd1',
      providerKey: 'cloudflare_d1',
      label: 'Cloudflare D1',
      detail: d1 || 'Not configured',
      configured: Boolean(d1),
    },
    {
      id: 'kv',
      providerKey: 'cloudflare_kv',
      label: 'Cloudflare KV',
      detail: kv ? 'Connected' : 'Not configured',
      configured: Boolean(kv),
    },
    {
      id: 'github',
      providerKey: 'github',
      label: 'GitHub',
      detail: github || 'Not configured',
      configured: Boolean(github),
    },
  ];
}

export function ProjectStorageDropdown({
  open,
  isMobile,
  anchorRef,
  scope,
  bindings,
  pref,
  draft,
  busy,
  advancedOpen,
  onAdvancedOpenChange,
  onDraftChange,
  onClose,
  onSave,
  onOpenAssetBrowser,
}: ProjectStorageDropdownProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const connections = useMemo(
    () => projectStorageConnections(scope, bindings),
    [scope, bindings],
  );
  const configuredCount = connections.filter((c) => c.configured).length;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const bucket = scope?.bucket || '—';
  const prefix = scope?.prefix || '—';
  const panelClass = isMobile
    ? 'cpd-storage-panel cpd-storage-panel--sheet'
    : 'cpd-storage-panel';

  return (
    <div
      ref={panelRef}
      className={panelClass}
      role="dialog"
      aria-label="Project storage"
    >
      <div className="cpd-storage-panel-head">
        <AppIcon
          title="Cloudflare"
          providerKey="cloudflare"
          iconSlug="cloudflare"
          size="sm"
          presentation="brand"
        />
        <div className="cpd-storage-panel-head-copy">
          <strong>Project storage</strong>
          <span>
            {configuredCount > 0
              ? `${configuredCount} connection${configuredCount === 1 ? '' : 's'} for this project`
              : 'No connections configured yet'}
          </span>
        </div>
      </div>

      <div className="cpd-storage-summary">
        <div className="cpd-storage-summary-row">
          <span>Bucket</span>
          <code>{bucket}</code>
        </div>
        <div className="cpd-storage-summary-row">
          <span>Prefix</span>
          <code>{prefix}</code>
        </div>
        <div className="cpd-storage-summary-row">
          <span>Source</span>
          <span>{storageSourceLabel(pref?.source ?? draft.source ?? 'auto')}</span>
        </div>
      </div>

      <div className="cpd-storage-connections" aria-label="Project connections">
        {connections.map((connection) => (
          <div
            key={connection.id}
            className={`cpd-storage-connection${connection.configured ? '' : ' cpd-storage-connection--empty'}`}
          >
            <AppIcon
              title={connection.label}
              providerKey={connection.providerKey}
              iconSlug={connection.providerKey}
              size="sm"
              presentation="brand"
            />
            <div className="cpd-storage-connection-copy">
              <strong>{connection.label}</strong>
              <span>{connection.detail}</span>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="cpd-storage-advanced-toggle"
        aria-expanded={advancedOpen}
        onClick={() => onAdvancedOpenChange(!advancedOpen)}
      >
        <ChevronDown
          size={14}
          strokeWidth={1.75}
          className={advancedOpen ? 'cpd-storage-advanced-chevron--open' : undefined}
        />
        Advanced preferences
      </button>

      {advancedOpen ? (
        <div className="cpd-storage-advanced">
          <p className="cpd-storage-advanced-note">
            Saved in this browser only. Defaults come from your project workspace settings.
          </p>
          <label className="cpd-editor-field">
            <span>Storage source</span>
            <select
              className="cpd-editor-input"
              value={draft.source ?? 'auto'}
              onChange={(e) =>
                onDraftChange({
                  ...draft,
                  source: e.target.value as ProjectStoragePref['source'],
                })
              }
            >
              <option value="auto">Project workspace</option>
              <option value="platform_r2">Platform bucket</option>
              <option value="client_r2">Custom bucket</option>
            </select>
          </label>
          <label className="cpd-editor-field">
            <span>Bucket override</span>
            <input
              className="cpd-editor-input"
              value={draft.bucket ?? ''}
              placeholder="e.g. my-bucket"
              onChange={(e) => onDraftChange({ ...draft, bucket: e.target.value })}
            />
          </label>
          <label className="cpd-editor-field">
            <span>Key prefix</span>
            <input
              className="cpd-editor-input"
              value={draft.prefix ?? ''}
              placeholder="e.g. brand/my-project/"
              onChange={(e) => onDraftChange({ ...draft, prefix: e.target.value })}
            />
          </label>
          <div className="cpd-storage-panel-actions">
            <button type="button" className="cpd-btn cpd-btn--ghost sm" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="cpd-btn cpd-btn--primary sm"
              disabled={busy}
              onClick={() => void onSave()}
            >
              {busy ? 'Saving…' : 'Save preferences'}
            </button>
          </div>
        </div>
      ) : (
        <div className="cpd-storage-panel-actions">
          <button type="button" className="cpd-btn cpd-btn--ghost sm" onClick={onClose}>
            Close
          </button>
          <button type="button" className="cpd-btn cpd-btn--ghost sm" onClick={onOpenAssetBrowser}>
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
            Open asset browser
          </button>
        </div>
      )}
    </div>
  );
}
