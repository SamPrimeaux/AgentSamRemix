import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { createProject, type CreateProjectPayload } from '../../client-api/projects';
import { fetchConnectTiles, type ConnectTile } from '../../client-api/connectTiles';
import { AppIcon } from '../ui/AppIcon';
import { useWorkspace } from '../../src/context/WorkspaceContext';
import '../ui/AppIcon.css';
import './StartProjectWizard.css';

type StackSnapshot = {
  github_repo: string | null;
  cf_stack_configured: boolean;
  workspace_name: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (projectId?: string) => void;
};

type Step = 1 | 2 | 3;

async function loadStackSnapshot(workspaceId: string | null): Promise<StackSnapshot> {
  const out: StackSnapshot = {
    github_repo: null,
    cf_stack_configured: false,
    workspace_name: null,
  };
  try {
    const qp = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
    const [wsRes, cfRes] = await Promise.all([
      workspaceId
        ? fetch(`/api/settings/workspace${qp}`, { credentials: 'same-origin' })
        : Promise.resolve(null),
      fetch('/api/integrations/cloudflare/context', { credentials: 'same-origin' }),
    ]);
    if (wsRes) {
      const ws = (await wsRes.json()) as { workspace?: { name?: string; github_repo?: string } };
      out.workspace_name = ws.workspace?.name || null;
      out.github_repo = ws.workspace?.github_repo?.trim() || null;
    }
    const cf = (await cfRes.json()) as {
      stack_configured?: boolean;
      oauth_connected?: boolean;
      stack?: { cf_stack_configured_at?: number; cf_d1_database_id?: string; cf_worker_name?: string };
      settings_json?: { cf_stack_configured_at?: number };
    };
    const stack = cf.stack || cf.settings_json;
    out.cf_stack_configured =
      Boolean(cf.stack_configured) ||
      Number(stack?.cf_stack_configured_at) > 0 ||
      Boolean(stack && ('cf_d1_database_id' in stack || 'cf_worker_name' in stack));
  } catch {
    /* non-fatal */
  }
  return out;
}

function pillTone(ok: boolean) {
  return ok ? 'ok' : 'warn';
}

export function StartProjectWizard({ open, onClose, onCreated }: Props) {
  const { workspaceId, canonicalWorkspaceId } = useWorkspace();
  const resolvedWs = workspaceId || canonicalWorkspaceId;

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [linkRepo, setLinkRepo] = useState(true);
  const [connectTiles, setConnectTiles] = useState<ConnectTile[]>([]);
  const [stack, setStack] = useState<StackSnapshot | null>(null);
  const [loadingStack, setLoadingStack] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setName('');
    setDescription('');
    setLinkRepo(true);
    setError(null);
    void loadStackSnapshot(resolvedWs).then(setStack);
  }, [open, resolvedWs]);

  useEffect(() => {
    if (!open || step !== 2) return;
    let cancelled = false;
    setLoadingStack(true);
    void (async () => {
      const [tilesRes, snap] = await Promise.all([
        fetchConnectTiles('workspace'),
        loadStackSnapshot(resolvedWs),
      ]);
      if (cancelled) return;
      setConnectTiles(tilesRes.tiles || []);
      setStack(snap);
      setLoadingStack(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, step, resolvedWs]);

  const integrationSlugs = useMemo(
    () => connectTiles.filter((t) => t.connected).map((t) => t.provider_key),
    [connectTiles],
  );

  const stackReady = useMemo(() => {
    if (!stack) return false;
    const gh = !!stack.github_repo;
    const cf = connectTiles.find((t) => t.provider_key === 'cloudflare_oauth')?.connected;
    return gh && cf && stack.cf_stack_configured;
  }, [stack, connectTiles]);

  const submit = async () => {
    const trimmed = name.trim();
    const ws = resolvedWs?.trim();
    if (!trimmed || !ws) {
      setError('Project name and workspace are required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const metadata: Record<string, unknown> = {
      integration_slugs: integrationSlugs,
    };
    if (linkRepo && stack?.github_repo) metadata.github_repo = stack.github_repo;

    const payload: CreateProjectPayload = {
      name: trimmed,
      description: description.trim() || undefined,
      workspace_id: ws,
      metadata_json: JSON.stringify(metadata),
    };
    const res = await createProject(payload);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error || 'Create failed');
      return;
    }
    const createdId =
      res.project && typeof res.project === 'object' && res.project !== null && 'id' in res.project
        ? String((res.project as { id?: string }).id || '')
        : '';
    onCreated?.(createdId || undefined);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="iam-start-project-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="iam-start-project-modal" role="dialog" aria-modal="true" aria-labelledby="start-project-title">
        <header className="iam-start-project-head">
          <div>
            <p className="iam-start-project-kicker">Step {step} of 3</p>
            <h2 id="start-project-title">Start a project</h2>
          </div>
          <button type="button" className="iam-start-project-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {error ? <p className="iam-start-project-error">{error}</p> : null}

        {step === 1 ? (
          <div className="iam-start-project-body">
            <label className="iam-start-project-field">
              Project name
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Inner Animal Media" />
            </label>
            <label className="iam-start-project-field">
              What are you building?
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Goals, audience, and what success looks like…"
              />
            </label>
            {resolvedWs ? (
              <p className="iam-start-project-hint">Workspace · {stack?.workspace_name || resolvedWs}</p>
            ) : (
              <p className="iam-start-project-error">No active workspace — pick one from the status bar first.</p>
            )}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="iam-start-project-body">
            {loadingStack ? (
              <p className="iam-start-project-hint">
                <Loader2 size={16} className="inline animate-spin mr-2" />
                Loading connected services…
              </p>
            ) : (
              <>
                <p className="iam-start-project-hint">
                  Connect your stack once per workspace. Green means you are ready to ship.
                </p>
                <ul className="iam-start-project-stack">
                  <li className={`iam-start-project-pill ${pillTone(!!stack?.github_repo)}`}>
                    <strong>GitHub repo</strong>
                    <span>{stack?.github_repo || 'Not linked — Settings → Workspace'}</span>
                  </li>
                  <li
                    className={`iam-start-project-pill ${pillTone(
                      !!connectTiles.find((t) => t.provider_key === 'cloudflare_oauth')?.connected,
                    )}`}
                  >
                    <strong>Cloudflare OAuth</strong>
                    <span>
                      {connectTiles.find((t) => t.provider_key === 'cloudflare_oauth')?.connected
                        ? 'Connected'
                        : 'Connect in Integrations'}
                    </span>
                  </li>
                  <li className={`iam-start-project-pill ${pillTone(stack?.cf_stack_configured || false)}`}>
                    <strong>CF stack</strong>
                    <span>
                      {stack?.cf_stack_configured
                        ? 'D1 / Worker configured (account)'
                        : 'Configure CF stack once in Integrations'}
                    </span>
                  </li>
                </ul>
                <div className="iam-app-icon-grid iam-start-project-connect-grid">
                  {connectTiles.map((tile) => (
                    <AppIcon
                      key={tile.provider_key}
                      title={tile.title}
                      iconSlug={tile.icon_slug}
                      size="md"
                      subtitle={tile.connected ? tile.account_display || 'Connected' : 'Connect'}
                      status={tile.issue === 'error' ? 'error' : tile.issue === 'warning' ? 'warning' : null}
                      onPress={() => {
                        if (tile.connected) window.location.href = tile.settings_path;
                        else window.location.href = tile.connect_url;
                      }}
                    />
                  ))}
                </div>
                <label className="iam-start-project-check">
                  <input type="checkbox" checked={linkRepo} onChange={(e) => setLinkRepo(e.target.checked)} />
                  Link workspace GitHub repo to this project
                </label>
              </>
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="iam-start-project-body">
            <div className="iam-start-project-review">
              <h3>{name.trim() || 'Untitled project'}</h3>
              <p>{description.trim() || 'No description yet.'}</p>
              <ul>
                <li>Kanban board will be created automatically</li>
                <li>{integrationSlugs.length} connected service(s) pinned to project metadata</li>
                {linkRepo && stack?.github_repo ? <li>Repo · {stack.github_repo}</li> : null}
              </ul>
              {!stackReady ? (
                <p className="iam-start-project-hint warn">
                  Stack is incomplete — you can still create the project and connect services later.
                </p>
              ) : (
                <p className="iam-start-project-hint ok">
                  <Check size={14} className="inline mr-1" />
                  Stack looks ready.
                </p>
              )}
            </div>
          </div>
        ) : null}

        <footer className="iam-start-project-foot">
          {step > 1 ? (
            <button type="button" className="ghost" onClick={() => setStep((s) => (s - 1) as Step)}>
              <ChevronLeft size={16} />
              Back
            </button>
          ) : (
            <span />
          )}
          {step < 3 ? (
            <button
              type="button"
              className="primary"
              disabled={step === 1 && (!name.trim() || !resolvedWs)}
              onClick={() => setStep((s) => (s + 1) as Step)}
            >
              Next
              <ChevronRight size={16} />
            </button>
          ) : (
            <button type="button" className="primary" disabled={submitting || !name.trim()} onClick={() => void submit()}>
              {submitting ? 'Creating…' : 'Create project'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export default StartProjectWizard;
