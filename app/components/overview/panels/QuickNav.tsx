import { T } from "../constants";

export function QuickNav() {
  const links = [
    { label: "Projects", href: "/dashboard/projects" },
    { label: "Tasks", href: "/dashboard/tasks" },
    { label: "Artifacts", href: "/dashboard/artifacts" },
    { label: "Docs", href: "/dashboard/settings/docs" },
    { label: "Finance", href: "/dashboard/finance" },
  ];
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: T.muted,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 7,
            padding: "6px 16px",
            textDecoration: "none",
            letterSpacing: "0.04em",
            transition: "border-color 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = T.accent;
            (e.currentTarget as HTMLElement).style.color = T.accent;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = T.border;
            (e.currentTarget as HTMLElement).style.color = T.muted;
          }}
        >
          {l.label}
        </a>
      ))}
    </div>
  );
}
