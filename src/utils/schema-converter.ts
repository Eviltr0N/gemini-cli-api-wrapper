/**
 * Converts OpenAI response_format.json_schema into Gemini's responseSchema format.
 *
 * Both use JSON Schema / OpenAPI 3.0 style schemas, but there are minor
 * differences in how types are expressed.
 */

/**
 * OpenAI-style response_format from the request body.
 */
export interface OpenAIResponseFormat {
  type: 'text' | 'json_object' | 'json_schema';
  json_schema?: {
    name: string;
    description?: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}

/**
 * Result of converting the response format for Gemini.
 */
export interface GeminiResponseFormatConfig {
  responseMimeType: string;
  responseSchema?: Record<string, unknown>;
}

/**
 * Convert an OpenAI response_format to Gemini's responseMimeType + responseSchema.
 */
export function convertResponseFormat(
  format: OpenAIResponseFormat | undefined,
): GeminiResponseFormatConfig | undefined {
  if (!format) return undefined;

  switch (format.type) {
    case 'json_object':
      return { responseMimeType: 'application/json' };

    case 'json_schema':
      if (!format.json_schema?.schema) {
        return { responseMimeType: 'application/json' };
      }
      return {
        responseMimeType: 'application/json',
        responseSchema: convertJsonSchemaToGemini(format.json_schema.schema),
      };

    case 'text':
    default:
      return undefined;
  }
}

/**
 * Convert a JSON Schema object to Gemini-compatible schema format.
 *
 * Gemini uses a subset of OpenAPI 3.0 Schema Object. The main differences:
 * - Type strings are uppercase in Gemini's Type enum ("STRING" vs "string")
 *   but the API also accepts lowercase, so we pass through as-is.
 * - `additionalProperties` is not supported.
 * - `$ref` is not supported (schemas must be fully resolved).
 */
function convertJsonSchemaToGemini(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (schema['type']) {
    result['type'] = (schema['type'] as string).toUpperCase();
  }

  if (schema['description']) {
    result['description'] = schema['description'];
  }

  if (schema['enum']) {
    result['enum'] = schema['enum'];
  }

  if (schema['required']) {
    result['required'] = schema['required'];
  }

  if (schema['properties']) {
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      converted[key] = convertJsonSchemaToGemini(value);
    }
    result['properties'] = converted;
  }

  if (schema['items']) {
    result['items'] = convertJsonSchemaToGemini(
      schema['items'] as Record<string, unknown>,
    );
  }

  // Pass through nullable
  if (schema['nullable'] !== undefined) {
    result['nullable'] = schema['nullable'];
  }

  return result;
}
