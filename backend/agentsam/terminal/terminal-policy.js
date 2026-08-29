import { parseTerminalHandlerConfig } from './routing-policy.js';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * @param {string} toolKey
 * @param {unknown} handlerConfig
 */
export function isPrivilegedTerminalTool(toolKey, handlerConfig) {
  const config = parseTerminalHandlerConfig(handlerConfig);
  if (config.requires_privileged_terminal === true || config.requires_privileged_terminal === 1) {
    return true;
  }
  if (config.requires_privileged_terminal === false || config.requires_privileged_terminal === 0) {
    return false;
  }
  if (String(config.target_type || '').trim() === 'platform_vm') return true;
  return trim(toolKey).toLowerCase() === 'agentsam_container_exec';
}
