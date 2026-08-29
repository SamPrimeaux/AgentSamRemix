import { T } from "../constants";
import { go } from "../overviewLinks";

export function PulseEmpty({
  message,
  href,
  linkLabel = "Open analytics",
}: {
  message: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "24px 16px",
        minHeight: 120,
        textAlign: "center",
      }}
    >
      <p style={{ margin: 0, fontSize: 11, color: T.muted, lineHeight: 1.5, maxWidth: 220 }}>{message}</p>
      {href ? (
        <button
          type="button"
          onClick={() => go(href)}
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: T.accent,
            background: "color-mix(in srgb, var(--accent-secondary, var(--solar-cyan)) 10%, transparent)",
            border: `1px solid color-mix(in srgb, var(--accent-secondary, var(--solar-cyan)) 25%, transparent)`,
            borderRadius: 6,
            padding: "6px 12px",
            cursor: "pointer",
            fontFamily: T.font,
          }}
        >
          {linkLabel}
        </button>
      ) : null}
    </div>
  );
}
