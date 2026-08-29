import { ExternalLink, Copy, Eye, MoreHorizontal } from 'lucide-react';
import type { ArtifactRecord } from '../../client-api/artifacts';
import { ArtifactTypeIcon } from './ArtifactTypeIcon';
import { formatArtifactType, openArtifactPublic, statusBadgeClass, truncateMiddle, typeBadgeClass } from './utils';

type Props = {
  artifact: ArtifactRecord;
  selected: boolean;
  viewMode: 'grid' | 'list';
  onSelect: () => void;
  onDetails: () => void;
  onCopied: (msg: string) => void;
};

export function ArtifactCard({ artifact, selected, viewMode, onSelect, onDetails, onCopied }: Props) {
  const thumb = artifact.thumbnail_url || artifact.preview_url;
  const skillName = artifact.linked_skills?.[0]?.name;

  const copyR2 = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(artifact.r2_key).then(() => onCopied('R2 key copied'));
  };
  const preview = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (artifact.preview_url) window.open(artifact.preview_url, '_blank', 'noopener,noreferrer');
    else onDetails();
  };
  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    openArtifactPublic(artifact);
    if (!artifact.public_url && !artifact.preview_url) onDetails();
  };

  const meta = (
    <div className="mt-3 space-y-2 min-w-0">
      <div className="font-medium text-sm leading-snug line-clamp-2 text-[var(--text-primary)]">{artifact.name}</div>
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
      <div className="text-[11px] text-muted space-y-0.5">
        <div className="truncate" title={artifact.source}>
          {truncateMiddle(artifact.source, 42)}
        </div>
        <div>{artifact.updated_at_display || artifact.updated_at || '—'}</div>
        <div className="font-mono text-[10px] opacity-80 truncate" title={artifact.r2_key}>
          {truncateMiddle(artifact.r2_key, 44)}
        </div>
        {skillName ? <div className="text-[var(--solar-cyan)] truncate">Skill: {skillName}</div> : null}
      </div>
      <div className="flex flex-wrap gap-1 pt-1">
        <button type="button" className="iam-lib-btn" onClick={open} title="Open public or preview URL">
          <ExternalLink size={14} /> Open
        </button>
        <button type="button" className="iam-lib-btn" onClick={preview} title="Preview">
          <Eye size={14} /> Preview
        </button>
        <button type="button" className="iam-lib-btn" onClick={copyR2} title="Copy R2 key">
          <Copy size={14} /> Key
        </button>
        <button
          type="button"
          className="iam-lib-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDetails();
          }}
          title="Details"
        >
          <MoreHorizontal size={14} /> Details
        </button>
      </div>
    </div>
  );

  const thumbBox = (
    <div className="relative aspect-[16/10] rounded-md overflow-hidden bg-[var(--dashboard-panel)] border border-[var(--dashboard-border)]">
      {thumb ? (
        <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <ArtifactTypeIcon artifact={artifact} className="w-full h-full min-h-[120px]" />
      )}
      {artifact.preview_url && !artifact.thumbnail_url ? (
        <div className="absolute bottom-2 left-2 text-[10px] px-2 py-0.5 rounded bg-black/50 text-white/90">Preview</div>
      ) : null}
    </div>
  );

  if (viewMode === 'list') {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={`iam-lib-card iam-lib-card--list text-left w-full ${selected ? 'ring-1 ring-[var(--solar-cyan)]' : ''}`}
      >
        <div className="flex gap-4 min-w-0 items-start">
          <div className="w-36 shrink-0">{thumbBox}</div>
          <div className="flex-1 min-w-0">{meta}</div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`iam-lib-card text-left ${selected ? 'ring-1 ring-[var(--solar-cyan)]' : ''}`}
    >
      {thumbBox}
      {meta}
    </button>
  );
}
