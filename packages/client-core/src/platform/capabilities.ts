import type { ClientCapabilities, ClientEnvironment, ClientSurface } from '../../../platform-contracts/src/index';
import { detectClientSurface } from './surface';

function browserCapability(name: string): boolean {
  return typeof navigator !== 'undefined' && name in navigator;
}

export function capabilitiesForSurface(surface: ClientSurface): ClientCapabilities {
  const nativeMobile = surface === 'native_ios' || surface === 'native_android';
  const mobile = nativeMobile || surface === 'mobile_ios' || surface === 'mobile_web' || surface === 'web_mobile' || surface === 'pwa_ios';
  return {
    camera: mobile && (nativeMobile || browserCapability('mediaDevices')),
    filesystem: nativeMobile || (!mobile && typeof window !== 'undefined' && 'showOpenFilePicker' in window),
    uploads: true,
    push_notifications: nativeMobile || (typeof window !== 'undefined' && 'Notification' in window),
    share: nativeMobile || browserCapability('share'),
    haptics: nativeMobile || browserCapability('vibrate'),
    local_terminal: !mobile,
    remote_terminal: true,
    sandbox_terminal: true,
  };
}

export function detectClientEnvironment(surface: ClientSurface = detectClientSurface()): ClientEnvironment {
  return { surface, capabilities: capabilitiesForSurface(surface) };
}
