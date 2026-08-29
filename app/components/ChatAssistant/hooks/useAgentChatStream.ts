/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Thin facade: public API for Agent Sam SSE consume (implementation in hooks/stream/).
 */

export type { AgentHandoffPayload, ConsumeAgentChatSseContext } from './stream/sseTypes';
export { runSseConsumeLoop as consumeAgentChatSseBody } from './stream/useSseConsume';
