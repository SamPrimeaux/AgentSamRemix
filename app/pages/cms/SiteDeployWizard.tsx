/**
 * SiteDeployWizard — 7-step site provisioning (Site → Infra → Repo → Domain → CMS → Review → Deploy).
 * POST /api/cms/projects/create + optional POST /api/cms/liquid-imports/upload for theme .zip.
 */
import React, { useState, useCallback, useRef, useId, useEffect, useMemo } from 'react';
import {
  Check,
  Plus,
  Upload,
  Users,
  Zap,
  Link2,
  SkipForward,
  Globe,
  Lock,
  Clock,
  LayoutTemplate,
  Square,
  LayoutGrid,
  Database,
  Github,
  Layout,
  Bot,
  X,
  FileArchive,
  ExternalLink,
  Pencil,
  Sparkles,
  ChevronLeft,
  Monitor,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { AppIcon } from '../../components/ui/AppIcon';
import { fetchConnectTiles } from '../../client-api/connectTiles';
import { openIntegrationOAuthPopup } from '../../src/lib/integrationOAuthPopup';
import { CfStackWizard } from '../../components/settings/sections/CfStackWizard';
import '../../components/ui/AppIcon.css';
import './SiteDeployWizard.css';

interface ImportZipState {
  file: File | null;
  error: string | null;
}

type HostingLane = 'platform_shared' | 'isolated_build' | 'localhost_dev';

interface WState {
  hosting: HostingLane;
  localDevPort: string;
  site: { name: string; slug: string; type: 'new' | 'import' | 'client'; _se?: boolean };
  importZip: ImportZipState;
  infra: { worker: 'existing' | 'new'; workerName: string; bucket: 'cms' | 'new'; kv: boolean };
  repo: { mode: 'existing' | 'new' | 'skip'; org: string; repoName: string; branch: string; builds: boolean };
  domain: { mode: 'subdomain' | 'custom' | 'later'; sub: string; custom: string; cf: boolean };
  cms: { tpl: 'blank' | 'starter' | 'shopify'; secs: string[]; agentic: boolean; pipeline: boolean };
  deploy: { status: 'idle' | 'running' | 'done' | 'error'; error?: string; importUploaded?: boolean; importId?: string; sectionsMapped?: number };
  pkg: {
    phase: 'idle' | 'running' | 'ready' | 'error';
    error?: string;
    packageId?: string;
    manifest?: Record<string, unknown> & {
      categories?: Record<string, number>;
      templates?: Array<{ name: string; section_order?: string[] }>;
      default_template?: string;
      default_section_keys?: string[];
      entries_total?: number;
    };
    liquidSections?: Array<{ id: string; section_key: string }>;
    proceedTargets?: {
      db_targets?: Array<{ id: string; label: string; database_id?: string | null }>;
      r2_targets?: Array<{ id: string; label: string; bucket?: string }>;
      worker_targets?: Array<{ id: string; label: string; worker_name?: string }>;
    };
    selectedSections: string[];
    selectedTemplate: string;
    dbTarget: string;
    databaseId: string;
    r2Target: string;
    workerTarget: string;
  };
}

const STEPS = ['Site', 'Infra', 'Repo', 'Domain', 'CMS', 'Review', 'Deploy'];
const EXPRESS_STEPS = ['Site', 'Inventory', 'Proceed'];
const ALL_SECS = ['hero', 'nav', 'features', 'pricing', 'testimonials', 'cta', 'footer', 'gallery', 'faq'];
const ZIP_ACCEPT = '.zip,.tar.gz,.tgz,.tar';
const ZIP_MAX_MB = 80;

const INIT: WState = {
  hosting: 'platform_shared',
  localDevPort: '8787',
  site: { name: '', slug: '', type: 'new' },
  importZip: { file: null, error: null },
  infra: { worker: 'existing', workerName: '', bucket: 'cms', kv: false },
  repo: { mode: 'skip', org: '', repoName: '', branch: 'main', builds: true },
  domain: { mode: 'subdomain', sub: '', custom: '', cf: true },
  cms: { tpl: 'starter', secs: ['hero', 'nav', 'cta'], agentic: true, pipeline: true },
  deploy: { status: 'idle' },
  pkg: {
    phase: 'idle',
    selectedSections: [],
    selectedTemplate: 'index',
    dbTarget: 'platform',
    databaseId: '',
    r2Target: 'shared',
    workerTarget: 'shared',
  },
};

function toSlug(s: string) {
  return s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isAllowedZip(file: File) {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.zip') ||
    name.endsWith('.tar.gz') ||
    name.endsWith('.tgz') ||
    name.endsWith('.tar')
  );
}

function slugFromZipName(filename: string) {
  return toSlug(
    filename
      .replace(/\.(zip|tar\.gz|tgz|tar)$/i, '')
      .replace(/-shopify.*/i, '')
      .replace(/-theme$/i, '')
      .replace(/-version.*/i, ''),
  );
}

function applyExpressDefaults(slug: string) {
  return {
    hosting: 'platform_shared' as const,
    infra: { worker: 'existing' as const, workerName: '', bucket: 'cms' as const, kv: false },
    repo: { mode: 'skip' as const, org: '', repoName: '', branch: 'main', builds: false },
    domain: { mode: 'subdomain' as const, sub: slug, custom: '', cf: true },
    cms: { tpl: 'shopify' as const, secs: [] as string[], agentic: true, pipeline: true },
  };
}

function applyHostingLaneDefaults(lane: HostingLane, slug: string) {
  if (lane === 'platform_shared') {
    return {
      hosting: lane,
      infra: { worker: 'existing' as const, workerName: '', bucket: 'cms' as const, kv: false },
      repo: { mode: 'skip' as const, org: '', repoName: '', branch: 'main', builds: false },
      domain: { mode: 'subdomain' as const, sub: slug, custom: '', cf: false },
    };
  }
  if (lane === 'localhost_dev') {
    return {
      hosting: lane,
      infra: { worker: 'existing' as const, workerName: '', bucket: 'cms' as const, kv: false },
      repo: { mode: 'skip' as const, org: '', repoName: '', branch: 'main', builds: false },
      domain: { mode: 'later' as const, sub: slug, custom: '', cf: false },
    };
  }
  return {
    hosting: lane,
    infra: { worker: 'new' as const, workerName: slug ? `${slug}-worker` : '', bucket: 'new' as const, kv: true },
    repo: { mode: 'new' as const, org: '', repoName: slug || '', branch: 'main', builds: true },
    domain: { mode: 'custom' as const, sub: slug, custom: '', cf: true },
  };
}

const ISOLATION_BINDINGS = [
  { iconSlug: 'cloudflare', providerKey: 'cloudflare_workers', title: 'Worker', detail: 'One dedicated Worker script' },
  { iconSlug: 'cloudflare_d1', providerKey: 'cloudflare_d1', title: 'D1', detail: 'Own schema — no cross-tenant tables' },
  { iconSlug: 'cf_r2', providerKey: 'cloudflare_r2', title: 'R2', detail: 'Own bucket + prefix space' },
  { iconSlug: 'cloudflare_kv', providerKey: 'cloudflare_kv', title: 'KV', detail: 'Own namespace key space' },
  { iconSlug: 'github', providerKey: 'github', title: 'GitHub', detail: 'One repo + deploy hook' },
];

function IsolationPatternPanel({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`sw-isolation-panel${compact ? ' sw-isolation-panel--compact' : ''}`}>
      <p className="sw-isolation-panel__lede">
        Companions-style isolation — five bindings + one <code>agentsam_workspace</code> row as SSOT. Uses your
        Cloudflare account (OAuth once, account-wide — CF account id wins).
      </p>
      <ul className="sw-isolation-panel__grid">
        {ISOLATION_BINDINGS.map((row) => (
          <li key={row.title}>
            <AppIcon
              title={row.title}
              iconSlug={row.iconSlug}
              providerKey={row.providerKey}
              size="sm"
              presentation="brand"
            />
            <span>
              <strong>{row.title}</strong>
              <span>{row.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateZipFile(file: File): string | null {
  if (!isAllowedZip(file)) return 'Use a .zip or .tar.gz theme archive';
  if (file.size > ZIP_MAX_MB * 1024 * 1024) return `File must be under ${ZIP_MAX_MB} MB`;
  return null;
}

type CfCredentialSnapshot = {
  cfOAuthConnected: boolean;
  cfStackConfigured: boolean;
  cfAccountDisplay: string | null;
  cfConnectUrl: string | null;
  connecting: boolean;
  connectError: string | null;
};

type BrandIconSpec = {
  iconSlug: string;
  providerKey?: string;
  title: string;
};

async function loadCfCredentialSnapshot(): Promise<
  Pick<CfCredentialSnapshot, 'cfOAuthConnected' | 'cfStackConfigured' | 'cfAccountDisplay' | 'cfConnectUrl'>
> {
  try {
    const res = await fetch('/api/integrations/cloudflare/context', { credentials: 'same-origin' });
    if (!res.ok) return { cfStackConfigured: false };
    const snap = (await res.json()) as {
      connected?: boolean;
      oauth_connected?: boolean;
      stack_configured?: boolean;
      account_display?: string | null;
      connect_url?: string;
    };
    return {
      cfOAuthConnected: Boolean(snap.connected || snap.oauth_connected),
      cfStackConfigured: Boolean(snap.stack_configured),
      cfAccountDisplay: snap.account_display || null,
      cfConnectUrl: snap.connect_url || '/api/integrations/cloudflare/connect',
    };
  } catch {
    return { cfStackConfigured: false };
  }
}

function wizardUsesCfInfra(s: WState, express: boolean): boolean {
  if (s.hosting === 'isolated_build') return true;
  if (s.hosting === 'localhost_dev') return false;
  if (express) {
    return (
      s.pkg.dbTarget !== 'platform' ||
      s.pkg.r2Target !== 'shared' ||
      s.pkg.workerTarget !== 'shared'
    );
  }
  return s.infra.worker === 'new' || s.infra.bucket === 'new' || s.infra.kv || s.repo.builds;
}

function CfCredentialsStrip({
  snapshot,
  needsStack,
  onConnect,
  onConfigureStack,
}: {
  snapshot: CfCredentialSnapshot;
  needsStack?: boolean;
  onConnect: () => void | Promise<void>;
  onConfigureStack: () => void;
}) {
  return (
    <div className="sw-cf-strip">
      <AppIcon
        title="Cloudflare"
        providerKey="cloudflare_oauth"
        iconSlug="cloudflare"
        size="md"
        presentation="brand"
        subtitle={
          snapshot.cfOAuthConnected
            ? snapshot.cfAccountDisplay || 'Connected'
            : 'Authorize to use Workers, R2, D1, and DNS'
        }
        status={snapshot.cfOAuthConnected ? 'ok' : 'warning'}
      />
      <div className="sw-cf-strip__copy">
        <p className="sw-cf-strip__title">Cloudflare credentials</p>
        <p className="sw-cf-strip__sub">
          {snapshot.cfOAuthConnected
            ? needsStack && !snapshot.cfStackConfigured
              ? 'OAuth connected — pick your D1, Worker, and R2 targets in the stack wizard.'
              : 'Your account is linked. IAM can provision Workers, R2, D1, and DNS on your behalf.'
            : 'Connect Cloudflare so this wizard can provision real infrastructure on your account.'}
        </p>
        {snapshot.connectError ? (
          <p className="sw-cf-strip__err">{snapshot.connectError}</p>
        ) : null}
      </div>
      <div className="sw-cf-strip__actions">
        {!snapshot.cfOAuthConnected ? (
          <button type="button" className="sw-cf-strip__btn" disabled={snapshot.connecting} onClick={() => void onConnect()}>
            {snapshot.connecting ? (
              <>
                <Loader2 size={14} className="animate-spin" aria-hidden />
                Connecting…
              </>
            ) : (
              'Connect Cloudflare'
            )}
          </button>
        ) : needsStack && !snapshot.cfStackConfigured ? (
          <button type="button" className="sw-cf-strip__btn sw-cf-strip__btn--ghost" onClick={onConfigureStack}>
            Configure stack
          </button>
        ) : (
          <span className="sw-cf-strip__ok">
            <Check size={14} aria-hidden />
            Ready
          </span>
        )}
      </div>
    </div>
  );
}

function BrandIconSlot({ brand, sel }: { brand: BrandIconSpec; sel?: boolean }) {
  return (
    <div className={`sw-brand-icon${sel ? ' sw-brand-icon--selected' : ''}`}>
      <AppIcon
        title={brand.title}
        providerKey={brand.providerKey}
        iconSlug={brand.iconSlug}
        size="sm"
        presentation="brand"
      />
    </div>
  );
}

/* ── primitives ─────────────────────────────────────────────────────────── */

function Prog({ cur, steps }: { cur: number; steps: string[] }) {
  return (
    <div className="flex items-center mb-8" role="list" aria-label="Setup steps">
      {steps.map((label, i) => (
        <div key={label} className="flex-1 flex flex-col items-center relative" role="listitem">
          {i < steps.length - 1 && (
            <div
              className="absolute top-[14px] left-[50%] w-full h-[1.5px] z-0"
              style={{ background: i < cur ? 'var(--border-accent)' : 'var(--border)' }}
            />
          )}
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium z-[1]"
            style={{
              background: i < cur ? 'var(--fill-accent)' : i === cur ? 'var(--bg-accent)' : 'var(--surface-2)',
              border: `1.5px solid ${i <= cur ? 'var(--border-accent)' : 'var(--border)'}`,
              color: i < cur ? 'white' : i === cur ? 'var(--fill-accent)' : 'var(--text-secondary)',
            }}
          >
            {i < cur ? <Check size={14} strokeWidth={2.5} aria-hidden /> : i + 1}
          </div>
          <span
            className={`text-[11px] mt-1.5 text-center whitespace-nowrap sw-step-label ${
              i === cur ? 'sw-step-label--current' : i < cur ? 'sw-step-label--done' : 'sw-step-label--pending'
            }`}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

function Head({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-[18px] font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h2>
      <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {desc}
      </p>
    </div>
  );
}

function Card({
  sel,
  onClick,
  icon: Icon,
  brand,
  title,
  sub,
}: {
  sel: boolean;
  onClick: () => void;
  icon?: LucideIcon;
  brand?: BrandIconSpec;
  title: React.ReactNode;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl p-4 mb-2.5 cursor-pointer sw-card ${sel ? 'sw-card--selected' : ''}`}
    >
      <div className="flex items-start gap-3">
        {brand ? (
          <BrandIconSlot brand={brand} sel={sel} />
        ) : Icon ? (
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: sel ? 'var(--bg-accent)' : 'var(--surface-1)',
              color: sel ? 'var(--text-accent)' : 'var(--text-secondary)',
            }}
          >
            <Icon size={17} strokeWidth={2} aria-hidden />
          </div>
        ) : null}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[14px] font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            <span className="min-w-0">{title}</span>
            {sel && (
              <span
                className="ml-auto text-[10px] px-2 py-0.5 rounded shrink-0"
                style={{ background: 'var(--bg-accent)', color: 'var(--text-accent)' }}
              >
                selected
              </span>
            )}
          </div>
          <div className="text-[13px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
            {sub}
          </div>
        </div>
      </div>
    </button>
  );
}

function ZipDropZone({
  file,
  error,
  onFile,
  onError,
  onClear,
  compact = false,
}: {
  file: File | null;
  error: string | null;
  onFile: (f: File) => void;
  onError: (msg: string) => void;
  onClear: () => void;
  compact?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const pickFile = useCallback(
    (candidate: File | null | undefined) => {
      if (!candidate) return;
      const err = validateZipFile(candidate);
      if (err) {
        onError(err);
        return;
      }
      onFile(candidate);
    },
    [onError, onFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      pickFile(e.dataTransfer.files?.[0]);
    },
    [pickFile],
  );

  if (file) {
    return (
      <div
        className="rounded-xl px-4 py-3 flex items-center gap-3"
        style={{ background: 'var(--surface-1)', border: '0.5px solid var(--border-accent)' }}
      >
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'var(--bg-accent)', color: 'var(--text-accent)' }}
        >
          <FileArchive size={18} aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
            {file.name}
          </div>
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {formatBytes(file.size)} — ready to import after deploy
          </div>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="p-1.5 rounded-md shrink-0 hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Remove file"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className={compact ? 'mt-1' : 'mt-3'}>
      <label
        htmlFor={inputId}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center rounded-xl cursor-pointer transition-colors sw-dropzone ${
          dragOver ? 'sw-dropzone--active' : ''
        }`}
        style={{
          padding: compact ? '1rem 1.25rem' : '1.25rem 1.5rem',
          minHeight: compact ? 88 : 112,
        }}
      >
        <Upload
          size={compact ? 18 : 22}
          strokeWidth={2}
          style={{ color: dragOver ? 'var(--fill-accent)' : 'var(--text-muted)', marginBottom: 8 }}
          aria-hidden
        />
        <span className="text-[13px] font-semibold text-center" style={{ color: 'var(--text-primary)' }}>
          Drop theme .zip here
        </span>
        <span className="text-[12px] mt-1 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>
          or tap to browse · max {ZIP_MAX_MB} MB
        </span>
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={ZIP_ACCEPT}
        className="sr-only"
        onChange={(e) => {
          pickFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {error ? (
        <p className="text-[12px] mt-2" style={{ color: 'var(--text-danger)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Fld({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-[13px] font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </label>
      {children}
      {hint ? (
        <div className="text-[12px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function Inp({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2.5 text-[14px] rounded-[var(--radius)] outline-none"
      style={{ border: '1px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--text-primary)' }}
      onFocus={(e) => {
        e.target.style.borderColor = 'var(--border-accent)';
      }}
      onBlur={(e) => {
        e.target.style.borderColor = 'var(--border)';
      }}
    />
  );
}

function Tog({ on, onClick, label, sub }: { on: boolean; onClick: () => void; label: string; sub: string }) {
  return (
    <div className="flex items-center justify-between py-2.5" style={{ borderBottom: '0.5px solid var(--border)' }}>
      <div>
        <div className="text-[14px]" style={{ color: 'var(--text-primary)' }}>
          {label}
        </div>
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {sub}
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={on}
        className="ml-4 shrink-0 w-9 h-5 rounded-full relative"
        style={{ background: on ? 'var(--fill-accent)' : 'var(--border-strong)' }}
      >
        <span
          className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white"
          style={{ left: on ? '19px' : '3px', transition: 'left .2s' }}
        />
      </button>
    </div>
  );
}

function Div({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-3 sw-divider">
      <span style={{ flex: 1, height: '1px', background: 'var(--border)', display: 'block' }} />
      {label}
      <span style={{ flex: 1, height: '1px', background: 'var(--border)', display: 'block' }} />
    </div>
  );
}

function Bdg({ children, v = 'opt' }: { children: React.ReactNode; v?: 'opt' | 'new' | 'cn' }) {
  const styles: Record<string, React.CSSProperties> = {
    opt: { background: 'var(--surface-1)', color: 'var(--text-muted)', border: '0.5px solid var(--border)' },
    new: { background: 'var(--bg-success)', color: 'var(--text-success)' },
    cn: { background: 'var(--bg-accent)', color: 'var(--text-accent)' },
  };
  return (
    <span className="text-[11px] px-1.5 py-0.5 rounded ml-1.5 font-medium" style={styles[v]}>
      {children}
    </span>
  );
}

/* ── steps ──────────────────────────────────────────────────────────────── */

function S0({
  s,
  u,
  uZip,
  uHosting,
  onExpressZip,
  express,
}: {
  s: WState;
  u: (p: Partial<WState['site']>) => void;
  uZip: (p: Partial<ImportZipState>) => void;
  uHosting: (lane: HostingLane) => void;
  onExpressZip: (file: File, slug: string) => void;
  express?: boolean;
}) {
  const setZip = useCallback(
    (file: File) => {
      const err = validateZipFile(file);
      if (err) {
        uZip({ file: null, error: err });
        return;
      }
      uZip({ file, error: null });
      const zipSlug = slugFromZipName(file.name);
      const nextName = s.site.name || zipSlug.replace(/-/g, ' ');
      const nextSlug = s.site._se ? s.site.slug : zipSlug || toSlug(nextName);
      u({ type: 'import', name: nextName, slug: nextSlug });
      onExpressZip(file, nextSlug || zipSlug);
    },
    [s.site._se, s.site.name, s.site.slug, u, uZip, onExpressZip],
  );

  return (
    <>
      <Head
        title="What are you building?"
        desc={
          express
            ? 'Name your site and drop a Shopify theme .zip — we extract sections and publish v1 automatically.'
            : 'Give your project a name, drop a theme zip for the fast path, or configure a site step-by-step.'
        }
      />
      <Fld label="Project name" hint="Used as the display name across the CMS and dashboard">
        <Inp
          value={s.site.name}
          placeholder="My site"
          onChange={(v) => u({ name: v, slug: s.site._se ? s.site.slug : toSlug(v) })}
        />
      </Fld>
      <Fld
        label={
          <>
            Project slug <Bdg>auto</Bdg>
          </>
        }
        hint="URL-safe identifier — letters, numbers, hyphens only"
      >
        <Inp value={s.site.slug} placeholder="my-site" onChange={(v) => u({ slug: v, _se: true })} />
      </Fld>
      {!express ? (
        <>
          <Div label="hosting model" />
          <Card
            sel={s.hosting === 'platform_shared'}
            onClick={() => uHosting('platform_shared')}
            brand={{ iconSlug: 'cloudflare', providerKey: 'cloudflare_oauth', title: 'IAM platform' }}
            title="Platform shared (IAM)"
            sub="Uses Inner Animal shared Worker + CMS bucket. No Cloudflare billing on your account — best for prototypes and IAM-hosted sites."
          />
          <Card
            sel={s.hosting === 'isolated_build'}
            onClick={() => uHosting('isolated_build')}
            brand={{ iconSlug: 'cloudflare_workers', providerKey: 'cloudflare_workers', title: 'Isolated build' }}
            title={
              <>
                Isolated build <Bdg v="new">your CF</Bdg>
              </>
            }
            sub="Companions pattern — your Worker, D1, R2, KV, GitHub, and deploy URL. Requires Cloudflare OAuth + stack wizard."
          />
          {s.hosting === 'isolated_build' ? <IsolationPatternPanel compact /> : null}
          <Card
            sel={s.hosting === 'localhost_dev'}
            onClick={() => uHosting('localhost_dev')}
            icon={Monitor}
            title="Localhost dev"
            sub="Registry-only on IAM — run wrangler dev locally. No cloud resources provisioned on platform or your account."
          />
        </>
      ) : null}
      <ZipDropZone
        file={s.importZip.file}
        error={s.importZip.error}
        onFile={setZip}
        onError={(msg) => uZip({ file: null, error: msg })}
        onClear={() => uZip({ file: null, error: null })}
      />
      <Div label="or start without a zip" />
      <Card
        sel={s.site.type === 'new' && !s.importZip.file}
        onClick={() => {
          uZip({ file: null, error: null });
          u({ type: 'new' });
        }}
        icon={Plus}
        title="New site from scratch"
        sub="Starter template or blank canvas — full setup wizard for infra, domain, and CMS."
      />
      <Card
        sel={s.site.type === 'client' && !s.importZip.file}
        onClick={() => {
          uZip({ file: null, error: null });
          u({ type: 'client' });
        }}
        icon={Users}
        title="Client site"
        sub="Tenant-scoped project for a client workspace. Isolated CMS, separate DNS, same infrastructure."
      />
    </>
  );
}

function hostingLaneLabel(lane: HostingLane): string {
  if (lane === 'isolated_build') return 'Isolated build (your Cloudflare)';
  if (lane === 'localhost_dev') return 'Localhost dev (registry only)';
  return 'Platform shared (IAM)';
}

function S1({
  s,
  u,
  uLocalPort,
  cfSnapshot,
  onCfConnect,
  onCfConfigureStack,
}: {
  s: WState;
  u: (p: Partial<WState['infra']>) => void;
  uLocalPort: (port: string) => void;
  cfSnapshot: CfCredentialSnapshot;
  onCfConnect: () => void | Promise<void>;
  onCfConfigureStack: () => void;
}) {
  const slug = s.site.slug || toSlug(s.site.name) || 'my-site';

  if (s.hosting === 'localhost_dev') {
    return (
      <>
        <Head
          title="Local development"
          desc="Register the project on IAM only — run wrangler dev on your machine. No Workers, R2, or DNS are provisioned on the platform or your Cloudflare account."
        />
        <div className="sw-localhost-panel">
          <Monitor size={22} aria-hidden />
          <div>
            <p className="sw-localhost-panel__title">Registry-only lane</p>
            <p className="sw-localhost-panel__sub">
              IAM creates the workspace + CMS registry rows. You bind local wrangler to port{' '}
              <strong>{s.localDevPort || '8787'}</strong> and sync when ready.
            </p>
          </div>
        </div>
        <Fld label="Wrangler dev port" hint="Default 8787 — must match your local wrangler.toml dev port">
          <Inp value={s.localDevPort} placeholder="8787" onChange={uLocalPort} />
        </Fld>
        <div className="sw-platform-lock">
          <Lock size={14} aria-hidden />
          <span>Cloudflare OAuth not required — nothing is billed on IAM or your account from this wizard.</span>
        </div>
      </>
    );
  }

  if (s.hosting === 'platform_shared') {
    return (
      <>
        <Head
          title="Platform infrastructure"
          desc="Uses Inner Animal shared Worker + CMS bucket. Dedicated Workers, R2, KV, and DNS on your account are not provisioned from this lane."
        />
        <div className="sw-platform-lock">
          <Lock size={14} aria-hidden />
          <span>
            Locked to IAM shared resources — connect Cloudflare OAuth on the <strong>Isolated build</strong> lane if
            you need dedicated infrastructure on your account.
          </span>
        </div>
        <Div label="worker" />
        <Card
          sel
          onClick={() => {}}
          brand={{ iconSlug: 'cloudflare', providerKey: 'cloudflare_workers', title: 'Cloudflare Workers' }}
          title="inneranimalmedia (shared Worker)"
          sub="All routes and CMS hydration run on the platform Worker — no new Worker deploy on your account."
        />
        <Div label="R2 storage" />
        <Card
          sel
          onClick={() => {}}
          brand={{ iconSlug: 'cf_r2', providerKey: 'cloudflare_r2', title: 'Shared CMS R2' }}
          title={
            <>
              Shared CMS bucket <Bdg v="cn">cms</Bdg>
            </>
          }
          sub="Draft and published HTML live in the platform CMS bucket — not billed to your Cloudflare account."
        />
      </>
    );
  }

  return (
    <>
      <Head
        title="Isolated build infrastructure"
        desc="Companions-style isolation on your Cloudflare account. OAuth + stack wizard required — IAM will not provision dedicated bindings on the platform account."
      />
      <IsolationPatternPanel />
      <CfCredentialsStrip
        snapshot={cfSnapshot}
        needsStack
        onConnect={onCfConnect}
        onConfigureStack={onCfConfigureStack}
      />
      <Div label="provisioned bindings" />
      <Card
        sel
        onClick={() => {}}
        brand={{ iconSlug: 'cloudflare', providerKey: 'cloudflare_workers', title: 'Dedicated Worker' }}
        title={
          <>
            Worker <Bdg v="new">{s.infra.workerName || `${slug}-worker`}</Bdg>
          </>
        }
        sub="One Worker script + deploy URL — created on your Cloudflare account after stack save."
      />
      <Card
        sel
        onClick={() => {}}
        brand={{ iconSlug: 'cloudflare_d1', providerKey: 'cloudflare_d1', title: 'Dedicated D1' }}
        title="D1 database"
        sub="Own schema — no cross-tenant tables. Registry row on IAM; content plane on your D1."
      />
      <Card
        sel
        onClick={() => {}}
        brand={{ iconSlug: 'cf_r2', providerKey: 'cloudflare_r2', title: 'Dedicated R2' }}
        title={
          <>
            R2 bucket <Bdg v="new">{slug}-assets</Bdg>
          </>
        }
        sub="Isolated prefix space for pages, themes, and media."
      />
      <div className="mt-2 pl-1">
        <div className="flex items-start gap-3">
          <BrandIconSlot brand={{ iconSlug: 'cloudflare_kv', providerKey: 'cloudflare_kv', title: 'Cloudflare KV' }} sel />
          <Tog
            on
            onClick={() => {}}
            label="KV draft cache"
            sub="Included in the isolation pattern — draft CMS state namespace on your account."
          />
        </div>
      </div>
      <Fld label="Worker name">
        <Inp value={s.infra.workerName} placeholder={`${slug}-worker`} onChange={(v) => u({ workerName: v })} />
      </Fld>
    </>
  );
}

function S2({ s, u }: { s: WState; u: (p: Partial<WState['repo']>) => void }) {
  return (
    <>
      <Head
        title="GitHub repository"
        desc="Connect a repo for CI/CD auto-deploys. Skipping this is fine — you can always push manually."
      />
      <Card
        sel={s.repo.mode === 'existing'}
        onClick={() => u({ mode: 'existing' })}
        icon={Link2}
        title="Connect existing repo"
        sub="Link this project to a GitHub repo you already have. Pushes to main auto-deploy."
      />
      <Card
        sel={s.repo.mode === 'new'}
        onClick={() => u({ mode: 'new' })}
        icon={Plus}
        title={
          <>
            Create a new repo <Bdg v="new">new</Bdg>
          </>
        }
        sub="Scaffold a fresh repo under your GitHub org with the correct wrangler config and deploy scripts pre-wired."
      />
      <Card
        sel={s.repo.mode === 'skip'}
        onClick={() => u({ mode: 'skip' })}
        icon={SkipForward}
        title="Skip for now"
        sub="Deploy manually via wrangler deploy. You can connect a repo later from the dashboard."
      />
      {s.repo.mode !== 'skip' ? (
        <div className="mt-4" style={{ borderTop: '0.5px solid var(--border)', paddingTop: '1rem' }}>
          <div className="grid grid-cols-2 gap-2.5 mb-4">
            <Fld label="Organization">
              <Inp value={s.repo.org} placeholder="your-github-org" onChange={(v) => u({ org: v })} />
            </Fld>
            <Fld label="Repo name">
              <Inp value={s.repo.repoName} placeholder="my-site" onChange={(v) => u({ repoName: v })} />
            </Fld>
          </div>
          <Fld label="Deploy branch" hint="Pushes to this branch trigger production deploys">
            <Inp value={s.repo.branch} placeholder="main" onChange={(v) => u({ branch: v })} />
          </Fld>
          <Tog
            on={s.repo.builds}
            onClick={() => u({ builds: !s.repo.builds })}
            label="Connect Cloudflare Builds"
            sub="Auto-deploy on every push without running wrangler locally"
          />
        </div>
      ) : null}
    </>
  );
}

function S3({ s, u }: { s: WState; u: (p: Partial<WState['domain']>) => void }) {
  return (
    <>
      <Head
        title="Domain and DNS"
        desc="Where should this site live? Use a subdomain of inneranimalmedia.com or connect your own."
      />
      <Card
        sel={s.domain.mode === 'subdomain'}
        onClick={() => u({ mode: 'subdomain' })}
        icon={Globe}
        title={
          <>
            Use a subdomain <Bdg v="cn">*.inneranimalmedia.com</Bdg>
          </>
        }
        sub="Quick setup — DNS is managed automatically. Great for prototypes and client previews."
      />
      <Card
        sel={s.domain.mode === 'custom'}
        onClick={() => u({ mode: 'custom' })}
        icon={Lock}
        title="Custom domain"
        sub="Point an existing domain or register a new one. Cloudflare handles SSL automatically once nameservers transfer."
      />
      <Card
        sel={s.domain.mode === 'later'}
        onClick={() => u({ mode: 'later' })}
        icon={Clock}
        title="Set up later"
        sub="Site will be available on the .workers.dev default URL until you attach a domain."
      />
      {s.domain.mode === 'subdomain' ? (
        <div className="mt-4" style={{ borderTop: '0.5px solid var(--border)', paddingTop: '1rem' }}>
          <Fld label="Prefix">
            <div
              className="flex items-center"
              style={{
                border: '0.5px solid var(--border)',
                borderRadius: 'var(--radius)',
                overflow: 'hidden',
                background: 'var(--surface-2)',
              }}
            >
              <input
                type="text"
                value={s.domain.sub}
                onChange={(e) => u({ sub: e.target.value })}
                placeholder="acme"
                className="flex-1 px-3 py-2 text-[14px] outline-none bg-transparent"
                style={{ color: 'var(--text-primary)', border: 'none' }}
              />
              <span
                className="px-3 text-[13px] h-9 flex items-center shrink-0"
                style={{
                  color: 'var(--text-muted)',
                  background: 'var(--surface-1)',
                  borderLeft: '0.5px solid var(--border)',
                }}
              >
                .inneranimalmedia.com
              </span>
            </div>
          </Fld>
          <Tog
            on={s.domain.cf}
            onClick={() => u({ cf: !s.domain.cf })}
            label="Cloudflare proxy (orange cloud)"
            sub="Enable DDoS protection and caching — recommended"
          />
        </div>
      ) : null}
      {s.domain.mode === 'custom' ? (
        <div className="mt-4" style={{ borderTop: '0.5px solid var(--border)', paddingTop: '1rem' }}>
          <Fld label="Domain name" hint="Nameservers must point to Cloudflare. SSL issued automatically.">
            <Inp value={s.domain.custom} placeholder="example.com" onChange={(v) => u({ custom: v })} />
          </Fld>
        </div>
      ) : null}
    </>
  );
}

function S4({
  s,
  u,
  uZip,
}: {
  s: WState;
  u: (p: Partial<WState['cms']>) => void;
  uZip: (p: Partial<ImportZipState>) => void;
}) {
  const toggleSec = useCallback(
    (sec: string) => {
      const next = s.cms.secs.includes(sec) ? s.cms.secs.filter((x) => x !== sec) : [...s.cms.secs, sec];
      u({ secs: next });
    },
    [s.cms.secs, u],
  );

  const setZip = useCallback(
    (file: File) => {
      const err = validateZipFile(file);
      if (err) {
        uZip({ file: null, error: err });
        return;
      }
      uZip({ file, error: null });
      u({ tpl: 'shopify' });
    },
    [u, uZip],
  );

  return (
    <>
      <Head
        title="CMS setup"
        desc="Pick a starting template and choose which sections to scaffold. You can add or remove anything later in the studio."
      />
      <Div label="starting template" />
      <Card
        sel={s.cms.tpl === 'blank'}
        onClick={() => u({ tpl: 'blank' })}
        icon={Square}
        title="Blank canvas"
        sub="No sections pre-loaded — build exactly what you need from the studio or via Agent Sam."
      />
      <Card
        sel={s.cms.tpl === 'starter'}
        onClick={() => u({ tpl: 'starter' })}
        icon={LayoutGrid}
        title={
          <>
            Starter page <Bdg v="new">hero + nav + CTA</Bdg>
          </>
        }
        sub="Three scaffolded sections ready to edit in the Content tab — the fastest path to a live page."
      />
      <Card
        sel={s.cms.tpl === 'shopify'}
        onClick={() => u({ tpl: 'shopify' })}
        icon={Upload}
        title="Import Shopify theme"
        sub="Upload a .zip — the Python pipeline parses sections/*.liquid schema blocks and seeds D1 + R2 automatically."
      />
      {s.cms.tpl === 'shopify' || s.importZip.file ? (
        <ZipDropZone
          compact
          file={s.importZip.file}
          error={s.importZip.error}
          onFile={setZip}
          onError={(msg) => uZip({ file: null, error: msg })}
          onClear={() => uZip({ file: null, error: null })}
        />
      ) : null}
      <Div label="sections to scaffold" />
      <div className="flex flex-wrap gap-1.5 mb-5">
        {ALL_SECS.map((sec) => {
          const on = s.cms.secs.includes(sec);
          return (
            <button
              key={sec}
              type="button"
              onClick={() => toggleSec(sec)}
              className="text-[12px] px-2.5 py-1.5 rounded-full font-medium"
              style={{
                background: on ? 'var(--bg-accent)' : 'var(--surface-1)',
                color: on ? 'var(--text-accent)' : 'var(--text-muted)',
                border: `0.5px solid ${on ? 'var(--border-accent)' : 'var(--border)'}`,
              }}
            >
              {sec}
            </button>
          );
        })}
      </div>
      <Div label="agentic features" />
      <Tog
        on={s.cms.agentic}
        onClick={() => u({ agentic: !s.cms.agentic })}
        label="Agent Sam CMS tools"
        sub="agentsam_cms_read / write / publish available in the agent panel"
      />
      <Tog
        on={s.cms.pipeline}
        onClick={() => u({ pipeline: !s.cms.pipeline })}
        label="Python pipeline"
        sub="iam-cms-pipeline service binding for AI section generation and search"
      />
    </>
  );
}

function S5({ s, goTo, express }: { s: WState; goTo: (i: number) => void; express?: boolean }) {
  const slug = s.site.slug || toSlug(s.site.name) || '—';
  const domain =
    s.domain.mode === 'subdomain'
      ? `${s.domain.sub || slug}.inneranimalmedia.com`
      : s.domain.mode === 'custom'
        ? s.domain.custom || '—'
        : 'workers.dev (set up later)';
  const rows: [string, string, number][] = express
    ? [
        ['Project', s.site.name || '—', 0],
        ['Slug', slug, 0],
        ['Theme zip', s.importZip.file?.name || '—', 0],
        ['Domain', domain, 0],
        ['Path', 'Extract theme → scaffold homepage → publish v1', -1],
      ]
    : [
        ['Project', s.site.name || '—', 0],
        ['Slug', slug, 0],
        ['Hosting', hostingLaneLabel(s.hosting), 0],
        ...(s.hosting === 'localhost_dev'
          ? [['Local port', s.localDevPort || '8787', 1] as [string, string, number]]
          : []),
        ['Type', s.site.type, 0],
        ...(s.importZip.file ? [['Theme zip', s.importZip.file.name, 0] as [string, string, number]] : []),
        ['Worker', s.infra.worker === 'existing' ? 'inneranimalmedia (shared)' : s.infra.workerName || 'new worker', 1],
        ['R2 bucket', s.infra.bucket === 'cms' ? 'cms (shared)' : 'dedicated', 1],
        ['Repository', s.repo.mode === 'skip' ? 'manual deploy' : `${s.repo.org || 'org'}/${s.repo.repoName || 'repo'} (${s.repo.branch || 'main'})`, 2],
        ['Domain', domain, 3],
        ['CMS template', s.cms.tpl === 'blank' ? 'blank canvas' : s.cms.tpl === 'starter' ? 'starter (hero + nav + CTA)' : 'Shopify import', 4],
        ['Sections', s.cms.secs.join(', ') || 'none', 4],
        ['Agent Sam', s.cms.agentic ? 'enabled' : 'disabled', 4],
        ['Python pipeline', s.cms.pipeline ? 'enabled' : 'disabled', 4],
      ];
  return (
    <>
      <Head title="Review your setup" desc="Everything looks good below. Tap any row to go back and edit." />
      <div className="rounded-xl px-5 sw-panel" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
        {rows.map(([label, value, step], i) => (
          <div
            key={label}
            className="flex items-start gap-2.5 py-2.5"
            style={{ borderBottom: i < rows.length - 1 ? '0.5px solid var(--border)' : 'none' }}
          >
            <span className="text-[13px] w-36 shrink-0" style={{ color: 'var(--text-secondary)' }}>
              {label}
            </span>
            <span className="text-[13px] font-medium flex-1 break-all" style={{ color: 'var(--text-primary)' }}>
              {value}
            </span>
            {step >= 0 ? (
              <button
                type="button"
                onClick={() => goTo(step)}
                className="text-[12px] shrink-0 hover:underline"
                style={{ color: 'var(--text-accent)' }}
              >
                Edit
              </button>
            ) : (
              <span className="text-[12px] shrink-0" style={{ color: 'var(--text-muted)' }}>
                auto
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function DeployStepIcon({ icon: Icon, brand }: { icon?: LucideIcon; brand?: BrandIconSpec }) {
  if (brand) {
    return (
      <div className="shrink-0">
        <AppIcon
          title={brand.title}
          providerKey={brand.providerKey}
          iconSlug={brand.iconSlug}
          size="sm"
          presentation="brand"
        />
      </div>
    );
  }
  return (
    <div
      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
      style={{ background: 'var(--surface-1)', color: 'var(--text-secondary)' }}
    >
      {Icon ? <Icon size={16} strokeWidth={2} aria-hidden /> : null}
    </div>
  );
}

function buildDeployItems(s: WState, express: boolean): { icon?: LucideIcon; brand?: BrandIconSpec; label: string; sub: string }[] {
  const slug = s.site.slug || toSlug(s.site.name) || 'my-site';
  const domain =
    s.domain.mode === 'subdomain'
      ? `${s.domain.sub || slug}.inneranimalmedia.com`
      : s.domain.mode === 'custom'
        ? s.domain.custom
        : `${slug}.workers.dev`;

  if (express) {
    return [
      {
        brand: { iconSlug: 'cloudflare_d1', providerKey: 'cloudflare_d1', title: 'Cloudflare D1' },
        label: 'Register project',
        sub: `Workspace entry for ${slug} (platform shared)`,
      },
      { icon: Upload, label: 'Upload theme archive', sub: s.importZip.file?.name || 'theme.zip' },
      { icon: Layout, label: 'Extract & map sections', sub: 'Parse templates/index.json + sections/*.liquid' },
      {
        brand: { iconSlug: 'cloudflare', providerKey: 'cloudflare_oauth', title: 'Cloudflare DNS' },
        label: 'Publish v1 homepage',
        sub: domain,
      },
    ];
  }

  if (s.hosting === 'localhost_dev') {
    return [
      {
        brand: { iconSlug: 'cloudflare_d1', providerKey: 'cloudflare_d1', title: 'IAM registry' },
        label: 'Register project (registry only)',
        sub: 'agentsam_project_context + CMS rows — no cloud seed',
      },
      {
        icon: Monitor,
        label: 'Local wrangler dev',
        sub: `Run wrangler dev --port ${s.localDevPort || '8787'} locally`,
      },
    ];
  }

  if (s.hosting === 'isolated_build') {
    return [
      {
        brand: { iconSlug: 'cloudflare_d1', providerKey: 'cloudflare_d1', title: 'Cloudflare D1' },
        label: 'Register IAM workspace row',
        sub: 'SSOT agentsam_workspace → your bindings',
      },
      {
        brand: { iconSlug: 'cloudflare', providerKey: 'cloudflare_workers', title: 'Cloudflare Workers' },
        label: 'Provision Worker + D1 + R2 + KV',
        sub: `${s.infra.workerName || `${slug}-worker`} on your Cloudflare account`,
      },
      { icon: Github, label: 'Scaffold GitHub repo', sub: `${s.repo.org || 'org'}/${s.repo.repoName || slug}` },
      ...(s.domain.mode !== 'later'
        ? [{
            brand: { iconSlug: 'cloudflare', providerKey: 'cloudflare_oauth', title: 'Cloudflare DNS' },
            label: 'Configure deploy URL',
            sub: domain,
          }]
        : []),
    ];
  }

  return [
    {
      brand: { iconSlug: 'cloudflare_d1', providerKey: 'cloudflare_d1', title: 'Cloudflare D1' },
      label: 'Register project in D1',
      sub: `cms_pages + workspace entry for ${slug}`,
    },
    {
      brand: { iconSlug: 'cloudflare', providerKey: 'cloudflare_workers', title: 'Cloudflare Workers' },
      label: 'Provision Worker route',
      sub: s.infra.worker === 'existing' ? 'Add route to inneranimalmedia Worker' : 'Deploy new Worker',
    },
    ...(s.infra.bucket === 'new'
      ? [{
          brand: { iconSlug: 'cf_r2', providerKey: 'cloudflare_r2', title: 'Cloudflare R2' },
          label: 'Create R2 bucket',
          sub: `${slug}-assets`,
        }]
      : []),
    ...(s.infra.kv
      ? [{
          brand: { iconSlug: 'cloudflare_kv', providerKey: 'cloudflare_kv', title: 'Cloudflare KV' },
          label: 'Enable KV draft cache',
          sub: 'Namespace binding for CMS draft previews',
        }]
      : []),
    ...(s.repo.mode !== 'skip'
      ? [{ icon: Github, label: 'Link GitHub repo', sub: `${s.repo.org || 'org'}/${s.repo.repoName || 'repo'}` }]
      : []),
    ...(s.domain.mode === 'subdomain'
      ? [
          {
            brand: { iconSlug: 'cloudflare', providerKey: 'cloudflare_oauth', title: 'Cloudflare DNS' },
            label: 'Add DNS record',
            sub: `CNAME ${s.domain.sub || slug}.inneranimalmedia.com → inneranimalmedia.com`,
          },
        ]
      : []),
    ...(s.domain.mode === 'custom'
      ? [{
          brand: { iconSlug: 'cloudflare', providerKey: 'cloudflare_oauth', title: 'Cloudflare DNS' },
          label: 'Configure custom domain',
          sub: s.domain.custom,
        }]
      : []),
    ...(s.cms.tpl !== 'shopify' && !s.importZip.file
      ? [
          {
            icon: Layout,
            label: 'Seed CMS pages',
            sub: `Template: ${s.cms.tpl} · Sections: ${s.cms.secs.join(', ') || 'none'}`,
          },
        ]
      : []),
    ...(s.importZip.file
      ? [{ icon: Upload, label: 'Upload theme archive', sub: s.importZip.file.name }]
      : []),
    ...(s.cms.pipeline
      ? [{ icon: Bot, label: 'Register pipeline bindings', sub: 'CMS_PIPELINE service binding + agent tools' }]
      : []),
  ];
}

function S6({
  s,
  onDeploy,
  express,
  cfSnapshot,
  onCfConnect,
  onCfConfigureStack,
}: {
  s: WState;
  onDeploy: () => Promise<void>;
  express?: boolean;
  cfSnapshot: CfCredentialSnapshot;
  onCfConnect: () => void | Promise<void>;
  onCfConfigureStack: () => void;
}) {
  const slug = s.site.slug || toSlug(s.site.name) || 'my-site';
  const domain =
    s.domain.mode === 'subdomain'
      ? `${s.domain.sub || slug}.inneranimalmedia.com`
      : s.domain.mode === 'custom'
        ? s.domain.custom
        : `${slug}.workers.dev`;
  const items = buildDeployItems(s, !!express);

  if (s.deploy.status === 'done') {
    return (
      <>
        <div
          className="rounded-xl p-5 text-center mb-4"
          style={{ background: 'var(--bg-success)', border: '0.5px solid var(--border-success)' }}
        >
          <div className="flex justify-center mb-2" style={{ color: 'var(--text-success)' }}>
            <Check size={32} strokeWidth={2.5} aria-hidden />
          </div>
          <h3 className="text-[16px] font-medium mb-1" style={{ color: 'var(--text-success)' }}>
            Site deployed
          </h3>
          <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            Your site is live and registered in the CMS.
            {s.deploy.importUploaded ? ' Theme extracted and homepage published.' : ''}
            {s.deploy.sectionsMapped ? ` ${s.deploy.sectionsMapped} sections mapped.` : ''}
          </p>
        </div>
        <div className="mb-4">
          <div className="text-[13px] font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
            Live URLs
          </div>
          <a
            href={`https://${domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius)] px-3 py-1.5 text-[13px] mr-2 mb-2 font-mono"
            style={{
              background: 'var(--surface-1)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <ExternalLink size={14} aria-hidden />
            https://{domain}
          </a>
          <a
            href="/dashboard/cms"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius)] px-3 py-1.5 text-[13px] font-mono"
            style={{
              background: 'var(--surface-1)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <Pencil size={14} aria-hidden />
            Open in CMS studio
          </a>
        </div>
        <div className="rounded-xl px-5 py-1" style={{ background: 'var(--surface-2)', border: '0.5px solid var(--border)' }}>
          <div className="text-[13px] font-medium py-3" style={{ color: 'var(--text-secondary)' }}>
            Next steps
          </div>
          {[
            { icon: LayoutTemplate, text: 'Refine sections in the studio' },
            { icon: Sparkles, text: 'Run Python pipeline for richer HTML conversion' },
          ].map(({ icon: Icon, text }) => (
            <div
              key={text}
              className="py-2.5 text-[14px] flex items-center gap-2.5"
              style={{ color: 'var(--text-primary)', borderBottom: '0.5px solid var(--border)' }}
            >
              <Icon size={15} style={{ color: 'var(--text-muted)' }} aria-hidden />
              {text}
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <Head
        title={s.deploy.status === 'running' ? 'Deploying…' : 'Deploy'}
        desc={
          s.deploy.status === 'running'
            ? 'Extracting theme, mapping sections, and publishing your homepage.'
            : express
              ? 'Tap "Deploy now" — usually 30–90 seconds for a full theme zip.'
              : 'Tap "Deploy now" to provision your site end-to-end. This takes about 30–60 seconds.'
        }
      />
      {wizardUsesCfInfra(s, !!express) ? (
        <CfCredentialsStrip
          snapshot={cfSnapshot}
          needsStack={!express && (s.infra.worker === 'new' || s.infra.bucket === 'new')}
          onConnect={onCfConnect}
          onConfigureStack={onCfConfigureStack}
        />
      ) : null}
      <div className="rounded-xl px-5 py-1 mb-4" style={{ background: 'var(--surface-2)', border: '0.5px solid var(--border)' }}>
        {items.map((item, i) => (
          <div
            key={item.label}
            className="flex items-center gap-3 py-3"
            style={{ borderBottom: i < items.length - 1 ? '0.5px solid var(--border)' : 'none' }}
          >
            <DeployStepIcon icon={item.icon} brand={item.brand} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                {item.label}
              </div>
              <div className="text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>
                {item.sub}
              </div>
            </div>
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: s.deploy.status === 'running' ? 'var(--fill-warning)' : 'var(--border-strong)' }}
            />
          </div>
        ))}
      </div>
      {s.deploy.status === 'error' ? (
        <div
          className="rounded-lg p-3 mb-4 text-[13px]"
          style={{
            background: 'var(--bg-danger)',
            border: '0.5px solid var(--border-danger)',
            color: 'var(--text-danger)',
          }}
        >
          {s.deploy.error || 'Deploy failed. Check the terminal for details.'}
        </div>
      ) : null}
    </>
  );
}

/* ── express: inventory + proceed ─────────────────────────────────────────── */

function SInventory({
  s,
  upPkg,
}: {
  s: WState;
  upPkg: (p: Partial<WState['pkg']>) => void;
}) {
  const m = s.pkg.manifest;
  const cats = m?.categories || {};
  const templates = m?.templates || [];
  const toggleSection = (key: string) => {
    const on = s.pkg.selectedSections.includes(key);
    upPkg({
      selectedSections: on
        ? s.pkg.selectedSections.filter((x) => x !== key)
        : [...s.pkg.selectedSections, key],
    });
  };

  if (s.pkg.phase === 'running') {
    return (
      <>
        <Head title="Unpacking theme…" desc="Extracting archive, indexing sections and templates. No live pages yet." />
        <div className="rounded-xl px-5 py-8 text-center sw-panel" style={{ background: 'var(--surface-2)', border: '0.5px solid var(--border)' }}>
          <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>Building site package inventory…</p>
        </div>
      </>
    );
  }

  if (s.pkg.phase === 'error') {
    return (
      <>
        <Head title="Inventory failed" desc="The archive could not be unpacked. Try a different zip or check the error below." />
        <div className="rounded-lg p-3 text-[13px]" style={{ background: 'var(--bg-danger)', color: 'var(--text-danger)' }}>
          {s.pkg.error || 'Unknown error'}
        </div>
      </>
    );
  }

  if (s.pkg.phase !== 'ready') {
    return (
      <>
        <Head title="Theme inventory" desc="Continue to upload and unpack your theme into a browsable site package." />
      </>
    );
  }

  return (
    <>
      <Head
        title="What's in your theme"
        desc={`${m?.entries_total || 0} files indexed — select sections to publish on the next step.`}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {Object.entries(cats).map(([k, v]) => (
          <div key={k} className="rounded-lg px-3 py-2 sw-panel" style={{ background: 'var(--surface-1)', border: '0.5px solid var(--border)' }}>
            <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{k}</div>
            <div className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>{v}</div>
          </div>
        ))}
      </div>
      {templates.length ? (
        <Fld label="Template">
          <select
            value={s.pkg.selectedTemplate}
            onChange={(e) => {
              const name = e.target.value;
              const tpl = templates.find((t) => t.name === name);
              upPkg({
                selectedTemplate: name,
                selectedSections: tpl?.section_order?.length ? [...tpl.section_order] : s.pkg.selectedSections,
              });
            }}
            className="w-full px-3 py-2.5 text-[14px] rounded-[var(--radius)]"
            style={{ border: '1px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--text-primary)' }}
          >
            {templates.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        </Fld>
      ) : null}
      <Div label="sections to publish" />
      <div className="flex flex-wrap gap-1.5 mb-4 max-h-40 overflow-y-auto">
        {(s.pkg.liquidSections || []).map((sec) => {
          const on = s.pkg.selectedSections.includes(sec.section_key);
          return (
            <button
              key={sec.id || sec.section_key}
              type="button"
              onClick={() => toggleSection(sec.section_key)}
              className="text-[12px] px-2.5 py-1.5 rounded-full font-medium"
              style={{
                background: on ? 'var(--bg-accent)' : 'var(--surface-1)',
                color: on ? 'var(--text-accent)' : 'var(--text-muted)',
                border: `0.5px solid ${on ? 'var(--border-accent)' : 'var(--border)'}`,
              }}
            >
              {sec.section_key}
            </button>
          );
        })}
      </div>
      <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
        Package {s.pkg.packageId} · status inventory_ready · nothing is live until you Proceed.
      </p>
    </>
  );
}

function TargetPicker({
  label,
  value,
  options,
  onChange,
  brand,
}: {
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (id: string) => void;
  brand?: BrandIconSpec;
}) {
  return (
    <Fld label={label}>
      {brand ? (
        <div className="mb-2">
          <BrandIconSlot brand={brand} sel />
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`w-full text-left rounded-lg px-3 py-2.5 text-[13px] sw-card ${value === opt.id ? 'sw-card--selected' : ''}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </Fld>
  );
}

function SProceed({
  s,
  upPkg,
  onProceed,
  cfSnapshot,
  onCfConnect,
  onCfConfigureStack,
}: {
  s: WState;
  upPkg: (p: Partial<WState['pkg']>) => void;
  onProceed: () => Promise<void>;
  cfSnapshot: CfCredentialSnapshot;
  onCfConnect: () => void | Promise<void>;
  onCfConfigureStack: () => void;
}) {
  const slug = s.site.slug || toSlug(s.site.name) || 'my-site';
  const domain =
    s.domain.mode === 'subdomain'
      ? `${s.domain.sub || slug}.inneranimalmedia.com`
      : s.domain.mode === 'custom'
        ? s.domain.custom
        : `${slug}.workers.dev`;
  const targets = s.pkg.proceedTargets;
  const dbOptions = (targets?.db_targets || [{ id: 'platform', label: 'IAM shared D1' }]).map((t) => ({
    id: t.id,
    label: t.label || t.id,
  }));
  const r2Options = (targets?.r2_targets || [{ id: 'shared', label: 'Shared CMS bucket' }]).map((t) => ({
    id: t.id,
    label: t.label || t.id,
  }));
  const workerOptions = (targets?.worker_targets || [{ id: 'shared', label: 'inneranimalmedia' }]).map((t) => ({
    id: t.id,
    label: t.label || t.id,
  }));

  if (s.deploy.status === 'done') {
    return (
      <>
        <div className="rounded-xl p-5 text-center mb-4" style={{ background: 'var(--bg-success)', border: '0.5px solid var(--border-success)' }}>
          <div className="flex justify-center mb-2" style={{ color: 'var(--text-success)' }}>
            <Check size={32} strokeWidth={2.5} aria-hidden />
          </div>
          <h3 className="text-[16px] font-medium mb-1" style={{ color: 'var(--text-success)' }}>Site published</h3>
          <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            {s.deploy.sectionsMapped || 0} sections mapped to {s.pkg.dbTarget === 'workspace' ? 'your D1' : 'IAM D1'}.
          </p>
        </div>
        <a
          href={`https://${domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius)] px-3 py-1.5 text-[13px] font-mono"
          style={{ background: 'var(--surface-1)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
        >
          <ExternalLink size={14} aria-hidden />
          https://{domain}
        </a>
      </>
    );
  }

  return (
    <>
      <Head
        title={s.deploy.status === 'running' ? 'Publishing…' : 'Proceed to live'}
        desc="Choose where CMS data lives on Cloudflare, then publish your selected sections."
      />
      <CfCredentialsStrip
        snapshot={cfSnapshot}
        needsStack={s.pkg.dbTarget !== 'platform' || s.pkg.r2Target !== 'shared' || s.pkg.workerTarget !== 'shared'}
        onConnect={onCfConnect}
        onConfigureStack={onCfConfigureStack}
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <TargetPicker
          label="Database"
          brand={{ iconSlug: 'cloudflare_d1', providerKey: 'cloudflare_d1', title: 'Cloudflare D1' }}
          value={s.pkg.dbTarget}
          options={dbOptions}
          onChange={(id) => {
          const pick = targets?.db_targets?.find((t) => t.id === id);
          upPkg({ dbTarget: id, databaseId: pick?.database_id || '' });
        }}
        />
        <TargetPicker
          label="R2 storage"
          brand={{ iconSlug: 'cf_r2', providerKey: 'cloudflare_r2', title: 'Cloudflare R2' }}
          value={s.pkg.r2Target}
          options={r2Options}
          onChange={(id) => upPkg({ r2Target: id })}
        />
        <TargetPicker
          label="Worker"
          brand={{ iconSlug: 'cloudflare', providerKey: 'cloudflare_workers', title: 'Cloudflare Workers' }}
          value={s.pkg.workerTarget}
          options={workerOptions}
          onChange={(id) => upPkg({ workerTarget: id })}
        />
      </div>
      <div className="rounded-xl px-5 py-3 mb-4 sw-panel" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
        <div className="text-[13px] py-1" style={{ color: 'var(--text-secondary)' }}>
          Template: <strong style={{ color: 'var(--text-primary)' }}>{s.pkg.selectedTemplate}</strong>
        </div>
        <div className="text-[13px] py-1" style={{ color: 'var(--text-secondary)' }}>
          Sections: <strong style={{ color: 'var(--text-primary)' }}>{s.pkg.selectedSections.join(', ') || 'none'}</strong>
        </div>
        <div className="text-[13px] py-1" style={{ color: 'var(--text-secondary)' }}>
          Domain: <strong style={{ color: 'var(--text-primary)' }}>{domain}</strong>
        </div>
      </div>
      {s.deploy.status === 'error' ? (
        <div className="rounded-lg p-3 mb-4 text-[13px]" style={{ background: 'var(--bg-danger)', color: 'var(--text-danger)' }}>
          {s.deploy.error}
        </div>
      ) : null}
      {s.deploy.status !== 'running' ? (
        <button
          type="button"
          onClick={onProceed}
          className="px-5 py-2 rounded-[var(--radius)] text-[14px] font-medium"
          style={{ background: 'var(--fill-accent)', color: 'white', border: 'none' }}
        >
          Publish selection
        </button>
      ) : null}
    </>
  );
}

/* ── main export ─────────────────────────────────────────────────────────── */

export interface SiteDeployWizardProps {
  workspaceId?: string;
  onClose?: () => void;
  onDeployed?: (slug: string) => void;
}

export function SiteDeployWizard({ workspaceId, onClose, onDeployed }: SiteDeployWizardProps) {
  const [cur, setCur] = useState(0);
  const [s, setS] = useState<WState>(INIT);
  const [cfStackOpen, setCfStackOpen] = useState(false);
  const [cfSnapshot, setCfSnapshot] = useState<CfCredentialSnapshot>({
    cfOAuthConnected: false,
    cfStackConfigured: false,
    cfAccountDisplay: null,
    cfConnectUrl: '/api/integrations/cloudflare/connect',
    connecting: false,
    connectError: null,
  });
  const express = Boolean(s.importZip.file);
  const steps = express ? EXPRESS_STEPS : STEPS;

  const refreshCfSnapshot = useCallback(async () => {
    const [tilesRes, accountSnap] = await Promise.all([
      fetchConnectTiles('workspace'),
      loadCfCredentialSnapshot(),
    ]);
    const cfTile =
      (tilesRes.tiles || []).find((t) => t.provider_key === 'cloudflare_oauth') || null;
    setCfSnapshot((prev) => ({
      ...prev,
      cfOAuthConnected: Boolean(accountSnap.cfOAuthConnected || cfTile?.connected),
      cfAccountDisplay: accountSnap.cfAccountDisplay || cfTile?.account_display || null,
      cfConnectUrl: accountSnap.cfConnectUrl || cfTile?.connect_url || '/api/integrations/cloudflare/connect',
      cfStackConfigured: Boolean(accountSnap.cfStackConfigured),
      connecting: false,
    }));
  }, []);

  useEffect(() => {
    void refreshCfSnapshot();
  }, [refreshCfSnapshot]);

  const onCfConnect = useCallback(async () => {
    setCfSnapshot((prev) => ({ ...prev, connecting: true, connectError: null }));
    try {
      const connectUrl = cfSnapshot.cfConnectUrl || '/api/integrations/cloudflare/connect';
      const result = await openIntegrationOAuthPopup(connectUrl, 'cloudflare_oauth');
      if (!result.ok) {
        setCfSnapshot((prev) => ({
          ...prev,
          connecting: false,
          connectError: result.error || 'Cloudflare authorization failed',
        }));
        return;
      }
      await refreshCfSnapshot();
    } catch (e) {
      setCfSnapshot((prev) => ({
        ...prev,
        connecting: false,
        connectError: e instanceof Error ? e.message : 'Cloudflare authorization failed',
      }));
    }
  }, [cfSnapshot.cfConnectUrl, refreshCfSnapshot]);

  const needsCfForDeploy = useMemo(() => wizardUsesCfInfra(s, express), [s, express]);
  const needsCfStackForDeploy = useMemo(() => {
    if (s.hosting === 'isolated_build') return true;
    if (s.hosting === 'localhost_dev') return false;
    if (express) {
      return s.pkg.dbTarget !== 'platform' || s.pkg.r2Target !== 'shared' || s.pkg.workerTarget !== 'shared';
    }
    return s.infra.worker === 'new' || s.infra.bucket === 'new';
  }, [express, s]);

  const assertCfReady = useCallback((): string | null => {
    if (!needsCfForDeploy) return null;
    if (!cfSnapshot.cfOAuthConnected) {
      return 'Connect Cloudflare first — authorize your account using the banner above.';
    }
    if (needsCfStackForDeploy && !cfSnapshot.cfStackConfigured) {
      return 'Configure your Cloudflare stack (D1, Worker, R2) before deploying dedicated infrastructure.';
    }
    return null;
  }, [needsCfForDeploy, needsCfStackForDeploy, cfSnapshot.cfOAuthConnected, cfSnapshot.cfStackConfigured]);

  const upSite = useCallback((p: Partial<WState['site']>) => setS((prev) => ({ ...prev, site: { ...prev.site, ...p } })), []);
  const upZip = useCallback(
    (p: Partial<ImportZipState>) => setS((prev) => ({ ...prev, importZip: { ...prev.importZip, ...p } })),
    [],
  );
  const onExpressZip = useCallback((_file: File, slug: string) => {
    const defaults = applyExpressDefaults(slug);
    setS((prev) => ({
      ...prev,
      ...defaults,
      site: { ...prev.site, type: 'import' },
    }));
  }, []);
  const upInfra = useCallback(
    (p: Partial<WState['infra']>) => setS((prev) => ({ ...prev, infra: { ...prev.infra, ...p } })),
    [],
  );
  const upRepo = useCallback((p: Partial<WState['repo']>) => setS((prev) => ({ ...prev, repo: { ...prev.repo, ...p } })), []);
  const upDomain = useCallback(
    (p: Partial<WState['domain']>) => setS((prev) => ({ ...prev, domain: { ...prev.domain, ...p } })),
    [],
  );
  const upCms = useCallback((p: Partial<WState['cms']>) => setS((prev) => ({ ...prev, cms: { ...prev.cms, ...p } })), []);
  const upDeploy = useCallback(
    (p: Partial<WState['deploy']>) => setS((prev) => ({ ...prev, deploy: { ...prev.deploy, ...p } })),
    [],
  );
  const upPkg = useCallback(
    (p: Partial<WState['pkg']>) => setS((prev) => ({ ...prev, pkg: { ...prev.pkg, ...p } })),
    [],
  );
  const uHosting = useCallback((lane: HostingLane) => {
    setS((prev) => {
      const slug = prev.site.slug || toSlug(prev.site.name);
      return { ...prev, ...applyHostingLaneDefaults(lane, slug), hosting: lane };
    });
  }, []);
  const uLocalPort = useCallback((port: string) => {
    const digits = port.replace(/\D/g, '').slice(0, 5);
    setS((prev) => ({ ...prev, localDevPort: digits || '8787' }));
  }, []);

  const handleRunInventory = useCallback(async () => {
    upPkg({ phase: 'running', error: undefined });
    try {
      const slug = s.site.slug || toSlug(s.site.name);
      const publicDomain =
        s.domain.mode === 'subdomain'
          ? `${s.domain.sub || slug}.inneranimalmedia.com`
          : s.domain.mode === 'custom'
            ? s.domain.custom
            : null;

      const res = await fetch('/api/cms/projects/create', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          project_name: s.site.name,
          project_slug: slug,
          project_type: 'import',
          worker: 'existing',
          bucket: 'cms',
          repo_mode: 'skip',
          domain_mode: s.domain.mode,
          subdomain: s.domain.sub || slug,
          custom_domain: s.domain.custom || null,
          cms_template: 'shopify',
          sections: [],
          import_mode: 'theme_zip',
          skip_seed: true,
          hosting_lane: 'platform_shared',
          public_domain: publicDomain,
        }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
        upPkg({ phase: 'error', error: e.error || 'Project create failed' });
        return;
      }

      if (!s.importZip.file) {
        upPkg({ phase: 'error', error: 'Theme zip required' });
        return;
      }

      const fd = new FormData();
      fd.append('file', s.importZip.file);
      fd.append('import_name', `${s.site.name || slug} theme`);
      fd.append('project_slug', slug);
      const up = await fetch('/api/cms/liquid-imports/upload', {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      });
      if (!up.ok) {
        const ue = (await up.json().catch(() => ({ error: `HTTP ${up.status}` }))) as { error?: string; message?: string };
        upPkg({ phase: 'error', error: ue.message || ue.error || 'Upload failed' });
        return;
      }
      const uploadJson = (await up.json().catch(() => ({}))) as { id?: string };
      const packageId = uploadJson.id;
      if (!packageId) {
        upPkg({ phase: 'error', error: 'No package id returned' });
        return;
      }

      for (let attempt = 0; attempt < 45; attempt++) {
        await sleep(2000);
        const poll = await fetch(`/api/cms/site-packages/${encodeURIComponent(packageId)}/inventory`, {
          credentials: 'same-origin',
        });
        if (!poll.ok) continue;
        const inv = (await poll.json().catch(() => ({}))) as {
          ready?: boolean;
          package?: { status?: string; error_log?: string };
          manifest?: WState['pkg']['manifest'];
          liquid_sections?: Array<{ id: string; section_key: string }>;
          proceed_targets?: WState['pkg']['proceedTargets'];
        };
        if (inv.package?.status === 'failed') {
          upPkg({ phase: 'error', error: inv.package.error_log || 'Inventory failed' });
          return;
        }
        if (inv.ready) {
          const defaultKeys = inv.manifest?.default_section_keys || inv.liquid_sections?.map((x) => x.section_key) || [];
          upPkg({
            phase: 'ready',
            packageId,
            manifest: inv.manifest,
            liquidSections: inv.liquid_sections,
            proceedTargets: inv.proceed_targets,
            selectedSections: [...defaultKeys],
            selectedTemplate: inv.manifest?.default_template || 'index',
          });
          upDeploy({ importId: packageId, importUploaded: true });
          return;
        }
      }
      upPkg({ phase: 'error', error: 'Inventory timed out — check CMS Imports' });
    } catch (e) {
      upPkg({ phase: 'error', error: e instanceof Error ? e.message : 'Inventory failed' });
    }
  }, [s, workspaceId, upDeploy, upPkg]);

  const handleProceed = useCallback(async () => {
    upDeploy({ status: 'running', error: undefined });
    try {
      const cfErr = assertCfReady();
      if (cfErr) {
        upDeploy({ status: 'error', error: cfErr });
        return;
      }
      const packageId = s.pkg.packageId;
      if (!packageId) {
        upDeploy({ status: 'error', error: 'No site package — run inventory first' });
        return;
      }
      const res = await fetch(`/api/cms/site-packages/${encodeURIComponent(packageId)}/proceed`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: s.pkg.selectedTemplate,
          sections: s.pkg.selectedSections,
          db_target: s.pkg.dbTarget,
          database_id: s.pkg.databaseId || null,
          r2_target: s.pkg.r2Target,
          worker_target: s.pkg.workerTarget,
          project_slug: s.site.slug || toSlug(s.site.name),
        }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
        upDeploy({ status: 'error', error: e.error || 'Proceed failed' });
        return;
      }

      for (let attempt = 0; attempt < 45; attempt++) {
        await sleep(2000);
        const poll = await fetch(`/api/cms/site-packages/${encodeURIComponent(packageId)}`, {
          credentials: 'same-origin',
        });
        if (!poll.ok) continue;
        const inv = (await poll.json().catch(() => ({}))) as {
          package?: { status?: string; sections_mapped?: number; error_log?: string };
        };
        if (inv.package?.status === 'completed') {
          upDeploy({
            status: 'done',
            sectionsMapped: inv.package.sections_mapped || s.pkg.selectedSections.length,
          });
          onDeployed?.(s.site.slug || toSlug(s.site.name));
          return;
        }
        if (inv.package?.status === 'failed') {
          upDeploy({ status: 'error', error: inv.package.error_log || 'Publish failed' });
          return;
        }
      }
      upDeploy({ status: 'error', error: 'Publish timed out' });
    } catch (e) {
      upDeploy({ status: 'error', error: e instanceof Error ? e.message : 'Proceed failed' });
    }
  }, [s, upDeploy, onDeployed, assertCfReady]);

  const handleFullDeploy = useCallback(async () => {
    upDeploy({ status: 'running', error: undefined });
    try {
      const cfErr = assertCfReady();
      if (cfErr) {
        upDeploy({ status: 'error', error: cfErr });
        return;
      }
      const slug = s.site.slug || toSlug(s.site.name);
      if (!slug || !s.site.name.trim()) {
        upDeploy({ status: 'error', error: 'Site name and slug are required' });
        return;
      }
      const publicDomain =
        s.domain.mode === 'subdomain'
          ? `${s.domain.sub || slug}.inneranimalmedia.com`
          : s.domain.mode === 'custom'
            ? s.domain.custom
            : null;

      const res = await fetch('/api/cms/projects/create', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          project_name: s.site.name,
          project_slug: slug,
          project_type: s.site.type,
          worker: s.infra.worker,
          worker_name: s.infra.workerName,
          bucket: s.infra.bucket,
          kv_draft_cache: s.infra.kv,
          repo_mode: s.repo.mode,
          repo_org: s.repo.org,
          repo_name: s.repo.repoName,
          repo_branch: s.repo.branch,
          cf_builds: s.repo.builds,
          domain_mode: s.domain.mode,
          subdomain: s.domain.sub || slug,
          custom_domain: s.domain.custom || null,
          cms_template: s.cms.tpl,
          sections: s.cms.secs,
          agentic_tools: s.cms.agentic,
          pipeline_binding: s.cms.pipeline,
          hosting_lane: s.hosting,
          local_dev_port: s.localDevPort,
          public_domain: publicDomain,
        }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
        upDeploy({ status: 'error', error: e.error || 'Deploy failed' });
        return;
      }

      if (s.importZip.file) {
        const fd = new FormData();
        fd.append('file', s.importZip.file);
        fd.append('import_name', `${s.site.name || slug} theme`);
        fd.append('project_slug', slug);
        const up = await fetch('/api/cms/liquid-imports/upload', {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        });
        if (!up.ok) {
          const ue = (await up.json().catch(() => ({ error: `HTTP ${up.status}` }))) as {
            error?: string;
            message?: string;
          };
          upDeploy({
            status: 'error',
            error: ue.message || ue.error || 'Site created but theme upload failed',
          });
          return;
        }
        upDeploy({ importUploaded: true });
      }

      upDeploy({ status: 'done' });
      onDeployed?.(slug);
    } catch (e) {
      upDeploy({ status: 'error', error: e instanceof Error ? e.message : 'Deploy failed' });
    }
  }, [s, workspaceId, upDeploy, onDeployed, assertCfReady]);

  const goTo = useCallback(
    (i: number) => {
      if (i >= 0 && i < steps.length) setCur(i);
    },
    [steps.length],
  );

  useEffect(() => {
    if (!express || cur !== 1) return;
    if (s.pkg.phase === 'idle') handleRunInventory();
  }, [express, cur, s.pkg.phase, handleRunInventory]);

  const handleDeploy = useCallback(async () => {
    if (express) {
      await handleProceed();
      return;
    }
    await handleFullDeploy();
  }, [express, handleProceed, handleFullDeploy]);

  const isLast = cur === steps.length - 1;
  const isDone = s.deploy.status === 'done';

  const renderStep = () => {
    if (express) {
      if (cur === 0) {
        return (
          <S0
            s={s}
            u={upSite}
            uZip={upZip}
            uHosting={uHosting}
            onExpressZip={onExpressZip}
            express
          />
        );
      }
      if (cur === 1) return <SInventory s={s} upPkg={upPkg} />;
      if (cur === 2) {
        return (
          <SProceed
            s={s}
            upPkg={upPkg}
            onProceed={handleProceed}
            cfSnapshot={cfSnapshot}
            onCfConnect={onCfConnect}
            onCfConfigureStack={() => setCfStackOpen(true)}
          />
        );
      }
      return null;
    }
    if (cur === 0) {
      return (
        <S0
          s={s}
          u={upSite}
          uZip={upZip}
          uHosting={uHosting}
          onExpressZip={onExpressZip}
        />
      );
    }
    if (cur === 1) {
      return (
        <S1
          s={s}
          u={upInfra}
          uLocalPort={uLocalPort}
          cfSnapshot={cfSnapshot}
          onCfConnect={onCfConnect}
          onCfConfigureStack={() => setCfStackOpen(true)}
        />
      );
    }
    if (cur === 2) return <S2 s={s} u={upRepo} />;
    if (cur === 3) return <S3 s={s} u={upDomain} />;
    if (cur === 4) return <S4 s={s} u={upCms} uZip={upZip} />;
    if (cur === 5) return <S5 s={s} goTo={goTo} />;
    if (cur === 6) {
      return (
        <S6
          s={s}
          onDeploy={handleDeploy}
          cfSnapshot={cfSnapshot}
          onCfConnect={onCfConnect}
          onCfConfigureStack={() => setCfStackOpen(true)}
        />
      );
    }
    return null;
  };

  const canContinue =
    !isLast &&
    !(cur === 0 && express && (!s.importZip.file || !s.site.name.trim() || !s.site.slug.trim())) &&
    !(cur === 1 && express && s.pkg.phase !== 'ready') &&
    !(
      cur === 1 &&
      !express &&
      s.hosting === 'isolated_build' &&
      (!cfSnapshot.cfOAuthConnected || (needsCfStackForDeploy && !cfSnapshot.cfStackConfigured))
    );

  return (
    <div className="flex flex-col h-full min-h-0 site-deploy-wizard" style={{ background: 'var(--surface-0)', fontFamily: 'var(--font-sans)' }}>
      <div
        className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-1)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {cur > 0 && !isDone ? (
            <button
              type="button"
              onClick={() => goTo(cur - 1)}
              className="sw-header-back"
              aria-label="Previous step"
            >
              <ChevronLeft size={20} aria-hidden />
            </button>
          ) : null}
          <h1 className="text-[16px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            Deploy a new site
          </h1>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md opacity-60 hover:opacity-100"
            style={{ color: 'var(--text-primary)' }}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        ) : null}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        <Prog cur={cur} steps={steps} />
        {renderStep()}
      </div>
      {!isDone ? (
        <div
          className="flex items-center justify-between px-6 py-4 shrink-0"
          style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-1)' }}
        >
          {cur > 0 && s.deploy.status !== 'running' ? (
            <button
              type="button"
              onClick={() => goTo(cur - 1)}
              className="sw-footer-back"
            >
              <ChevronLeft size={16} aria-hidden />
              Back
            </button>
          ) : (
            <div />
          )}
          {express && cur === 2 ? null : isLast ? (
            s.deploy.status === 'running' ? (
              <button
                type="button"
                disabled
                className="px-5 py-2 rounded-[var(--radius)] text-[14px] font-medium opacity-60 cursor-not-allowed"
                style={{ background: 'var(--fill-accent)', color: 'white' }}
              >
                Deploying…
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDeploy}
                className="px-5 py-2 rounded-[var(--radius)] text-[14px] font-medium"
                style={{ background: 'var(--fill-accent)', color: 'white', border: 'none' }}
              >
                Deploy now
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => goTo(cur + 1)}
              disabled={!canContinue}
              className="px-5 py-2 rounded-[var(--radius)] text-[14px] font-medium"
              style={{
                background: 'var(--fill-accent)',
                color: 'white',
                border: 'none',
                opacity: canContinue ? 1 : 0.5,
                cursor: canContinue ? 'pointer' : 'not-allowed',
              }}
            >
              {cur === steps.length - 2 ? 'Review' : 'Continue'}
            </button>
          )}
        </div>
      ) : null}
      <CfStackWizard
        open={cfStackOpen}
        workspaceId={workspaceId || undefined}
        onClose={() => setCfStackOpen(false)}
        onComplete={() => {
          setCfStackOpen(false);
          void refreshCfSnapshot();
        }}
      />
    </div>
  );
}

export default SiteDeployWizard;
