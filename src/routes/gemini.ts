/**
 * Gemini-native API routes.
 *
 * Matches the URL structure used by the google.genai Python/JS SDK:
 *   POST /v1beta/models/{model}:generateContent
 *   POST /v1beta/models/{model}:streamGenerateContent
 *
 * Also keeps the simpler aliases for direct use:
 *   POST /gemini/generateContent
 *   POST /gemini/streamGenerateContent
 */

import { Hono } from 'hono';
import { stream as honoStream } from 'hono/streaming';
import type { ContentGenerator } from '@google/gemini-cli-core';
import type { Content, GenerateContentConfig, Tool } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import type { ServerConfig } from '../config.js';

type GeminiRequestBody = Record<string, any>;

function extractGenerationConfig(body: GeminiRequestBody): Record<string, any> {
  return body.generationConfig || body.generation_config || body.config || {};
}

function applySystemInstruction(config: GenerateContentConfig, body: GeminiRequestBody) {
  const systemInstruction = body.systemInstruction || body.system_instruction;
  if (!systemInstruction) return;

  if (typeof systemInstruction === 'string') {
    config.systemInstruction = systemInstruction;
    return;
  }

  if (systemInstruction?.parts) {
    const textParts = systemInstruction.parts
      .map((p: any) => p.text)
      .filter(Boolean);
    config.systemInstruction = textParts.join('\n');
  }
}

function looksLikeJsonSchema(schema: unknown): schema is Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return false;
  }

  const keys = Object.keys(schema);
  if (keys.some((key) => key.startsWith('$'))) {
    return true;
  }

  if (
    'additionalProperties' in schema ||
    'oneOf' in schema ||
    'prefixItems' in schema ||
    'propertyNames' in schema
  ) {
    return true;
  }

  const schemaType = (schema as Record<string, unknown>).type;
  return typeof schemaType === 'string' && schemaType === schemaType.toLowerCase();
}

function applyGenerationConfig(config: GenerateContentConfig, genConfig: Record<string, any>) {
  if (genConfig.temperature !== undefined) config.temperature = genConfig.temperature;
  if (genConfig.maxOutputTokens !== undefined) config.maxOutputTokens = genConfig.maxOutputTokens;
  if (genConfig.max_output_tokens !== undefined) config.maxOutputTokens = genConfig.max_output_tokens;
  if (genConfig.topP !== undefined) config.topP = genConfig.topP;
  if (genConfig.top_p !== undefined) config.topP = genConfig.top_p;
  if (genConfig.topK !== undefined) config.topK = genConfig.topK;
  if (genConfig.top_k !== undefined) config.topK = genConfig.top_k;
  if (genConfig.responseMimeType) config.responseMimeType = genConfig.responseMimeType;
  if (genConfig.response_mime_type) config.responseMimeType = genConfig.response_mime_type;
  if (genConfig.candidateCount !== undefined) config.candidateCount = genConfig.candidateCount;
  if (genConfig.candidate_count !== undefined) config.candidateCount = genConfig.candidate_count;
  if (genConfig.stopSequences) config.stopSequences = genConfig.stopSequences;
  if (genConfig.stop_sequences) config.stopSequences = genConfig.stop_sequences;

  // Newer SDKs can send JSON Schema via responseJsonSchema, while older
  // clients still use responseSchema.
  if (genConfig.responseJsonSchema || genConfig.response_json_schema) {
    (config as GenerateContentConfig & { responseJsonSchema?: unknown }).responseJsonSchema =
      genConfig.responseJsonSchema || genConfig.response_json_schema;
    return;
  }

  const legacySchema = genConfig.responseSchema || genConfig.response_schema;
  if (legacySchema) {
    if (looksLikeJsonSchema(legacySchema)) {
      (config as GenerateContentConfig & { responseJsonSchema?: unknown }).responseJsonSchema =
        legacySchema;
      return;
    }

    config.responseSchema = legacySchema;
  }
}

function applyTools(config: GenerateContentConfig, body: GeminiRequestBody) {
  if (body.tools && Array.isArray(body.tools)) {
    config.tools = body.tools as Tool[];
  }

  if (body.toolConfig || body.tool_config) {
    config.toolConfig = body.toolConfig || body.tool_config;
  }
}

export function createGeminiRouter(
  contentGenerator: ContentGenerator,
  serverConfig: ServerConfig,
) {
  const router = new Hono();

  async function handleGenerateContent(c: any, modelFromPath?: string) {
    const body = await c.req.json();

    let model: string = modelFromPath || body.model || serverConfig.defaultModel;
    if (model.startsWith('models/')) {
      model = model.slice(7);
    }

    const contents: Content[] = body.contents;
    if (!contents || !Array.isArray(contents) || contents.length === 0) {
      return c.json({ error: { message: 'contents array is required' } }, 400);
    }

    const genConfig = extractGenerationConfig(body);
    const config: GenerateContentConfig = {};
    applySystemInstruction(config, body);
    applyGenerationConfig(config, genConfig);
    applyTools(config, body);

    const promptId = uuidv4();

    try {
      const response = await contentGenerator.generateContent(
        { model, contents, config },
        promptId,
        'main' as any,
      );

      return c.json({
        candidates: response.candidates,
        usageMetadata: response.usageMetadata,
        modelVersion: response.modelVersion,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Gemini generateContent error:', msg);
      return c.json({ error: { message: msg } }, 500);
    }
  }

  async function handleStreamGenerateContent(c: any, modelFromPath?: string) {
    const body = await c.req.json();

    let model: string = modelFromPath || body.model || serverConfig.defaultModel;
    if (model.startsWith('models/')) {
      model = model.slice(7);
    }

    const contents: Content[] = body.contents;
    if (!contents || !Array.isArray(contents) || contents.length === 0) {
      return c.json({ error: { message: 'contents array is required' } }, 400);
    }

    const genConfig = extractGenerationConfig(body);
    const config: GenerateContentConfig = {};
    applySystemInstruction(config, body);
    applyGenerationConfig(config, genConfig);
    applyTools(config, body);

    const promptId = uuidv4();

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    return honoStream(c, async (stream) => {
      try {
        const genStream = await contentGenerator.generateContentStream(
          { model, contents, config },
          promptId,
          'main' as any,
        );

        for await (const chunk of genStream) {
          await stream.write(
            `data: ${JSON.stringify({
              candidates: chunk.candidates,
              usageMetadata: chunk.usageMetadata,
            })}\n\n`,
          );
        }
        // Gemini native streaming closes the connection instead of sending [DONE].
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await stream.write(`data: ${JSON.stringify({ error: { message: msg } })}\n\n`);
      }
    });
  }

  router.post('/v1beta/models/:modelAction', async (c) => {
    const modelAction = c.req.param('modelAction');

    if (modelAction.endsWith(':generateContent')) {
      const model = modelAction.replace(':generateContent', '');
      return handleGenerateContent(c, model);
    }

    if (modelAction.endsWith(':streamGenerateContent')) {
      const model = modelAction.replace(':streamGenerateContent', '');
      return handleStreamGenerateContent(c, model);
    }

    return c.json({ error: { message: `Unknown action in: ${modelAction}` } }, 404);
  });

  router.post('/v1/models/:modelAction', async (c) => {
    const modelAction = c.req.param('modelAction');

    if (modelAction.endsWith(':generateContent')) {
      const model = modelAction.replace(':generateContent', '');
      return handleGenerateContent(c, model);
    }

    if (modelAction.endsWith(':streamGenerateContent')) {
      const model = modelAction.replace(':streamGenerateContent', '');
      return handleStreamGenerateContent(c, model);
    }

    return c.json({ error: { message: `Unknown action in: ${modelAction}` } }, 404);
  });

  router.post('/gemini/generateContent', async (c) => handleGenerateContent(c));
  router.post('/gemini/streamGenerateContent', async (c) => handleStreamGenerateContent(c));

  return router;
}
