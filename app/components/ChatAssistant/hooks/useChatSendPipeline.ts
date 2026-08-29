/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Peel A2 facade — send pipeline lives in createChatSendHandler (logic module ≤1000).
 */

import { createChatSendHandler } from './createChatSendHandler';

export { createChatSendHandler };

/** Returns a stable-enough handleSend for the current render's closure bag `d`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useChatSendPipeline(d: any) {
  return { handleSend: createChatSendHandler(d) };
}
