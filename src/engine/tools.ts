/**
 * Path B: Tool-enabled generation using native Gemini API tools.
 *
 * Uses `GenerateContentConfig.tools` to pass built-in Gemini tools
 * like `googleSearch` directly to the API. The model will automatically
 * execute searches and synthesize results — no ReAct loop needed.
 */

import type { GenerateContentResponse, Content, GenerateContentConfig, Tool } from '@google/genai';
import type { ContentGenerator } from '@google/gemini-cli-core';
import { v4 as uuidv4 } from 'uuid';
import type { SupportedTool } from '../utils/tool-mapper.js';

export interface ToolGenerateParams {
  model: string;
  contents: Content[];
  systemInstruction?: string;
  enabledTools: SupportedTool[];
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
}

/**
 * Build native Gemini API tool declarations from our canonical tool IDs.
 *
 * These are built-in Gemini API tools — they don't require the CLI's
 * orchestration layer. The API handles execution automatically.
 */
function buildNativeTools(enabledTools: SupportedTool[]): Tool[] {
  const tools: Tool[] = [];

  for (const tool of enabledTools) {
    switch (tool) {
      case 'web_search':
        // Native Google Search grounding — the API executes the search
        // and synthesizes results automatically
        tools.push({ googleSearch: {} } as Tool);
        break;

      case 'web_fetch':
        // No native equivalent in Gemini API — handled via system prompt
        break;

      case 'shell':
        // Code execution tool — Gemini has native code_execution
        tools.push({ codeExecution: {} } as Tool);
        break;
    }
  }

  return tools;
}

/**
 * Generate content with native Gemini tools enabled.
 *
 * Uses `GenerateContentConfig.tools` to enable built-in capabilities:
 * - `googleSearch` → Real-time web search with grounded answers
 * - `codeExecution` → Server-side code execution
 */
export async function* generateWithTools(
  contentGenerator: ContentGenerator,
  params: ToolGenerateParams,
): AsyncGenerator<GenerateContentResponse> {
  const nativeTools = buildNativeTools(params.enabledTools);

  const config: GenerateContentConfig = {};

  if (params.systemInstruction) {
    config.systemInstruction = params.systemInstruction;
  }

  // Attach native tools — the Gemini API handles execution automatically
  if (nativeTools.length > 0) {
    config.tools = nativeTools;
  }

  if (params.temperature !== undefined) {
    config.temperature = params.temperature;
  }
  if (params.maxOutputTokens !== undefined) {
    config.maxOutputTokens = params.maxOutputTokens;
  }
  if (params.responseMimeType) {
    config.responseMimeType = params.responseMimeType;
  }
  if (params.responseSchema) {
    config.responseSchema = params.responseSchema;
  }

  const promptId = uuidv4();

  const stream = await contentGenerator.generateContentStream(
    {
      model: params.model,
      contents: params.contents,
      config,
    },
    promptId,
    'main' as any,
  );

  yield* stream;
}
