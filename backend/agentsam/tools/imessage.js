/**
 * Agent Sam iMessage tools — Mac Messages.app relay via D1.
 * Worker enqueues; scripts/imessage/imessage_approval_daemon.py sends/polls.
 * BlueBubbles is retired.
 */
import { executeImessageCatalog } from '../../integrations/imessage-relay.js';

function asConfig(operation) {
  return { operation, channel: 'imessage', provider: 'imessage_mac' };
}

async function dispatch(operation, params, env, runContext) {
  return executeImessageCatalog(env, asConfig(operation), params || {}, runContext || {});
}

export const handlers = {
  agentsam_imessage_send: (params, env, runContext) => dispatch('send', params, env, runContext),
  agentsam_imessage_request_approval: (params, env, runContext) =>
    dispatch('request_approval', params, env, runContext),
  agentsam_imessage_approval_status: (params, env, runContext) =>
    dispatch('status', params, env, runContext),
};

export const imessageTools = handlers;
