/** Shared client-surface contract. Keep this facade so dashboard imports remain stable. */
export {
  detectClientSurface,
  isMobileClientSurface,
  detectClientEnvironment,
  capabilitiesForSurface,
} from '@inneranimalmedia/client-core/platform';
export type { ClientSurface, ClientCapabilities, ClientEnvironment } from '@inneranimalmedia/client-core/platform';
