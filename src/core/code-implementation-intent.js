/**
 * code-implementation-intent — GUTTED (pre-LLM nuke 2026-08).
 * No message regex → tool family / workflow / catalog pin.
 */

export const CODE_IMPLEMENTATION_TOOL_NAMES = Object.freeze([]);

/** @deprecated Always false. */
export function isExplicitGithubCatalogToolIntent(_message) {
  return false;
}

/** @deprecated Always []. */
export function extractExplicitCatalogToolKeys(_message) {
  return [];
}

/** @deprecated Always false. */
export function namedToolsIncludeWriteSkip(_names) {
  return false;
}

/** @deprecated Always null. */
export function resolveForcedExplicitCatalogTool(_message, _tools) {
  return null;
}

/** @deprecated Always {}. */
export function buildExplicitCatalogToolInput(_toolName, _message) {
  return {};
}

/** @deprecated Always false. */
export function isReadOnlyFileContextIntent(_message) {
  return false;
}

/** @deprecated Always false. */
export function isReadOnlyRepoSearchIntent(_message) {
  return false;
}

/** @deprecated Always false. */
export function isCodeImplementationIntent(_message) {
  return false;
}

/** @deprecated Always false. */
export function messageExplicitlyRequestsBrowserInspection(_message) {
  return false;
}

/** @deprecated Always false. */
export function isCodeImplementationToolName(_name) {
  return false;
}

/** @deprecated */
export function catalogToolStem(name) {
  return String(name || '').trim().toLowerCase();
}
