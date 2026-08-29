/// <reference types="vite/client" />

/**
 * Agent Sam dashboard shell build label. Production builds may set `VITE_SHELL_VERSION` from CI.
 * Fallback is a stable default for local Vite dev.
 */
export const SHELL_VERSION = import.meta.env.VITE_SHELL_VERSION ?? 'v1.0.0-agentsam';
