/**
 * Tool Service: Computer Use & Specialized Agents
 * Implements authoritative schemas for bash_20250124, text_editor_20250728, etc.
 * Designed for Claude 3.5 Sonnet v2 / Opus 4.6.
 */

/**
 * Returns the official Anthropic Computer Use tool schemas.
 * Includes Cache Control breakpoints to optimize expensive system prompts.
 */
export function getComputerUseTools(options = {}) {
  const { includeBash = true, includeEditor = true, enableCaching = true } = options;
  const tools = [];

  if (includeBash) {
    tools.push({
      name: "bash",
      type: "bash_20250124",
      cache_control: enableCaching ? { type: "ephemeral" } : undefined
    });
  }

  if (includeEditor) {
    tools.push({
      name: "str_replace_editor",
      type: "text_editor_20250124",
      cache_control: enableCaching ? { type: "ephemeral" } : undefined
    });
  }

  return tools;
}

/**
 * Registry for specialized 2026-era tool schemas.
 */
export const specializedSchemas = {
  bash_20250124: {
    name: "bash",
    type: "bash_20250124",
    description: "Run bash commands in a secure sandbox. Use for system administration, file management, and tool execution."
  },
  code_execution_20250825: {
    name: "code_execution",
    type: "code_execution_20250825",
    description: "Anthropic-hosted sandbox: Bash, Python, file create/view/edit (baseline; Haiku + all listed models).",
  },
  code_execution_20260120: {
    name: "code_execution",
    type: "code_execution_20260120",
    description: "Anthropic sandbox with REPL persistence + programmatic tool calling (Sonnet/Opus 4.5+ only).",
  },
  text_editor_20250728: {
    name: "str_replace_based_edit_tool",
    type: "text_editor_20250728",
    description: "High-performance text editing with string replacement and file viewing."
  },
  web_search_20260209: {
    name: "web_search",
    type: "web_search_20260209",
    description: "Search the web with domain filtering and location-aware results."
  },
  web_fetch_20260209: {
    name: "web_fetch",
    type: "web_fetch_20260209",
    description: "Fetch web content with cache bypass capabilities and dynamic relevance filtering."
  }
};
