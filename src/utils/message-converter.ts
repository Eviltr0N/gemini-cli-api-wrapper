/**
 * Converts OpenAI-style message arrays to Gemini Content[] arrays.
 *
 * Supports multimodal content:
 *
 * OpenAI text-only:
 *   { role: "user", content: "Hello" }
 *
 * OpenAI multimodal (images):
 *   { role: "user", content: [
 *     { type: "text", text: "What's in this image?" },
 *     { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
 *   ]}
 *
 * Gemini format:
 *   { role: "user", parts: [
 *     { text: "What's in this image?" },
 *     { inlineData: { mimeType: "image/png", data: "base64..." } }
 *   ]}
 */

import type { Content, Part } from '@google/genai';

/**
 * A single content part in OpenAI multimodal format.
 */
export interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;  // "data:image/png;base64,..." or "https://..."
    detail?: 'auto' | 'low' | 'high';
  };
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenAIContentPart[] | null;
  name?: string;
}

export interface ConvertedMessages {
  /** System instruction extracted from system messages */
  systemInstruction: string | undefined;
  /** Conversation history as Gemini Content[] */
  contents: Content[];
  /** The last user message text (useful for tool-based engine) */
  lastUserMessage: string;
}

/**
 * Convert an OpenAI messages array into Gemini-compatible Content[] and
 * extracted system instruction.
 */
export async function convertMessages(messages: OpenAIMessage[]): Promise<ConvertedMessages> {
  const systemParts: string[] = [];
  const contents: Content[] = [];
  let lastUserMessage = '';

  for (const msg of messages) {
    if (msg.role === 'system') {
      // System messages: extract text only
      if (typeof msg.content === 'string' && msg.content) {
        systemParts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        const text = msg.content
          .filter((p) => p.type === 'text' && p.text)
          .map((p) => p.text!)
          .join('\n');
        if (text) systemParts.push(text);
      }
      continue;
    }

    const geminiRole = msg.role === 'assistant' ? 'model' : 'user';
    const parts = await convertContentToParts(msg.content);

    // Track last user text for tool engine
    if (geminiRole === 'user') {
      const textParts = parts.filter((p) => 'text' in p).map((p) => (p as any).text);
      lastUserMessage = textParts.join(' ');
    }

    contents.push({
      role: geminiRole,
      parts,
    });
  }

  // Gemini requires alternating user/model turns and must start with user.
  // Merge consecutive same-role messages if needed.
  const merged = mergeConsecutiveRoles(contents);

  return {
    systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    contents: merged,
    lastUserMessage,
  };
}

/**
 * Convert OpenAI content (string, array of parts, or null) into Gemini Parts.
 * Handles base64 data URIs and fetches remote image URLs to convert to base64.
 */
async function convertContentToParts(content: string | OpenAIContentPart[] | null): Promise<Part[]> {
  // Null or empty
  if (!content) {
    return [{ text: '' }];
  }

  // Simple string
  if (typeof content === 'string') {
    return [{ text: content }];
  }

  // Multimodal array of parts
  const parts: Part[] = [];

  for (const part of content) {
    if (part.type === 'text' && part.text) {
      parts.push({ text: part.text });
    } else if (part.type === 'image_url' && part.image_url?.url) {
      const url = part.image_url.url;

      if (url.startsWith('data:')) {
        // Data URI: "data:image/png;base64,iVBORw0KGgo..."
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          parts.push({
            inlineData: {
              mimeType: match[1],  // e.g. "image/png"
              data: match[2],       // base64 string
            },
          });
        }
      } else if (url.startsWith('http://') || url.startsWith('https://')) {
        // Remote URL — fetch and convert to base64 inlineData
        // (fileData with URLs is rejected by the CLI core's API endpoint)
        try {
          const response = await fetch(url);
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            const contentType = response.headers.get('content-type') || guessImageMimeType(url);
            parts.push({
              inlineData: {
                mimeType: contentType.split(';')[0].trim(),
                data: base64,
              },
            });
          } else {
            console.warn(`Failed to fetch image URL: ${url} (${response.status})`);
          }
        } catch (err) {
          console.warn(`Error fetching image URL: ${url}`, err);
        }
      }
    }
  }

  // Fallback if no parts were created
  if (parts.length === 0) {
    parts.push({ text: '' });
  }

  return parts;
}

/**
 * Guess MIME type from a URL based on extension.
 */
function guessImageMimeType(url: string): string {
  const lower = url.toLowerCase().split('?')[0]; // strip query params
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'image/jpeg'; // default assumption for URLs
}

/**
 * Merge consecutive messages with the same role into a single message.
 * The Gemini API requires strictly alternating user/model turns.
 */
function mergeConsecutiveRoles(contents: Content[]): Content[] {
  if (contents.length === 0) return [];

  const result: Content[] = [contents[0]];

  for (let i = 1; i < contents.length; i++) {
    const current = contents[i];
    const last = result[result.length - 1];

    if (current.role === last.role) {
      // Merge parts into the last message
      last.parts = [...(last.parts || []), ...(current.parts || [])];
    } else {
      result.push(current);
    }
  }

  return result;
}
