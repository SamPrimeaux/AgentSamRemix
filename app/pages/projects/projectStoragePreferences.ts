import type { ProjectStorageScope } from './projectDetailMeta';

/** Per-project storage prefs — local first; never hardcode client slugs in code paths. */
export type ProjectStoragePref = {
  bucket?: string;
  prefix?: string;
  /** auto = resolve from work-context API + project row; platform = ASSETS lane only */
  source?: 'auto' | 'platform_r2' | 'client_r2';
  updated_at?: number;
};

const LS_KEY = 'iam.project.storage.v1';

type PrefStore = Record<string, ProjectStoragePref>;

function readStore(): PrefStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as PrefStore;
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

function writeStore(store: PrefStore) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch {
    /* quota */
  }
}

export function readProjectStoragePref(projectId: string): ProjectStoragePref | null {
  const id = projectId?.trim();
  if (!id) return null;
  const row = readStore()[id];
  return row && typeof row === 'object' ? { ...row } : null;
}

export function writeProjectStoragePref(projectId: string, pref: ProjectStoragePref): void {
  const id = projectId?.trim();
  if (!id) return;
  const store = readStore();
  store[id] = { ...pref, updated_at: Date.now() };
  writeStore(store);
}

export type ProjectWorkContextBindings = {
  r2Bucket?: string | null;
  r2Prefix?: string | null;
  workerName?: string | null;
  workspaceId?: string | null;
  d1DatabaseId?: string | null;
  d1Binding?: string | null;
  kvNamespaceId?: string | null;
  githubRepo?: string | null;
  deployUrl?: string | null;
  slug?: string | null;
};

/** D1-driven execution bindings — same source as project activate / Agent Sam. */
export async function fetchProjectWorkContextBindings(
  projectId: string,
): Promise<ProjectWorkContextBindings | null> {
  const id = projectId?.trim();
  if (!id) return null;
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(id)}/work-context`, {
      credentials: 'same-origin',
    });
    if (!r.ok) return null;
    const data = (await r.json()) as {
      bindings?: ProjectWorkContextBindings & {
        r2Bucket?: string | null;
        r2Prefix?: string | null;
        workerName?: string | null;
        workspaceId?: string | null;
        d1DatabaseId?: string | null;
        d1Binding?: string | null;
        kvNamespaceId?: string | null;
        githubRepo?: string | null;
        deployUrl?: string | null;
        slug?: string | null;
      };
    };
    const b = data.bindings;
    if (!b) return null;
    return {
      r2Bucket: b.r2Bucket ?? null,
      r2Prefix: b.r2Prefix ?? null,
      workerName: b.workerName ?? null,
      workspaceId: b.workspaceId ?? null,
      d1DatabaseId: b.d1DatabaseId ?? null,
      d1Binding: b.d1Binding ?? null,
      kvNamespaceId: b.kvNamespaceId ?? null,
      githubRepo: b.githubRepo ?? null,
      deployUrl: b.deployUrl ?? null,
      slug: b.slug ?? null,
    };
  } catch {
    return null;
  }
}

export function storagePrefSummary(
  scope: ProjectStorageScope | null,
  pref: ProjectStoragePref | null,
): string {
  if (!scope) return 'Loading storage…';
  const mode =
    pref?.source === 'platform_r2'
      ? 'platform bucket'
      : pref?.source === 'client_r2'
        ? 'custom bucket'
        : scope.source === 'platform_r2'
          ? 'platform default'
          : 'project workspace';
  return `${scope.bucket} · ${scope.prefix} (${mode})`;
}

export function storageSourceLabel(source: ProjectStoragePref['source']): string {
  if (source === 'platform_r2') return 'Platform bucket';
  if (source === 'client_r2') return 'Custom bucket';
  return 'Project workspace';
}
