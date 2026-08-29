import type { ArtifactRecord } from '../../client-api/artifacts';
import { ArtifactCard } from './ArtifactCard';

type Props = {
  artifacts: ArtifactRecord[];
  loading: boolean;
  selectedId: string | null;
  viewMode: 'grid' | 'list';
  onSelect: (a: ArtifactRecord) => void;
  onDetails: (a: ArtifactRecord) => void;
  onCopied: (msg: string) => void;
};

function SkeletonCard() {
  return (
    <div className="iam-lib-card animate-pulse">
      <div className="aspect-[16/10] rounded-md bg-[var(--dashboard-border)]/40" />
      <div className="mt-3 space-y-2">
        <div className="h-4 rounded bg-[var(--dashboard-border)]/50 w-3/4" />
        <div className="h-3 rounded bg-[var(--dashboard-border)]/40 w-1/2" />
        <div className="h-3 rounded bg-[var(--dashboard-border)]/30 w-full" />
      </div>
    </div>
  );
}

export function ArtifactGrid({
  artifacts,
  loading,
  selectedId,
  viewMode,
  onSelect,
  onDetails,
  onCopied,
}: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="flex flex-col gap-3">
        {artifacts.map((a) => (
          <ArtifactCard
            key={a.id || Math.random().toString(36)}
            artifact={a}
            selected={selectedId === a.id}
            viewMode="list"
            onSelect={() => onSelect(a)}
            onDetails={() => onDetails(a)}
            onCopied={onCopied}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {artifacts.map((a) => (
        <ArtifactCard
          key={a.id || Math.random().toString(36)}
          artifact={a}
          selected={selectedId === a.id}
          viewMode="grid"
          onSelect={() => onSelect(a)}
          onDetails={() => onDetails(a)}
          onCopied={onCopied}
        />
      ))}
    </div>
  );
}
