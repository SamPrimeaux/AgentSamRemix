export type CommandPaletteChip = 'all' | 'commands' | 'd1' | 'r2' | 'workflows' | 'files';

export type OpenCommandPaletteDetail = {
  query?: string;
  facets?: string[];
  chip?: CommandPaletteChip;
};

export const IAM_OPEN_COMMAND_PALETTE = 'iam-open-command-palette';

/** Status bar / Cmd+K — trigger Workers Builds deploy (same as synchronize). */
export const IAM_GIT_SYNC_PUBLISH = 'iam-git-sync-publish';

/** Open repo + branch menu in top global nav dropdown. */
export const IAM_OPEN_GIT_REPO_MENU = 'iam-open-git-repo-menu';

/** Open terminal connection menu (status bar router). */
export const IAM_OPEN_CONNECTION_MENU = 'iam-open-connection-menu';

/** Connect terminal from connection menu — detail.target: local | cloud | sandbox */
export const IAM_TERMINAL_CONNECT = 'iam-terminal-connect';

export const IAM_TERMINAL_SETUP_WIZARD = 'iam-terminal-setup-wizard';

export const IAM_TERMINAL_CONFIGURE = 'iam-terminal-configure';

export function openGitRepoMenu(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(IAM_OPEN_GIT_REPO_MENU));
}

export function openConnectionMenu(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(IAM_OPEN_CONNECTION_MENU));
}

/** Open the global Cmd+K palette (UnifiedSearchBar) from status bar / git chrome. */
export function openCommandPalette(detail?: OpenCommandPaletteDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(IAM_OPEN_COMMAND_PALETTE, { detail: detail ?? {} }));
}
