import { extractExplicitCatalogToolKeys } from '../../../../src/core/code-implementation-intent.js';

export async function applyNamedCatalogPins(env, loopBag, emit, userText) {
  const namedKeys = extractExplicitCatalogToolKeys(userText);
  if (!namedKeys.length || !env?.DB || !Array.isArray(loopBag.activeTools)) return;
  try {
    const { hydrateNamedCatalogTools } = await import(
      '../../../../src/core/progressive-tool-discovery.js'
    );
    const pinned = await hydrateNamedCatalogTools(env, loopBag.activeTools, namedKeys, {});
    if (pinned.added.length) {
      loopBag.activeTools = pinned.tools;
      emit('tools_hydrated', {
        source: 'named_catalog_pin',
        added: pinned.added,
        active_tools: loopBag.activeTools.length,
      });
    }
  } catch (error) {
    console.warn('[agent] named_catalog_pin', error?.message ?? error);
  }
}

export async function applyImageCapabilityPins(env, loopBag, emit, mcpCtx, userText) {
  try {
    const turnDecision = mcpCtx?.turnDecision || mcpCtx?.precomputedTurnDecision || null;
    loopBag.imageAskForTurn = turnDecision?.imageFastPath === true;
    if (!loopBag.imageAskForTurn || !env?.DB || !Array.isArray(loopBag.activeTools)) return;
    const { pinImageGenerationToolsForTurn } = await import(
      '../../../../src/core/progressive-tool-discovery.js'
    );
    const pinned = await pinImageGenerationToolsForTurn(env, loopBag.activeTools, {
      userMessage: userText,
      imageAsk: true,
      allowMediaTools: true,
    });
    if (pinned.added.length) {
      loopBag.activeTools = pinned.tools;
      emit('tools_hydrated', {
        source: 'image_capability_pin',
        added: pinned.added,
        active_tools: loopBag.activeTools.length,
      });
    }
  } catch (error) {
    console.warn('[agent] image_capability_pin', error?.message ?? error);
  }
}
