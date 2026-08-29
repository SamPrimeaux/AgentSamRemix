/**
 * backend/browser — public surface for browser live session + Browser Run helpers.
 */

export {
  assertAgentRunAccess,
  assertBrowserLiveDoAvailable,
  assertBrowserSessionAccess,
  browserLiveDoRequired,
  cancelBrowserHumanInputViaDo,
  closeAgentLiveBrowserSessionViaDo,
  ensureAgentLiveBrowserSessionViaDo,
  getAgentLiveBrowserSessionViaDo,
  getBrowserLiveDoHealth,
  getBrowserLiveEventsViaDo,
  getBrowserLiveStub,
  patchAgentLiveBrowserSessionViaDo,
  proxyBrowserLiveWebSocket,
  proxyToBrowserLiveDo,
  refreshAgentLiveBrowserUrlViaDo,
  requestBrowserHumanInputViaDo,
  signalBrowserHumanInputResumeViaDo,
} from './sessions/client.js';

export {
  LIVE_VIEW_URL_TTL_MS,
  LIVE_VIEW_REFRESH_MS,
  DEFAULT_AGENT_KEEP_ALIVE_MS,
  cancelBrowserHumanInput,
  closeAgentLiveBrowserSession,
  emitBrowserLiveSessionSse,
  ensureAgentLiveBrowserSession,
  getAgentLiveBrowserSession,
  liveSessionPayload,
  persistAgentLiveBrowserSession,
  refreshAgentLiveBrowserLiveUrl,
  requestBrowserHumanInput,
  signalHumanInputResume,
  toAgentLiveBrowserSession,
} from './sessions/live-session.js';

export {
  newBrowserSessionId,
  resolveBrowserRunScopeId,
  resolveBrowserSessionScopeId,
  browserToolRequiresSession,
} from './sessions/scope.js';

export {
  applyBrowserRunLiveViewMode,
  createBrowserRunSession,
  deleteBrowserRunSession,
  navigateBrowserRunTab,
  pickBrowserRunPageTarget,
  refreshBrowserRunLiveView,
} from './cloudflare/browser-run.js';

export { extractBrowserNavigateUrl, resolveCatalogToolParams } from './policy/urls.js';

export {
  runBrowserBuiltinTool,
  withBrowserPage,
  resolveBrowserToolUrl,
  urlMatchesExpected,
} from './tools/dispatch.js';

export { runPlaywrightScreenshotJob } from './runtime/screenshot.js';

export { lookupBrowserTrustedOrigin, isBrowserOriginPersistentlyTrusted } from './policy/trust.js';
export {
  EMBED_MODES,
  hostFromUrl,
  originRequiresBrowserRunEmbed,
  probeEmbedMode,
  resolveEmbedModeFromD1,
  upsertEmbedPolicy,
  ensureEmbedPolicyTable,
} from './policy/embed.js';

export { executeBrowserCaptureContext } from './capture/context.js';
export {
  loadEphemeralCapture,
  saveBrowserCaptureForUser,
  putAgentBrowserScreenshotToR2,
  resolveBrowserScreenshotCapture,
  shouldPersistCaptureToPlatformR2,
} from './capture/storage.js';

export { BROWSER_RUN_QUICKACTIONS } from './quick-actions/actions.js';
