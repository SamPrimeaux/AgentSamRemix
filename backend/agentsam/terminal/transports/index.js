import { localTerminalTransport } from './local.js';
import { remoteTerminalTransport } from './remote.js';
import { sandboxTerminalTransport } from './sandbox.js';
import { ephemeralContainerTransport } from './ephemeral.js';

const TRANSPORTS = {
  local: localTerminalTransport,
  remote: remoteTerminalTransport,
  sandbox: sandboxTerminalTransport,
};

export function resolveTerminalTargetTransport(plan) {
  if (plan?.target_lane === 'sandbox' && plan?.lifecycle === 'ephemeral') {
    return ephemeralContainerTransport;
  }
  const transport = TRANSPORTS[plan?.target_lane];
  if (!transport) throw new Error(`unsupported_terminal_target:${plan?.target_type || 'unknown'}`);
  return transport;
}
