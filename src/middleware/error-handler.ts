/**
 * Global error handler middleware + Hono onError handler.
 * Maps known error types to appropriate HTTP status codes.
 * Includes Retry-After header for rate limit errors.
 */

import type { Context, Next } from 'hono';

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (error: unknown) {
    return formatErrorResponse(c, error);
  }
}

/**
 * Hono onError handler (catches errors that escape middleware).
 */
export function onErrorHandler(error: Error, c: Context) {
  return formatErrorResponse(c, error);
}

/**
 * Format an error into an OpenAI-compatible JSON error response.
 * Exported so route handlers can use it directly for try-catch blocks.
 */
export function formatErrorResponse(c: Context, error: unknown) {
  const err = error instanceof Error ? error : new Error(String(error));
  const parsed = parseGoogleApiError(err);

  console.error(`[${parsed.status}] ${parsed.type}: ${parsed.message}`);

  // Add Retry-After header for rate limit errors
  if (parsed.status === 429 && parsed.retryAfterSeconds) {
    c.header('Retry-After', String(parsed.retryAfterSeconds));
  }

  return c.json(
    {
      error: {
        message: parsed.message,
        type: parsed.type,
        code: parsed.code,
      },
    },
    parsed.status as any,
  );
}

interface ParsedError {
  message: string;
  type: string;
  code: string | null;
  status: number;
  retryAfterSeconds?: number;
}

/**
 * Parse error messages from Google API / GeminiClient into structured error info.
 *
 * Google API errors come in various formats:
 * - "500 None. {'error': {'message': 'You have exhausted your capacity...reset after 1s.'}}"
 * - GaxiosError with nested response.data containing JSON error
 * - Standard Error with descriptive message
 */
function parseGoogleApiError(error: Error): ParsedError {
  const rawMsg = error.message || '';

  // Try to extract the real API message from the error
  let apiMessage = rawMsg;
  let apiCode: string | null = null;

  // 1. Check GaxiosError format (nested response.data) — most common
  if ((error as any).response?.data) {
    try {
      const rawData = (error as any).response.data;
      const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      // Could be a JSON array from streaming errors: [{error:{...}}]
      const errorObj = Array.isArray(data) ? data[0] : data;
      if (errorObj?.error?.message) {
        apiMessage = errorObj.error.message;
      }
      if (errorObj?.error?.code) {
        apiCode = String(errorObj.error.code);
      }
      if (errorObj?.error?.status) {
        apiCode = apiCode || errorObj.error.status;
      }
    } catch {
      // parse failed, fall through
    }
  }

  // 2. Try to extract JSON error embedded in the message string
  if (apiMessage === rawMsg) {
    const jsonMatch = rawMsg.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0].replace(/'/g, '"'));
        if (parsed.error?.message) {
          apiMessage = parsed.error.message;
        }
        if (parsed.error?.code) {
          apiCode = apiCode || String(parsed.error.code);
        }
      } catch {
        // JSON parse failed
      }
    }
  }

  // 3. Check HTTP status from GaxiosError
  const httpStatus = (error as any).response?.status || (error as any).status;
  if (httpStatus && !apiCode) {
    apiCode = String(httpStatus);
  }

  // Extract retry-after seconds from quota messages
  // "Your quota will reset after 1s" or "reset after 30s"
  let retryAfterSeconds: number | undefined;
  const retryMatch = apiMessage.match(/reset after (\d+)s/i);
  if (retryMatch) {
    retryAfterSeconds = parseInt(retryMatch[1], 10);
  }
  // Also check Retry-After header
  const retryAfterHeader = (error as any).response?.headers?.['retry-after'];
  if (retryAfterHeader && !retryAfterSeconds) {
    retryAfterSeconds = parseInt(retryAfterHeader, 10) || undefined;
  }

  // Map to HTTP status and error type
  const apiMsgLower = apiMessage.toLowerCase();

  // ── Rate limit / quota ──────────────────────────────────────────
  if (
    apiMsgLower.includes('exhausted your capacity') ||
    apiMsgLower.includes('quota') ||
    apiMsgLower.includes('rate limit') ||
    apiMsgLower.includes('resource_exhausted') ||
    apiCode === '429' ||
    apiCode === 'RESOURCE_EXHAUSTED'
  ) {
    return {
      message: apiMessage,
      type: 'rate_limit_error',
      code: 'rate_limit_exceeded',
      status: 429,
      retryAfterSeconds: retryAfterSeconds || 1,
    };
  }

  // ── Authentication ──────────────────────────────────────────────
  if (
    apiMsgLower.includes('auth') ||
    apiMsgLower.includes('credential') ||
    apiMsgLower.includes('unauthorized') ||
    apiMsgLower.includes('unauthenticated') ||
    apiCode === '401' ||
    apiCode === 'UNAUTHENTICATED'
  ) {
    return {
      message: apiMessage,
      type: 'authentication_error',
      code: 'invalid_api_key',
      status: 401,
    };
  }

  // ── Permission denied ──────────────────────────────────────────
  if (
    apiMsgLower.includes('permission') ||
    apiMsgLower.includes('forbidden') ||
    apiCode === '403' ||
    apiCode === 'PERMISSION_DENIED'
  ) {
    return {
      message: apiMessage,
      type: 'permission_error',
      code: 'permission_denied',
      status: 403,
    };
  }

  // ── Not found ──────────────────────────────────────────────────
  if (
    apiMsgLower.includes('not found') ||
    apiMsgLower.includes('model not') ||
    apiCode === '404' ||
    apiCode === 'NOT_FOUND'
  ) {
    return {
      message: apiMessage,
      type: 'not_found_error',
      code: 'model_not_found',
      status: 404,
    };
  }

  // ── Bad request / invalid ──────────────────────────────────────
  if (
    apiMsgLower.includes('invalid') ||
    apiMsgLower.includes('missing') ||
    apiMsgLower.includes('required') ||
    apiMsgLower.includes('bad request') ||
    apiMsgLower.includes('cannot fetch content') ||
    apiCode === '400' ||
    apiCode === 'INVALID_ARGUMENT'
  ) {
    return {
      message: apiMessage,
      type: 'invalid_request_error',
      code: 'bad_request',
      status: 400,
    };
  }

  // ── Content safety / blocked ───────────────────────────────────
  if (
    apiMsgLower.includes('safety') ||
    apiMsgLower.includes('blocked') ||
    apiMsgLower.includes('harmful') ||
    apiMsgLower.includes('policy') ||
    apiCode === 'SAFETY' ||
    apiCode === 'BLOCKED'
  ) {
    return {
      message: apiMessage,
      type: 'content_filter_error',
      code: 'content_policy_violation',
      status: 400,
    };
  }

  // ── Timeout ────────────────────────────────────────────────────
  if (
    apiMsgLower.includes('timeout') ||
    apiMsgLower.includes('deadline') ||
    apiCode === 'DEADLINE_EXCEEDED'
  ) {
    return {
      message: apiMessage,
      type: 'timeout_error',
      code: 'request_timeout',
      status: 504,
    };
  }

  // ── Service unavailable ────────────────────────────────────────
  if (
    apiMsgLower.includes('unavailable') ||
    apiMsgLower.includes('overloaded') ||
    apiCode === '503' ||
    apiCode === 'UNAVAILABLE'
  ) {
    return {
      message: apiMessage,
      type: 'server_error',
      code: 'service_unavailable',
      status: 503,
    };
  }

  // ── Default: internal server error ─────────────────────────────
  return {
    message: apiMessage,
    type: 'server_error',
    code: apiCode || 'internal_error',
    status: 500,
  };
}
