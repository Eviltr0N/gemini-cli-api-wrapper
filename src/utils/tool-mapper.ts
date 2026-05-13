/**
 * Maps OpenAI-style tool names to core library tool identifiers.
 */

/** Supported tool identifiers for per-request enablement. */
export type SupportedTool = 'web_search' | 'web_fetch' | 'shell';

/**
 * Map from various client-side tool names to our canonical tool IDs.
 */
const TOOL_ALIAS_MAP: Record<string, SupportedTool> = {
  // Web search aliases
  web_search: 'web_search',
  google_search: 'web_search',
  search: 'web_search',

  // Web fetch aliases
  web_fetch: 'web_fetch',
  fetch: 'web_fetch',
  browse: 'web_fetch',

  // Shell / code execution aliases
  shell: 'shell',
  code_execution: 'shell',
  execute: 'shell',
  run_code: 'shell',
};

/** All available tool IDs */
export const ALL_TOOLS: SupportedTool[] = ['web_search', 'web_fetch', 'shell'];

export interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * Extract canonical tool names from an OpenAI-style tools array.
 * Returns undefined if no recognized tools are found.
 */
export function resolveTools(
  tools: OpenAIToolDef[] | undefined,
): SupportedTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  const resolved = new Set<SupportedTool>();

  for (const tool of tools) {
    if (tool.type !== 'function') continue;
    const canonical = TOOL_ALIAS_MAP[tool.function.name.toLowerCase()];
    if (canonical) {
      resolved.add(canonical);
    }
  }

  return resolved.size > 0 ? Array.from(resolved) : undefined;
}
