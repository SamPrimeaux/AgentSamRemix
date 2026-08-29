/**
 * Race an agent run against a real abort deadline. Rejecting alone leaves the
 * provider fetch alive; aborting the linked controller cancels the fetch that
 * the provider integrations receive.
 *
 * @template T
 * @param {() => Promise<T>} start
 * @param {number} ms
 * @param {AbortController} controller
 * @returns {Promise<T>}
 */
export async function withAbortableAgentRunTimeout(start, ms, controller) {
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  const timeoutError = new Error('agent_run_timeout');
  timeoutError.name = 'TimeoutError';
  timeoutError.code = 'agent_run_timeout';

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      // Queue the typed timeout rejection before abort listeners can translate
      // the same deadline into a generic cancellation.
      reject(timeoutError);
      if (!controller.signal.aborted) controller.abort(timeoutError);
    }, ms);
  });

  try {
    return await Promise.race([Promise.resolve().then(start), timeoutPromise]);
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}
