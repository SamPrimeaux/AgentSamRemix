/**
 * ProjectHealthDonut — three-ring SVG donut for project cards and detail panel.
 *
 * Rings (outer → inner):
 *   1. Task completion  (project accent color)
 *   2. Health score     (indigo)
 *   3. Budget / deploy  (pink — uses health as proxy until deploy data is wired)
 *
 * All inputs are 0–1 ratios. Anything missing defaults to 0 so the card
 * always renders even on the fast-list pass before enrichment.
 */
import type { CSSProperties } from 'react';

type Props = {
  /** 0–1: completedTasks / totalTasks */
  taskRatio?: number;
  /** 0–100: project.health */
  healthScore?: number;
  /** 0–1: budgetUsed / budgetTotal */
  budgetRatio?: number;
  /** accent color for outer ring (hex or CSS color) */
  accentColor?: string;
  /** px diameter */
  size?: number;
  /** show center label */
  label?: boolean;
};

function arc(r: number, ratio: number) {
  const circ = 2 * Math.PI * r;
  const filled = Math.max(circ * Math.min(ratio, 1), ratio > 0 ? 2 : 0);
  return { strokeDasharray: `${filled} ${circ - filled}`, strokeDashoffset: circ * 0.25 };
}

export function ProjectHealthDonut({
  taskRatio = 0,
  healthScore = 0,
  budgetRatio = 0,
  accentColor = '#3B82F6',
  size = 56,
  label = true,
}: Props) {
  const cx = size / 2;
  const cy = size / 2;

  const rings: { r: number; sw: number; ratio: number; color: string }[] = [
    { r: (size / 2) - 4,  sw: size > 80 ? 6 : 4, ratio: taskRatio,               color: accentColor },
    { r: (size / 2) - 10, sw: size > 80 ? 5 : 3, ratio: healthScore / 100,        color: '#6366F1' },
    { r: (size / 2) - 15, sw: size > 80 ? 4 : 3, ratio: budgetRatio || healthScore / 100 * 0.6, color: '#EC4899' },
  ];

  const scoreLabel = Math.round(
    taskRatio * 40 + (healthScore / 100) * 40 + (budgetRatio || 0) * 20 * 100,
  );
  const displayScore = healthScore > 0 ? Math.round(healthScore) : scoreLabel > 0 ? scoreLabel : null;

  const style: CSSProperties = {
    transform: 'rotate(-90deg)',
    display: 'block',
    flexShrink: 0,
  };

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={style} aria-hidden>
        {rings.map((ring, i) => {
          const a = arc(ring.r, ring.ratio);
          return (
            <g key={i}>
              {/* track */}
              <circle
                cx={cx} cy={cy} r={ring.r}
                fill="none"
                stroke="rgba(255,255,255,0.07)"
                strokeWidth={ring.sw}
              />
              {/* fill */}
              <circle
                cx={cx} cy={cy} r={ring.r}
                fill="none"
                stroke={ring.color}
                strokeWidth={ring.sw}
                strokeLinecap="round"
                strokeDasharray={a.strokeDasharray}
                strokeDashoffset={a.strokeDashoffset}
                style={{ transition: 'stroke-dasharray 0.8s ease' }}
              />
            </g>
          );
        })}
      </svg>
      {label && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          {displayScore !== null ? (
            <>
              <span style={{ fontSize: size > 80 ? 20 : 11, fontWeight: 700, color: 'var(--dashboard-text, #F1F5F9)', lineHeight: 1 }}>
                {displayScore}
              </span>
              <span style={{ fontSize: size > 80 ? 8 : 7, color: 'var(--dashboard-muted, #64748B)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 1 }}>
                {size > 80 ? 'health' : ''}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 9, color: 'var(--dashboard-muted, #64748B)' }}>—</span>
          )}
        </div>
      )}
    </div>
  );
}

export default ProjectHealthDonut;
