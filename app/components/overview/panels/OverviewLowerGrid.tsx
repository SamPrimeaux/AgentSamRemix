import type { ReactNode } from "react";

const GRID_STYLE = `
.ov-lower-grid {
  display: grid;
  gap: 10px;
  margin-bottom: 20px;
  grid-template-columns: 1fr;
}
@media (min-width: 900px) {
  .ov-lower-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.ov-lower-cell {
  min-width: 0;
  min-height: 0;
  display: flex;
}
.ov-lower-cell > * {
  flex: 1;
  width: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
`;

/** Responsive 2-column grid for overview rows 1–3 (workflow, tools, errors, tokens, deploys, health). */
export function OverviewLowerGrid({ children }: { children: ReactNode }) {
  const cells = Array.isArray(children) ? children : [children];
  return (
    <>
      <style>{GRID_STYLE}</style>
      <div className="ov-lower-grid">
        {cells.map((child, i) => (
          <div key={i} className="ov-lower-cell">
            {child}
          </div>
        ))}
      </div>
    </>
  );
}
