/**
 * Vision / attachment resolution for agent-controller turns.
 */

/**
 * @param {any} env
 * @param {{
 *   body: Record<string, unknown>,
 *   message: string,
 *   sessionId: string|null|undefined,
 *   chatMessages: any[],
 * }} opts
 * @returns {Promise<{
 *   chatMessages: any[],
 *   visionUploadActive: boolean,
 *   visionUploadError: any,
 *   imageHandlingMode: string,
 *   visionUploadFiles: any[],
 *   visionErrorUserMessage: (code: string, message?: string) => string,
 *   VISION_ERROR_CODES: Record<string, string>,
 *   chatMessagesHaveVisionUpload: (msgs: any[]) => boolean,
 * }>}
 */
export async function resolveAgentVisionContext(env, opts) {
  const {
    resolveChatVisionUpload,
    applyVisionBlocksToChatMessages,
    chatMessagesHaveVisionUpload,
    collectChatVisionUploadFiles,
    resolveImageHandlingMode,
    IMAGE_HANDLING_MODES,
    visionErrorUserMessage,
    VISION_ERROR_CODES,
    loadTemporaryVisionImages,
  } = opts.services || {};
  if (
    typeof resolveChatVisionUpload !== 'function' ||
    typeof applyVisionBlocksToChatMessages !== 'function' ||
    typeof chatMessagesHaveVisionUpload !== 'function' ||
    typeof collectChatVisionUploadFiles !== 'function' ||
    typeof resolveImageHandlingMode !== 'function' ||
    !IMAGE_HANDLING_MODES ||
    typeof visionErrorUserMessage !== 'function' ||
    !VISION_ERROR_CODES
  ) {
    throw new Error('vision_services_required');
  }

  let chatMessages = Array.isArray(opts.chatMessages) ? opts.chatMessages : [];
  let visionUploadActive = false;
  let visionUploadError = null;
  let imageHandlingMode = IMAGE_HANDLING_MODES.EPHEMERAL_VISION;
  const body = opts.body || {};
  const message = String(opts.message || '');
  const sessionId = opts.sessionId;
  const visionUploadFiles = collectChatVisionUploadFiles(body);

  if (visionUploadFiles.length) {
    const vision = await resolveChatVisionUpload(body, {
      message,
      sessionId,
      env,
    });
    imageHandlingMode = vision.mode;
    if (!vision.ok && vision.error) {
      visionUploadError = vision.error;
    } else if (vision.blocks.length) {
      chatMessages = applyVisionBlocksToChatMessages(chatMessages, message, vision.blocks);
      visionUploadActive = true;
    }
  } else if (
    resolveImageHandlingMode(body, message) === IMAGE_HANDLING_MODES.TEMPORARY_CONTEXT &&
    sessionId &&
    env
  ) {
    if (typeof loadTemporaryVisionImages !== 'function') {
      throw new Error('temporary_vision_service_required');
    }
    const cached = await loadTemporaryVisionImages(env, sessionId);
    if (cached.length) {
      chatMessages = applyVisionBlocksToChatMessages(chatMessages, message, cached);
      visionUploadActive = true;
      imageHandlingMode = IMAGE_HANDLING_MODES.TEMPORARY_CONTEXT;
    }
  }

  return {
    chatMessages,
    visionUploadActive,
    visionUploadError,
    imageHandlingMode,
    visionUploadFiles,
    visionErrorUserMessage,
    VISION_ERROR_CODES,
    chatMessagesHaveVisionUpload,
  };
}
