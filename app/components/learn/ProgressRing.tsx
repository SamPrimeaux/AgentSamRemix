import React from 'react';

interface Props {
  percent: number;
  size: number;
  strokeWidth?: number;
}

export default function ProgressRing({ percent, size, strokeWidth = 3 }: Props) {
  const r = (size - strokeWidth * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(Math.max(percent, 0), 100) / 100) * circ;
  const center = size / 2;

  return (
    <svg width={size} height={size} style={{ flexShrink: 0, transform: 'rotate(-90deg)' }}>
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="var(--border-subtle)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="var(--solar-cyan)"
        strokeWidth={strokeWidth}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.4s ease' }}
      />
      <text
        x={center}
        y={center}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          transform: `rotate(90deg)`,
          transformOrigin: `${center}px ${center}px`,
          fontSize: size / 4,
          fill: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          fontWeight: 400,
        }}
      >
        {Math.round(percent)}
      </text>
    </svg>
  );
}

