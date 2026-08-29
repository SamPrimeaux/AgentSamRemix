/**
 * Assemble optional surface context blocks for the agent system/user prompt.
 */

/**
 * @param {{
 *   body: Record<string, unknown>,
 *   message: string,
 *   browserContextPayload: any,
 *   activeFileEnvelope: any,
 *   profile: any,
 *   filesSource?: string|null,
 *   filesSourcePath?: string|null,
 *   activeRepo?: string|null,
 *   activeBranch?: string|null,
 *   fsaRoot?: boolean,
 * }} opts
 * @returns {{
 *   contextBlock: string,
 *   mailSurfaceRaw: any,
 *   databaseSurfaceRaw: any,
 * }}
 */
export function buildAgentSurfaceContextBlock(opts) {
  const {
    extractMailSurfaceContext,
    formatMailSurfaceContextForAgent,
    formatDatabaseContextForAgent,
    formatActiveFileForAgent,
    messageReferencesActiveFile,
  } = opts.services || {};
  if (
    typeof extractMailSurfaceContext !== 'function' ||
    typeof formatMailSurfaceContextForAgent !== 'function' ||
    typeof formatDatabaseContextForAgent !== 'function' ||
    typeof formatActiveFileForAgent !== 'function' ||
    typeof messageReferencesActiveFile !== 'function'
  ) {
    return { contextBlock: '', mailSurfaceRaw: null, databaseSurfaceRaw: null };
  }
  const body = opts.body || {};
  const message = String(opts.message || '');
  const browserContextPayload = opts.browserContextPayload;
  const profile = opts.profile || {};
  let contextBlock = '';

  const mailSurfaceRaw = extractMailSurfaceContext(browserContextPayload, body);
  const mailSurfaceBlock = formatMailSurfaceContextForAgent(mailSurfaceRaw);
  if (mailSurfaceBlock) {
    contextBlock = contextBlock
      ? `${contextBlock}\n\n## Mail context\n\n${mailSurfaceBlock}`
      : `## Mail context\n\n${mailSurfaceBlock}`;
    console.info(
      '[agent-controller] mail_surface_context_injected',
      JSON.stringify({
        route: profile.refined_route_key || profile.routing_task_type,
        chars: mailSurfaceBlock.length,
        preview_count: Array.isArray(mailSurfaceRaw?.inboxPreview)
          ? mailSurfaceRaw.inboxPreview.length
          : 0,
      }),
    );
  }

  const databaseSurfaceRaw =
    browserContextPayload &&
    typeof browserContextPayload === 'object' &&
    browserContextPayload.databaseContext &&
    typeof browserContextPayload.databaseContext === 'object'
      ? browserContextPayload.databaseContext
      : body.databaseContext && typeof body.databaseContext === 'object'
        ? body.databaseContext
        : null;
  const databaseSurfaceBlock = formatDatabaseContextForAgent(databaseSurfaceRaw);
  if (databaseSurfaceBlock) {
    contextBlock = contextBlock
      ? `${contextBlock}\n\n## Database Studio context\n\n${databaseSurfaceBlock}`
      : `## Database Studio context\n\n${databaseSurfaceBlock}`;
    console.info(
      '[agent-controller] database_surface_context_injected',
      JSON.stringify({
        studio_section:
          databaseSurfaceRaw?.studioSection ?? databaseSurfaceRaw?.studio_section ?? null,
        provider: databaseSurfaceRaw?.provider ?? null,
        resource_ref:
          databaseSurfaceRaw?.resourceRef ?? databaseSurfaceRaw?.resource_ref ?? null,
        chars: databaseSurfaceBlock.length,
      }),
    );
  } else {
    const studioRoute =
      String(
        profile.refined_route_key ||
          profile.routing_task_type ||
          body.route_key ||
          body.routeKey ||
          '',
      ).trim() === 'database_studio';
    if (studioRoute) {
      console.warn(
        '[agent-controller] database_surface_context_missing',
        JSON.stringify({
          route_key: 'database_studio',
          has_browser_context: Boolean(browserContextPayload),
        }),
      );
    }
  }

  const activeFileEnvelope = opts.activeFileEnvelope ?? null;
  if (activeFileEnvelope && messageReferencesActiveFile(message)) {
    const activeFileBlock = formatActiveFileForAgent(activeFileEnvelope);
    if (activeFileBlock) {
      contextBlock = contextBlock
        ? `${contextBlock}\n\n## Active editor file\n\n${activeFileBlock}`
        : `## Active editor file\n\n${activeFileBlock}`;
      console.info(
        '[agent-controller] active_file_context_injected',
        JSON.stringify({
          source: activeFileEnvelope.source,
          path: activeFileEnvelope.path,
          chars: activeFileBlock.length,
          full_content: true,
        }),
      );
    }
  }

  return { contextBlock, mailSurfaceRaw, databaseSurfaceRaw };
}
