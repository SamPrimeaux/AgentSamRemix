import { SkeletonLine } from '@cloudflare/kumo';

export type LoadingSkeletonProps = {
  rows?: number;
  className?: string;
  compact?: boolean;
};

export function LoadingSkeleton({ rows = 4, className = '', compact = false }: LoadingSkeletonProps) {
  return (
    <div className={`flex w-full flex-col ${compact ? 'gap-1.5' : 'gap-3'} ${className}`.trim()} aria-busy="true">
      {Array.from({ length: rows }).map((_, index) => (
        <SkeletonLine
          key={index}
          minWidth={index === 0 ? 48 : index === rows - 1 ? 35 : 62}
          maxWidth={index === 0 ? 72 : index === rows - 1 ? 58 : 96}
          blockHeight={compact ? 20 : 28}
        />
      ))}
    </div>
  );
}
