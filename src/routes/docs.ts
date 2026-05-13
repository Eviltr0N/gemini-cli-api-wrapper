/**
 * Swagger/OpenAPI documentation routes.
 */

import { Hono } from 'hono';
import { swaggerUI } from '@hono/swagger-ui';

export const docsRouter = new Hono();

/**
 * OpenAPI 3.1 specification.
 */
const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Gemini CLI API Wrapper',
    description:
      'Local REST API server wrapping @google/gemini-cli-core. Provides OpenAI-compatible and Gemini-native endpoints.',
    version: '0.1.0',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local dev server' }],
  paths: {
    '/v1/chat/completions': {
      post: {
        tags: ['OpenAI Compatible'],
        summary: 'Create chat completion',
        description:
          'Generates a chat completion using Gemini, compatible with the OpenAI API format.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ChatCompletionRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChatCompletion' },
              },
              'text/event-stream': {
                schema: { type: 'string', description: 'SSE stream of ChatCompletionChunk' },
              },
            },
          },
          '400': { description: 'Bad request' },
          '401': { description: 'Authentication error' },
          '429': { description: 'Rate limited' },
          '500': { description: 'Internal server error' },
        },
      },
    },
    '/v1/models': {
      get: {
        tags: ['OpenAI Compatible'],
        summary: 'List available models',
        responses: {
          '200': {
            description: 'List of available models',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ModelList' },
              },
            },
          },
        },
      },
    },
    '/gemini/generateContent': {
      post: {
        tags: ['Gemini Native'],
        summary: 'Generate content (Gemini format)',
        description: 'Generates content using Gemini-native request format.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GeminiGenerateRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Generated content',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      ChatCompletionRequest: {
        type: 'object',
        required: ['messages'],
        properties: {
          model: {
            type: 'string',
            description: 'Model to use',
            default: 'gemini-2.5-flash',
          },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              required: ['role', 'content'],
              properties: {
                role: {
                  type: 'string',
                  enum: ['system', 'user', 'assistant'],
                },
                content: { type: 'string' },
              },
            },
          },
          stream: { type: 'boolean', default: false },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          max_tokens: { type: 'integer' },
          top_p: { type: 'number' },
          top_k: { type: 'integer' },
          tools: {
            type: 'array',
            description: 'Tools to enable (web_search, web_fetch, shell)',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['function'] },
                function: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                  },
                },
              },
            },
          },
          response_format: {
            type: 'object',
            description: 'Response format (json_object or json_schema)',
            properties: {
              type: { type: 'string', enum: ['text', 'json_object', 'json_schema'] },
              json_schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      ChatCompletion: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          object: { type: 'string', enum: ['chat.completion'] },
          created: { type: 'integer' },
          model: { type: 'string' },
          choices: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'integer' },
                message: {
                  type: 'object',
                  properties: {
                    role: { type: 'string' },
                    content: { type: 'string' },
                  },
                },
                finish_reason: { type: 'string' },
              },
            },
          },
        },
      },
      ModelList: {
        type: 'object',
        properties: {
          object: { type: 'string', enum: ['list'] },
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                object: { type: 'string', enum: ['model'] },
                created: { type: 'integer' },
                owned_by: { type: 'string' },
              },
            },
          },
        },
      },
      GeminiGenerateRequest: {
        type: 'object',
        required: ['contents'],
        properties: {
          model: { type: 'string' },
          contents: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string' },
                parts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { text: { type: 'string' } },
                  },
                },
              },
            },
          },
          generationConfig: {
            type: 'object',
            properties: {
              temperature: { type: 'number' },
              maxOutputTokens: { type: 'integer' },
              responseMimeType: { type: 'string' },
              responseSchema: { type: 'object' },
            },
          },
        },
      },
    },
  },
};

// Serve OpenAPI JSON spec
docsRouter.get('/openapi.json', (c) => {
  return c.json(openApiSpec);
});

// Serve Swagger UI
docsRouter.get(
  '/docs',
  swaggerUI({
    url: '/openapi.json',
  }),
);
