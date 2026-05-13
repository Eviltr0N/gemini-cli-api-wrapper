#!/usr/bin/env node
/**
 * Gemini CLI API Wrapper - Entry Point
 *
 * Bootstraps the Hono server with all routes and initializes the
 * core library's ContentGenerator for serving requests.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';

import {
  Config,
  type ConfigParameters,
  type AgentLoopContext,
  getAuthTypeFromEnv,
  AuthType,
  PREVIEW_GEMINI_MODEL_AUTO,
  PolicyDecision,
  createSessionId,
} from '@google/gemini-cli-core';

import { loadConfig } from './config.js';
import { checkAuth } from './auth.js';
import { createOpenAIRouter } from './routes/openai.js';
import { createGeminiRouter } from './routes/gemini.js';
import { docsRouter } from './routes/docs.js';
import { logger } from './middleware/logger.js';
import { errorHandler, onErrorHandler } from './middleware/error-handler.js';

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║     Gemini CLI API Wrapper — REST API v0.1     ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log('');

  // 1. Load server config
  const serverConfig = loadConfig();

  // 2. Pre-flight auth check
  const authResult = checkAuth();
  if (!authResult.ok) {
    console.error(authResult.message);
    process.exit(1);
  }
  console.log(`✓ Auth: ${authResult.message}`);

  // 3. Initialize the core library Config (minimal setup like the SDK does)
  console.log('⏳ Initializing Gemini core...');

  const cwd = process.cwd();
  const sessionId = createSessionId();

  const configParams: ConfigParameters = {
    sessionId,
    targetDir: cwd,
    cwd,
    debugMode: false,
    model: serverConfig.defaultModel,
    userMemory: '',
    // Minimal config — disable features we don't need for the wrapper
    enableHooks: false,
    mcpEnabled: false,
    extensionsEnabled: false,
    skillsSupport: false,
    interactive: false,
    telemetry: { enabled: false },
    policyEngineConfig: {
      defaultDecision: PolicyDecision.ALLOW,
    },
  };

  const config = new Config(configParams);

  // Detect auth type and initialize
  const authType = getAuthTypeFromEnv() || AuthType.LOGIN_WITH_GOOGLE;
  await config.refreshAuth(authType);
  await config.initialize();

  // Get the ContentGenerator from the initialized config
  const loopContext: AgentLoopContext = config as unknown as AgentLoopContext;
  const contentGenerator = config.getContentGenerator();

  if (!contentGenerator) {
    console.error('❌ Failed to initialize ContentGenerator. Check your credentials.');
    process.exit(1);
  }

  console.log('✓ Gemini core initialized');
  console.log(`✓ Default model: ${serverConfig.defaultModel}`);

  // Log available models
  try {
    const definitions = config.getModelConfigService().getModelDefinitions();
    const modelIds = Object.keys(definitions).filter(id => id.startsWith('gemini-'));
    console.log(`✓ Available models: ${modelIds.length} (${modelIds.join(', ')})`);
  } catch {
    console.log('⚠ Could not enumerate models from core');
  }

  // 4. Build Hono app
  const app = new Hono();

  // Middleware
  app.use('*', cors());
  app.use('*', errorHandler);
  app.use('*', logger);

  // Global error handler fallback (catches errors that escape middleware)
  app.onError(onErrorHandler);

  // Health check
  app.get('/', (c) => {
    return c.json({
      name: 'gemini-cli-api-wrapper',
      version: '0.1.0',
      status: 'ok',
      endpoints: {
        openai: {
          chat: 'POST /v1/chat/completions',
          models: 'GET /v1/models',
        },
        gemini: {
          generate: 'POST /gemini/generateContent',
          stream: 'POST /gemini/streamGenerateContent',
        },
        docs: {
          swagger: 'GET /docs',
          openapi: 'GET /openapi.json',
        },
      },
    });
  });

  // Routes
  const openaiRouter = createOpenAIRouter(contentGenerator, serverConfig, config);
  app.route('/', openaiRouter);

  const geminiRouter = createGeminiRouter(contentGenerator, serverConfig);
  app.route('/', geminiRouter);

  app.route('/', docsRouter);

  // 5. Start server
  console.log('');
  console.log(`🚀 Server starting on http://localhost:${serverConfig.port}`);
  console.log('');
  console.log('   Endpoints:');
  console.log(`   ├─ POST http://localhost:${serverConfig.port}/v1/chat/completions`);
  console.log(`   ├─ GET  http://localhost:${serverConfig.port}/v1/models`);
  console.log(`   ├─ POST http://localhost:${serverConfig.port}/v1beta/models/{model}:generateContent`);
  console.log(`   ├─ POST http://localhost:${serverConfig.port}/v1beta/models/{model}:streamGenerateContent`);
  console.log(`   ├─ POST http://localhost:${serverConfig.port}/gemini/generateContent`);
  console.log(`   ├─ GET  http://localhost:${serverConfig.port}/docs`);
  console.log(`   └─ GET  http://localhost:${serverConfig.port}/openapi.json`);
  console.log('');

  serve({
    fetch: app.fetch,
    port: serverConfig.port,
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
