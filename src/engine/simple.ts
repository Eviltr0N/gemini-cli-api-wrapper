/**
 * Path A: Simple generation engine using ContentGenerator directly.
 *
 * Used for requests WITHOUT tool use. Gives us:
 * - Clean system prompt (no CLI bloat)
 * - Native JSON schema enforcement via responseMimeType + responseSchema
 * - Direct control over all generation params
 */

import type { GenerateContentResponse, Content, GenerateContentConfig } from '@google/genai';
import type { ContentGenerator } from '@google/gemini-cli-core';
import { v4 as uuidv4 } from 'uuid';

export interface SimpleGenerateParams {
  model: string;
  contents: Content[];
  systemInstruction?: string;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
}

/**
 * Generate content using the core library's ContentGenerator directly.
 * Returns an async iterable of GenerateContentResponse chunks.
 */
export async function* generateSimple(
  contentGenerator: ContentGenerator,
  params: SimpleGenerateParams,
): AsyncGenerator<GenerateContentResponse> {
  const config: GenerateContentConfig = {};

  if (params.systemInstruction) {
    config.systemInstruction = params.systemInstruction;
  }
  if (params.responseMimeType) {
    config.responseMimeType = params.responseMimeType;
  }
  if (params.responseSchema) {
    config.responseSchema = params.responseSchema;
  }
  if (params.temperature !== undefined) {
    config.temperature = params.temperature;
  }
  if (params.maxOutputTokens !== undefined) {
    config.maxOutputTokens = params.maxOutputTokens;
  }
  if (params.topP !== undefined) {
    config.topP = params.topP;
  }
  if (params.topK !== undefined) {
    config.topK = params.topK;
  }

  const promptId = uuidv4();

  const stream = await contentGenerator.generateContentStream(
    {
      model: params.model,
      contents: params.contents,
      config,
    },
    promptId,
    // LlmRole.MAIN = 'main' — the enum isn't type-exported at top-level
    'main' as any,
  );

  yield* stream;
}

/**
 * Generate content (non-streaming) using ContentGenerator.
 */
export async function generateSimpleSync(
  contentGenerator: ContentGenerator,
  params: SimpleGenerateParams,
): Promise<GenerateContentResponse> {
  const config: GenerateContentConfig = {};

  if (params.systemInstruction) {
    config.systemInstruction = params.systemInstruction;
  }
  if (params.responseMimeType) {
    config.responseMimeType = params.responseMimeType;
  }
  if (params.responseSchema) {
    config.responseSchema = params.responseSchema;
  }
  if (params.temperature !== undefined) {
    config.temperature = params.temperature;
  }
  if (params.maxOutputTokens !== undefined) {
    config.maxOutputTokens = params.maxOutputTokens;
  }
  if (params.topP !== undefined) {
    config.topP = params.topP;
  }
  if (params.topK !== undefined) {
    config.topK = params.topK;
  }

  const promptId = uuidv4();

  return contentGenerator.generateContent(
    {
      model: params.model,
      contents: params.contents,
      config,
    },
    promptId,
    'main' as any,
  );
}
