/**
 * StudioLoadingScreen — lightweight canvas-drawn loading state.
 * Renders a CSS grid scene skeleton while Three.js boots.
 * Uses only CSS vars — no JS canvas, zero deps beyond React.
 */
import React, { useEffect, useState } from 'react';

const TIPS = [
  'Tip: Cmd+K opens operator search',
  'Tip: Drop a .glb into the viewport to import it',
  'Tip: Click ≡ Properties to open the inspector',
  'Tip: Press Delete to remove selected objects',
  'Tip: Scroll to zoom, right-click drag to pan',
];

export function StudioLoadingScreen({ visible }: { visible: boolean }) {
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  const [dots, setDots] = useState(1);

  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => setDots((d) => (d % 3) + 1), 500);
    return () => window.clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="sls__backdrop">
      {/* Fake viewport grid — pure CSS, no canvas */}
      <div className="sls__scene">
        <div className="sls__grid" aria-hidden="true">
          {Array.from({ length: 64 }, (_, i) => (
            <div key={i} className="sls__grid-cell" />
          ))}
        </div>
        {/* Fake object silhouette */}
        <div className="sls__object" aria-hidden="true" />
        {/* Fake axis gizmo */}
        <div className="sls__gizmo" aria-hidden="true">
          <span className="sls__gizmo-x">X</span>
          <span className="sls__gizmo-y">Y</span>
          <span className="sls__gizmo-z">Z</span>
        </div>
      </div>

      {/* Centre loader */}
      <div className="sls__overlay">
        <div className="sls__wordmark">IAM <span>Studio</span></div>
        <div className="sls__bar-wrap">
          <div className="sls__bar-fill" />
        </div>
        <div className="sls__label">
          Initializing viewport{'.'.repeat(dots)}
        </div>
        <div className="sls__tip">{tip}</div>
      </div>
    </div>
  );
}
