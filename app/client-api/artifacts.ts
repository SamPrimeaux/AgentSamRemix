export type LinkedSkill = { id: string | null; name: string; role: string | null };

export type ArtifactRecord = {
  id: string | null;
  user_id: string | null;
  tenant_id: string | null;
  workspace_id: string | null;
  workspace_slug: string | null;
  project_key: string | null;
  name: string;
  description: string | null;
  artifact_type: string;
  artifact_status: string | null;
  validation_status: string | null;
  visibility: string | null;
  r2_key: string;
  public_url: string | null;
  preview_r2_key: string | null;
  preview_url: string | null;
  thumbnail_r2_key: string | null;
  thumbnail_url: string | null;
  source: string;
  source_skill_id: string | null;
  source_run_id: string | null;
  source_session_id: string | null;
  source_message_id: string | null;
  source_workflow_id: string | null;
  source_tool_key: string | null;
  source_model_key: string | null;
  tags: string[];
  metadata_json: unknown;
  file_size_bytes: number | null;
  is_public: boolean;
  created_at: string | null;
  updated_at: string | null;
  created_at_display: string | null;
  updated_at_display: string | null;
  linked_skills: LinkedSkill[];
};

export type ArtifactListResponse = {
  ok: boolean;
  artifacts: ArtifactRecord[];
  total: number;
  filters: Record<string, unknown>;
  kpis?: {
    total_artifacts: number;
    draft: number;
    approved_published_deployed: number;
    passed_validation: number;
    untested_or_failed: number;
  };
  error?: string;
};

export type ArtifactFiltersResponse = {
  ok: boolean;
  filters: {
    artifact_type: { value: string; count: number }[];
    artifact_status: { value: string; count: number }[];
    validation_status: { value: string; count: number }[];
    visibility: { value: string; count: number }[];
    source: { value: string; count: number }[];
  };
};

function qs(params: Record<string, string | number | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export async function fetchArtifacts(params: {
  limit?: number;
  offset?: number;
  q?: string;
  type?: string;
  status?: string;
  validation?: string;
  visibility?: string;
  source?: string;
  workspace_id?: string;
  project_key?: string;
  session_id?: string;
  signal?: AbortSignal;
}): Promise<ArtifactListResponse> {
  const { signal, ...query } = params;
  const r = await fetch(`/api/agent/artifacts${qs(query)}`, {
    credentials: 'same-origin',
    signal,
  });
  return (await r.json()) as ArtifactListResponse;
}

export async function fetchArtifactFilters(signal?: AbortSignal): Promise<ArtifactFiltersResponse> {
  const r = await fetch('/api/agent/artifact-filters', { credentials: 'same-origin', signal });
  return (await r.json()) as ArtifactFiltersResponse;
}

export type ArtifactPurgeResponse = {
  ok: boolean;
  dry_run?: boolean;
  workspace_id?: string;
  d1_rows?: number;
  d1_rows_deleted?: number;
  r2_keys_planned?: number;
  r2_keys_deleted?: number;
  r2_buckets?: { bucket: string; keys: number }[];
  error?: string;
  expected?: string;
};

export async function purgeWorkspaceArtifacts(opts: {
  workspace_id?: string;
  dry_run?: boolean;
  delete_r2?: boolean;
}): Promise<ArtifactPurgeResponse> {
  const r = await fetch('/api/agent/artifacts/purge', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirm: 'PURGE_WORKSPACE_ARTIFACTS',
      workspace_id: opts.workspace_id,
      dry_run: !!opts.dry_run,
      delete_r2: opts.delete_r2 !== false,
    }),
  });
  return (await r.json()) as ArtifactPurgeResponse;
}

export async function deleteArtifact(
  id: string,
): Promise<{ ok: boolean; deleted?: boolean; error?: string }> {
  const r = await fetch(`/api/agent/artifacts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  return (await r.json()) as { ok: boolean; deleted?: boolean; error?: string };
}

export async function patchArtifact(
  id: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; artifact?: ArtifactRecord; error?: string }> {
  const r = await fetch(`/api/agent/artifacts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await r.json()) as { ok: boolean; artifact?: ArtifactRecord; error?: string };
}
