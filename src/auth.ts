/**
 * OAuth / credential check on startup.
 *
 * The core library handles authentication internally — it checks for cached
 * OAuth tokens or GEMINI_API_KEY. We just do a quick pre-flight check so we
 * can give the user a clear message before the server starts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function getGeminiConfigDir(): string {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'google-gemini');
  }
  return path.join(os.homedir(), '.config', 'google-gemini');
}

export function checkAuth(): { ok: boolean; method: string; message: string } {
  // 1. Check for GEMINI_API_KEY env var
  if (process.env['GEMINI_API_KEY']) {
    return {
      ok: true,
      method: 'api-key',
      message: 'Using GEMINI_API_KEY from environment.',
    };
  }

  // 2. Check for Google OAuth credentials (cached by `gemini` CLI)
  const configDir = getGeminiConfigDir();
  const possibleTokenPaths = [
    path.join(configDir, 'oauth_creds.json'),
    path.join(configDir, 'credentials.json'),
    // Older path used by some versions
    path.join(os.homedir(), '.gemini', 'oauth_creds.json'),
  ];

  for (const tokenPath of possibleTokenPaths) {
    if (fs.existsSync(tokenPath)) {
      return {
        ok: true,
        method: 'oauth',
        message: `Found OAuth credentials at ${tokenPath}`,
      };
    }
  }

  // 3. Check for GOOGLE_GENAI_USE_GCA (Google Cloud Auth)
  if (process.env['GOOGLE_GENAI_USE_GCA'] === 'true') {
    return {
      ok: true,
      method: 'gca',
      message: 'Using Google Cloud Authentication (GCA).',
    };
  }

  // 4. Check for Vertex AI
  if (process.env['GOOGLE_GENAI_USE_VERTEXAI'] === 'true') {
    return {
      ok: true,
      method: 'vertex',
      message: 'Using Vertex AI authentication.',
    };
  }

  return {
    ok: false,
    method: 'none',
    message: [
      '❌ No Gemini credentials found.',
      '',
      'To authenticate, run one of the following:',
      '  1. Run `gemini` in your terminal to complete OAuth login',
      '  2. Set GEMINI_API_KEY environment variable',
      '',
      'Then restart this server.',
    ].join('\n'),
  };
}
