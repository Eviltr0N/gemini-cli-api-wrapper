/**
 * OpenAI-compatible API routes.
 *
 * - POST /v1/chat/completions
 * - GET  /v1/models
 */

import { Hono } from 'hono';
import { stream as honoStream } from 'hono/streaming';
import type { ContentGenerator, Config } from '@google/gemini-cli-core';
import { convertMessages, type OpenAIMessage } from '../utils/message-converter.js';
import { convertResponseFormat, type OpenAIResponseFormat } from '../utils/schema-converter.js';
import { resolveTools, type OpenAIToolDef } from '../utils/tool-mapper.js';
import { streamToOpenAISSE, streamToCompletion } from '../utils/stream-adapter.js';
import { withRetryStream } from '../utils/retry.js';
import { generateSimple } from '../engine/simple.js';
import { generateWithTools } from '../engine/tools.js';
import type { ServerConfig } from '../config.js';

interface OpenAIAppEnv {
  Variables: {
    contentGenerator: ContentGenerator;
    serverConfig: ServerConfig;
  };
}

export function createOpenAIRouter(
  contentGenerator: ContentGenerator,
  serverConfig: ServerConfig,
  coreConfig?: Config,
) {
  const router = new Hono<OpenAIAppEnv>();

  /**
   * POST /v1/chat/completions
   */
  router.post('/v1/chat/completions', async (c) => {
    const body = await c.req.json();

    // Extract params
    const messages: OpenAIMessage[] = body.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return c.json({ error: { message: 'messages array is required', type: 'invalid_request_error' } }, 400);
    }

    const model: string = body.model || serverConfig.defaultModel;
    const shouldStream: boolean = body.stream ?? false;
    const temperature: number | undefined = body.temperature;
    const maxTokens: number | undefined = body.max_tokens;
    const topP: number | undefined = body.top_p;
    const topK: number | undefined = body.top_k;
    const tools: OpenAIToolDef[] | undefined = body.tools;
    const responseFormat: OpenAIResponseFormat | undefined = body.response_format;

    // Convert messages (async — may fetch remote image URLs)
    const { systemInstruction, contents, lastUserMessage } = await convertMessages(messages);

    if (contents.length === 0) {
      return c.json({ error: { message: 'At least one non-system message is required', type: 'invalid_request_error' } }, 400);
    }

    // Check for tools
    const resolvedTools = resolveTools(tools);

    // Check for structured output
    const formatConfig = convertResponseFormat(responseFormat);

    // Route to appropriate engine (with auto-retry on quota errors)
    if (resolvedTools && resolvedTools.length > 0) {
      // Path B: Tool-enabled generation (with native Gemini tools like googleSearch)
      const stream = withRetryStream(() => generateWithTools(contentGenerator, {
        model,
        contents,
        systemInstruction,
        enabledTools: resolvedTools,
        temperature,
        maxOutputTokens: maxTokens,
        responseMimeType: formatConfig?.responseMimeType,
        responseSchema: formatConfig?.responseSchema,
      }), `${model}/tools`);

      if (shouldStream) {
        return streamSSEResponse(c, stream, model);
      } else {
        const completion = await streamToCompletion(stream, model);
        return c.json(completion);
      }
    } else {
      // Path A: Simple generation (optionally with structured output)
      const stream = withRetryStream(() => generateSimple(contentGenerator, {
        model,
        contents,
        systemInstruction,
        responseMimeType: formatConfig?.responseMimeType,
        responseSchema: formatConfig?.responseSchema,
        temperature,
        maxOutputTokens: maxTokens,
        topP,
        topK,
      }), `${model}/simple`);

      if (shouldStream) {
        return streamSSEResponse(c, stream, model);
      } else {
        const completion = await streamToCompletion(stream, model);
        return c.json(completion);
      }
    }
  });

  /**
   * GET /v1/models
   *
   * Dynamically lists models from the core's ModelConfigService,
   * including Gemini 3.1 models when available.
   */
  router.get('/v1/models', (c) => {
    let modelIds: string[] = [];

    if (coreConfig) {
      try {
        const definitions = coreConfig.getModelConfigService().getModelDefinitions();
        modelIds = Object.entries(definitions)
          .filter(([id, def]) => {
            // Only include actual model IDs (not aliases like 'auto', 'pro', 'flash')
            return id.startsWith('gemini-') && (def as any).isVisible !== false;
          })
          .map(([id]) => id);
      } catch {
        // Fallback if ModelConfigService isn't available
      }
    }

    // Fallback to common models if dynamic listing failed
    if (modelIds.length === 0) {
      modelIds = [
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
      ];
    }

    const now = Math.floor(Date.now() / 1000);
    return c.json({
      object: 'list',
      data: modelIds.map((id) => ({
        id,
        object: 'model',
        created: now,
        owned_by: 'google',
      })),
    });
  });

  return router;
}

/**
 * Stream an SSE response back to the client.
 */
function streamSSEResponse(c: any, genStream: AsyncGenerator<any>, model: string) {
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no');

  return honoStream(c, async (stream) => {
    try {
      const sseStream = streamToOpenAISSE(genStream, model);
      for await (const chunk of sseStream) {
        await stream.write(chunk);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Stream error:', errMsg);
      const errorChunk = `data: ${JSON.stringify({
        error: { message: errMsg, type: 'server_error' },
      })}\n\n`;
      await stream.write(errorChunk);
      await stream.write('data: [DONE]\n\n');
    }
  });
}
