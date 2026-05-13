/**
 * Adapts core library stream responses into OpenAI-compatible SSE format.
 *
 * Handles both:
 * - GenerateContentResponse streams (from ContentGenerator — Path A)
 * - ServerGeminiStreamEvent streams (from GeminiClient — Path B)
 */

import { v4 as uuidv4 } from 'uuid';
import type { GenerateContentResponse } from '@google/genai';

/**
 * OpenAI ChatCompletionChunk format.
 */
export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI ChatCompletion format (non-streaming).
 */
export interface ChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Extract token usage from a GenerateContentResponse's usageMetadata.
 */
function extractUsage(response: GenerateContentResponse): {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
} {
  const meta = response.usageMetadata;
  if (!meta) {
    return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  }
  return {
    prompt_tokens: meta.promptTokenCount ?? 0,
    completion_tokens: meta.candidatesTokenCount ?? 0,
    total_tokens: meta.totalTokenCount ?? 0,
  };
}

/**
 * Convert a stream of GenerateContentResponse chunks into OpenAI SSE strings.
 */
export async function* streamToOpenAISSE(
  stream: AsyncGenerator<GenerateContentResponse> | AsyncIterable<GenerateContentResponse>,
  model: string,
): AsyncGenerator<string> {
  const id = `chatcmpl-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);
  let sentRole = false;
  let lastUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  for await (const chunk of stream) {
    const text = extractTextFromResponse(chunk);

    // Track latest usage from each chunk (last one wins — it has cumulative totals)
    const usage = extractUsage(chunk);
    if (usage.total_tokens > 0) {
      lastUsage = usage;
    }

    if (text === undefined) continue;

    const chunkData: ChatCompletionChunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [
        {
          index: 0,
          delta: {
            ...(sentRole ? {} : { role: 'assistant' }),
            content: text,
          },
          finish_reason: null,
        },
      ],
    };
    sentRole = true;

    yield `data: ${JSON.stringify(chunkData)}\n\n`;
  }

  // Send the final chunk with finish_reason and usage
  const finalChunk: ChatCompletionChunk = {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop',
      },
    ],
    usage: lastUsage,
  };
  yield `data: ${JSON.stringify(finalChunk)}\n\n`;
  yield `data: [DONE]\n\n`;
}

/**
 * Collect a full stream into a single non-streaming ChatCompletion response.
 */
export async function streamToCompletion(
  stream: AsyncGenerator<GenerateContentResponse> | AsyncIterable<GenerateContentResponse>,
  model: string,
): Promise<ChatCompletion> {
  const parts: string[] = [];
  let lastUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  for await (const chunk of stream) {
    const text = extractTextFromResponse(chunk);
    if (text !== undefined) {
      parts.push(text);
    }

    // Track latest usage (last chunk has cumulative totals)
    const usage = extractUsage(chunk);
    if (usage.total_tokens > 0) {
      lastUsage = usage;
    }
  }

  const content = parts.join('');

  return {
    id: `chatcmpl-${uuidv4()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      },
    ],
    usage: lastUsage,
  };
}

/**
 * Extract text content from a GenerateContentResponse.
 * Includes executableCode and codeExecutionResult parts formatted as
 * markdown so tool use results are visible in OpenAI-compatible responses.
 */
function extractTextFromResponse(
  response: GenerateContentResponse,
): string | undefined {
  if (!response.candidates || response.candidates.length === 0) {
    return undefined;
  }

  const candidate = response.candidates[0];
  if (!candidate?.content?.parts) {
    return undefined;
  }

  const output: string[] = [];

  for (const part of candidate.content.parts) {
    // Skip thinking/thought parts
    if (part.thought) continue;

    // Regular text
    if (typeof part.text === 'string') {
      output.push(part.text);
    }

    // Code execution: the code that was written
    if ((part as any).executableCode) {
      const code = (part as any).executableCode;
      const lang = (code.language || 'python').toLowerCase();
      output.push(`\n\`\`\`${lang}\n${code.code}\`\`\`\n`);
    }

    // Code execution: the result/output
    if ((part as any).codeExecutionResult) {
      const result = (part as any).codeExecutionResult;
      if (result.output) {
        output.push(`\n**Output:**\n\`\`\`\n${result.output}\`\`\`\n`);
      }
    }
  }

  if (output.length === 0) return undefined;
  return output.join('');
}
