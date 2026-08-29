/**
 * agentsam_commands row helpers — CLI toolbox schema (handler_kind + shell_line).
 */

/** @param {Record<string, unknown> | null | undefined} row */
export function commandShellLine(row) {
  if (!row) return '';
  const shell = row.shell_line != null ? String(row.shell_line).trim() : '';
  if (shell) return shell;
  // compat: pre-rebuild archive readers only
  const legacy = row.mapped_command != null ? String(row.mapped_command).trim() : '';
  return legacy;
}

/** @param {Record<string, unknown> | null | undefined} row */
export function commandHandlerKind(row) {
  if (!row) return '';
  const kind = row.handler_kind != null ? String(row.handler_kind).trim() : '';
  if (kind) return kind;
  const router = row.router_type != null ? String(row.router_type).trim() : '';
  if (router === 'script') return 'script';
  if (router === 'workflow') return 'workflow';
  if (router === 'in_app' || router === 'agent') return 'in_app';
  if (router === 'terminal_builtin') return 'tool';
  if (commandShellLine(row)) return 'shell';
  if (row.tool_key) return 'tool';
  return router || 'shell';
}

/** @param {Record<string, unknown> | null | undefined} row */
export function commandHandlerRef(row) {
  if (!row) return '';
  const ref = row.handler_ref != null ? String(row.handler_ref).trim() : '';
  if (ref) return ref;
  const router = commandHandlerKind(row);
  if (router === 'workflow' && row.workflow_key) return String(row.workflow_key).trim();
  if (row.tool_key) return String(row.tool_key).trim();
  if (router === 'in_app') return commandShellLine(row) || String(row.slug || '').trim();
  return '';
}

/** @param {Record<string, unknown> | null | undefined} row */
export function commandShowsInSlash(row) {
  const surface = row?.surface != null ? String(row.surface) : null;
  if (surface) return surface === 'slash' || surface === 'both';
  return Number(row?.show_in_slash ?? 1) === 1;
}

/** @param {Record<string, unknown> | null | undefined} row */
export function commandShowsInPalette(row) {
  const surface = row?.surface != null ? String(row.surface) : null;
  if (surface) return surface === 'palette' || surface === 'both';
  return Number(row?.show_in_palette ?? 1) === 1;
}

/** Render shell template placeholders from args. */
export function renderShellLine(template, args = {}) {
  const base = String(template || '');
  if (!base) return '';
  return base.replace(/\{([A-Z_]+)\}/g, (_, k) => {
    const upper = String(k);
    const lower = upper.toLowerCase();
    if (args[upper] != null) return String(args[upper]);
    if (args[lower] != null) return String(args[lower]);
    return `{${k}}`;
  });
}

/** @param {Record<string, unknown> | null | undefined} row */
export function commandPaletteDto(row) {
  if (!row) return row;
  const shell = commandShellLine(row);
  return {
    id: row.id,
    slug: row.slug,
    display_name: row.display_name,
    description: row.description,
    category: row.category,
    handler_kind: commandHandlerKind(row),
    handler_ref: commandHandlerRef(row),
    shell_line: shell || null,
    mapped_command: shell || null,
    risk_level: row.risk_level,
    requires_confirmation: row.requires_confirmation,
    sort_order: row.sort_order,
    workspace_id: row.workspace_id,
    tenant_id: row.tenant_id,
    surface: row.surface,
  };
}
