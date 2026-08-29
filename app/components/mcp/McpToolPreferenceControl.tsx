function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type McpToolPreference = "deny" | "read" | "ask" | "allow";

export const MCP_TOOL_PREFERENCE_OPTIONS: Array<{
  value: McpToolPreference;
  label: string;
  hint: string;
}> = [
  { value: "deny", label: "Deny", hint: "Block tools in this group" },
  { value: "read", label: "Read only", hint: "Read-class tools only" },
  { value: "ask", label: "Ask each time", hint: "Allow; sensitive tools still need approval" },
  { value: "allow", label: "Always allow", hint: "Allow all tools in this group" },
];

export type McpToolPreferenceControlProps = {
  value: McpToolPreference;
  onChange: (value: McpToolPreference) => void;
  disabled?: boolean;
  compact?: boolean;
  id?: string;
};

export function McpToolPreferenceControl({
  value,
  onChange,
  disabled,
  compact,
  id,
}: McpToolPreferenceControlProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-1",
        compact ? "gap-0.5" : "gap-1",
      )}
      role="radiogroup"
      aria-label="Tool permission"
      id={id}
    >
      {MCP_TOOL_PREFERENCE_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.hint}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-md border text-[10px] font-semibold transition-colors px-2 py-1",
              compact && "px-1.5 py-0.5 text-[9px]",
              active
                ? opt.value === "deny"
                  ? "border-red-500/40 bg-red-500/15 text-red-300"
                  : opt.value === "allow"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : "border-sky-500/40 bg-sky-500/15 text-sky-200"
                : "border-[var(--border-subtle)] bg-[var(--bg-panel)] text-muted hover:text-main",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
