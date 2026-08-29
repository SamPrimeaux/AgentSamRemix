import { X, ExternalLink, Copy, MessageSquare, Code2 } from 'lucide-react';
import type { ArtifactRecord } from '../../client-api/artifacts';
import { formatArtifactType, statusBadgeClass, typeBadgeClass } from './utils';
import { patchArtifact } from '../../client-api/artifacts';

type Props = {
  artifact: ArtifactRecord | null;
  open: boolean;
  onClose: () => void;
  onPatched: (a: ArtifactRecord) => void;
  onToast: (msg: string) => void;
  onContinueInChat?: () => void;
  onOpenInBuilder?: () => void;
};

export function ArtifactPreviewPanel({
  artifact,
  open,
  onClose,
  onPatched,
  onToast,
  onContinueInChat,
  onOpenInBuilder,
}: Props) {
  if (!open || !artifact) return null;

  const metaStr =
    artifact.metadata_json != null
      ? typeof artifact.metadata_json === 'string'
        ? artifact.metadata_json
        : JSON.stringify(artifact.metadata_json, null, 2)
      : '';

  const runPatch = async (body: Record<string, unknown>, msg: string) => {
    if (!artifact.id) return;
    const r = await patchArtifact(artifact.id, body);
    if (r.ok && r.artifact) {
      onPatched(r.artifact);
      onToast(msg);
    } else onToast(r.error || 'Update failed');
  };

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[60] bg-black/50 hidden max-phone:block"
        aria-label="Close panel"
        onClick={onClose}
      />
      <aside className="fixed z-[70] top-0 right-0 h-full w-full max-w-md border-l border-[var(--dashboard-border)] bg-[var(--dashboard-canvas)] shadow-xl flex flex-col">
        <div className="h-12 flex items-center justify-between px-4 border-b border-[var(--dashboard-border)] shrink-0">
          <span className="text-xs uppercase tracking-widest text-muted">Details</span>
          <button type="button" className="p-1 rounded hover:bg-[var(--bg-hover)]" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-sm">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] leading-tight">{artifact.name}</h2>
          {artifact.description ? (
            <p className="text-muted text-sm leading-relaxed whitespace-pre-wrap">{artifact.description}</p>
          ) : null}
          <div className="flex flex-wrap gap-1">
            <span className={typeBadgeClass()}>{formatArtifactType(artifact.artifact_type)}</span>
            {artifact.artifact_status ? (
              <span className={statusBadgeClass('artifact_status', artifact.artifact_status)}>{artifact.artifact_status}</span>
            ) : null}
            {artifact.validation_status ? (
              <span className={statusBadgeClass('validation', artifact.validation_status)}>{artifact.validation_status}</span>
            ) : null}
            {artifact.visibility ? (
              <span className={statusBadgeClass('visibility', artifact.visibility)}>{artifact.visibility}</span>
            ) : null}
          </div>
          <dl className="space-y-2 text-[12px]">
            {[
              ['R2 key', artifact.r2_key],
              ['Public URL', artifact.public_url],
              ['Preview URL', artifact.preview_url],
              ['Thumbnail URL', artifact.thumbnail_url],
              ['Source', artifact.source],
              ['source_run_id', artifact.source_run_id],
              ['source_workflow_id', artifact.source_workflow_id],
              ['source_model_key', artifact.source_model_key],
              ['source_skill_id', artifact.source_skill_id],
            ].map(([k, v]) =>
              v ? (
                <div key={String(k)} className="grid grid-cols-[120px_1fr] gap-2">
                  <dt className="text-muted">{k}</dt>
                  <dd className="font-mono break-all text-[var(--text-primary)]">{v}</dd>
                </div>
              ) : null,
            )}
          </dl>
          {artifact.linked_skills?.length ? (
            <div>
              <div className="text-[11px] uppercase text-muted mb-1">Linked skills</div>
              <ul className="text-sm space-y-1">
                {artifact.linked_skills.map((s) => (
                  <li key={s.id || s.name}>
                    {s.name}
                    {s.role ? <span className="text-muted"> · {s.role}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {metaStr ? (
            <div>
              <div className="text-[11px] uppercase text-muted mb-1">metadata_json</div>
              <pre className="text-[11px] p-3 rounded-lg bg-[var(--dashboard-panel)] border border-[var(--dashboard-border)] overflow-x-auto whitespace-pre-wrap">
                {metaStr}
              </pre>
            </div>
          ) : null}
          <div className="text-[11px] text-muted space-y-1">
            <div>created: {artifact.created_at_display || artifact.created_at || '—'}</div>
            <div>updated: {artifact.updated_at_display || artifact.updated_at || '—'}</div>
          </div>
        </div>
        <div className="p-4 border-t border-[var(--dashboard-border)] flex flex-col gap-2 shrink-0">
          {onContinueInChat ? (
            <button type="button" className="iam-lib-btn iam-lib-btn--primary justify-center min-h-[44px]" onClick={onContinueInChat}>
              <MessageSquare size={16} /> Continue in chat
            </button>
          ) : null}
          {onOpenInBuilder ? (
            <button type="button" className="iam-lib-btn justify-center min-h-[44px]" onClick={onOpenInBuilder}>
              <Code2 size={16} /> Open in builder
            </button>
          ) : null}
          {artifact.preview_url ? (
            <a
              className="iam-lib-btn justify-center"
              href={artifact.preview_url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} /> Open preview URL
            </a>
          ) : null}
          <button
            type="button"
            className="iam-lib-btn justify-center"
            onClick={() => artifact.r2_key && navigator.clipboard.writeText(artifact.r2_key).then(() => onToast('R2 key copied'))}
          >
            <Copy size={14} /> Copy R2 key
          </button>
          <button
            type="button"
            className="iam-lib-btn justify-center"
            onClick={() => artifact.id && navigator.clipboard.writeText(artifact.id).then(() => onToast('Artifact ID copied'))}
          >
            <Copy size={14} /> Copy artifact ID
          </button>
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              className="iam-lib-btn iam-lib-btn--primary justify-center"
              onClick={() => runPatch({ artifact_status: 'approved' }, 'Marked approved')}
            >
              Mark approved
            </button>
            <button
              type="button"
              className="iam-lib-btn justify-center"
              onClick={() => runPatch({ validation_status: 'passed' }, 'Validation marked passed')}
            >
              Mark validation passed
            </button>
            <button
              type="button"
              className="iam-lib-btn iam-lib-btn--ghost justify-center"
              onClick={() => runPatch({ artifact_status: 'archived' }, 'Archived')}
            >
              Archive
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
