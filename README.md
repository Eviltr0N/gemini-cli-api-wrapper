# Gemini CLI API Wrapper

[![npm version](https://img.shields.io/npm/v/gemini-cli-api-wrapper.svg)](https://www.npmjs.com/package/gemini-cli-api-wrapper)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js Version](https://img.shields.io/node/v/gemini-cli-api-wrapper.svg)](https://nodejs.org)

A high-performance local REST API server that wraps [`@google/gemini-cli-core`](https://www.npmjs.com/package/@google/gemini-cli-core) to expose Google's Gemini models via standard API interfaces. Uses your existing **Google OAuth credentials** from the Gemini CLI — no API key needed.

> **Think of it as:** Your own local Gemini API server that works with any OpenAI-compatible client (Cursor, Continue, LangChain, etc.) and the official `google.genai` Python SDK.

## Motivation

I was working on a LangGraph-based agentic pipeline for one of my generative media projects, and for that I needed access to an LLM API. I tried multiple "free" providers and, as you would expect, the rate limits were terrible. We do have free Gemini API access through AI Studio, but the free-tier limits are barely usable. Since I already had a Google AI Pro subscription and Gemini CLI gives around "1000" requests per day(as of May 2026), I thought, why not use it?

That's why I created this. It works on free Gemini CLI accounts too, but the rate limits are lower and you only get access to older models. If you have a subscription, the experience is much better.

## Features

- **OpenAI-compatible API** — Drop-in replacement for OpenAI clients via `/v1/chat/completions`
- **google.genai SDK compatible** — Works with the official Google GenAI Python SDK via `/v1beta/models/{model}:generateContent`
- **LangChain/LangGraph ready** — Use `ChatGoogleGenerativeAI(base_url="http://localhost:3000")`
- **Structured JSON output** — Native `responseSchema` support, not prompt injection
- **Google Search grounding** — Real-time web search via native `googleSearch` tool
- **Code execution** — Server-side Python execution (numpy, pandas, etc.) via native `codeExecution` tool
- **System prompts** — Clean `systemInstruction` injection without CLI bloat
- **All Gemini models** — Dynamic model listing including Gemini 3.1, 3, 2.5 Pro/Flash
- **Streaming** — Full SSE streaming support for both OpenAI and Gemini protocols
- **Swagger UI** — Interactive API documentation at `/docs`

## Quick Start

### Prerequisites

- **Node.js** ≥ 20

#### Auth Setup (one-time)

This wrapper uses OAuth credentials from the [Gemini CLI](https://github.com/google-gemini/gemini-cli). You need to set up auth **once** before using this wrapper:

```bash
# 1. Install the Gemini CLI globally
npm install -g @google/gemini-cli

# 2. Run it once — this opens a browser for Google OAuth login
gemini

# 3. Complete the sign-in flow in your browser
#    Once done, credentials are saved locally and the wrapper can use them
```

> **Note:** You only need to do this once. After signing in, the OAuth tokens are stored locally and the wrapper picks them up automatically. You don't need to keep Gemini CLI running.

### One-Line Start (npx)

```bash
npx gemini-cli-api-wrapper
```

That's it! Server starts at `http://localhost:3000`. No cloning, no setup.

#### With options:

```bash
npx gemini-cli-api-wrapper --port 8080
npx gemini-cli-api-wrapper --port 8080 --model gemini-2.5-pro
npx gemini-cli-api-wrapper --help
```

### Install from NPM

```bash
npm install -g gemini-cli-api-wrapper
gemini-cli-api-wrapper
```

### Install from Source

```bash
git clone https://github.com/Eviltr0N/gemini-cli-api-wrapper.git
cd gemini-cli-api-wrapper
npm install
npm run dev
```

### Startup Output

```
╔════════════════════════════════════════════════╗
║     Gemini CLI API Wrapper — REST API v0.1     ║
╚════════════════════════════════════════════════╝

✓ Auth: Found OAuth credentials
✓ Default model: gemini-2.5-flash
✓ Available models: 8 (gemini-3.1-pro-preview, gemini-3-flash-preview, ...)

🚀 Server starting on http://localhost:3000
```

## Usage

### OpenAI Python Client

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="not-needed",
)

response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
```

### google.genai Python SDK

```python
from google import genai
from google.genai import types

client = genai.Client(
    api_key="not-needed",
    http_options=types.HttpOptions(
        base_url="http://localhost:3000",
        api_version="v1beta",
    ),
)

response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="What is the capital of France?",
)
print(response.text)
```

### LangChain

```python
from langchain_google_genai import ChatGoogleGenerativeAI

model = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    google_api_key="not-needed",
    base_url="http://localhost:3000",
)

response = model.invoke("Explain quantum computing in one sentence.")
print(response.content)
```

### cURL

```bash
# Simple chat
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"Hello!"}]}'

# With system prompt
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"system","content":"Be brief"},{"role":"user","content":"What is AI?"}]}'
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | OpenAI-compatible chat completions (streaming & non-streaming) |
| `GET /v1/models` | List available models (dynamic from core) |
| `POST /v1beta/models/{model}:generateContent` | google.genai SDK compatible generation |
| `POST /v1beta/models/{model}:streamGenerateContent` | google.genai SDK compatible streaming |
| `POST /gemini/generateContent` | Simplified Gemini-native endpoint |
| `GET /docs` | Swagger UI |
| `GET /openapi.json` | OpenAPI 3.1 specification |
| `GET /` | Health check |

## Tool Use

### Web Search (Google Search Grounding)

Real-time web search — the API executes Google Search internally and grounds the response with current information.

```python
# OpenAI client
response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "What are today's top AI news?"}],
    tools=[{"type": "function", "function": {"name": "web_search"}}],
)

# google.genai SDK
response = genai_client.models.generate_content(
    model="gemini-2.5-flash",
    contents="Latest tech news?",
    config=types.GenerateContentConfig(
        tools=[types.Tool(google_search=types.GoogleSearch())],
    ),
)
```

### Code Execution

Server-side Python execution in Google's sandbox (supports numpy, pandas, etc.).

```python
# OpenAI client
response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Compute eigenvalues of [[4,-2],[1,1]] using numpy"}],
    tools=[{"type": "function", "function": {"name": "code_execution"}}],
)

# google.genai SDK
response = genai_client.models.generate_content(
    model="gemini-2.5-flash",
    contents="Calculate the first 100 prime numbers using Python",
    config=types.GenerateContentConfig(
        tools=[types.Tool(code_execution=types.ToolCodeExecution())],
    ),
)
```

## Structured Output

### JSON Schema (strict)

```python
response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Give me a recipe for pasta"}],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "recipe",
            "schema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "ingredients": {"type": "array", "items": {"type": "string"}},
                    "steps": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name", "ingredients", "steps"],
            },
        },
    },
)
```

### JSON Object (free-form)

```python
response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Capital and population of France as JSON"}],
    response_format={"type": "json_object"},
)
```

## Configuration

| Option | CLI Flag | Environment Variable | Default |
|--------|----------|---------------------|---------|
| Port | `--port <number>` | `PORT` | `3000` |
| Model | `--model <name>` | `DEFAULT_MODEL` | `gemini-2.5-flash` |
| Help | `--help` | — | — |

```bash
# CLI flags
npx gemini-cli-api-wrapper --port 8080 --model gemini-2.5-pro

# Environment variables
PORT=8080 DEFAULT_MODEL=gemini-2.5-pro npx gemini-cli-api-wrapper
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Clients                              │
│  OpenAI SDK │ google.genai │ LangChain │ cURL │ Swagger  │
└──────┬──────┴──────┬───────┴─────┬─────┴───┬──┴────┬─────┘
       │             │             │         │       │
┌──────▼──────┬──────▼───────┬─────▼────┬────▼──┬────▼─────┐
│  /v1/chat/  │ /v1beta/     │ /gemini/ │  /    │  /docs   │
│ completions │ models/{m}:  │ generate │health │ swagger  │
│             │ generate     │ Content  │       │          │
└──────┬──────┴──────┬───────┴─────┬────┴───────┴──────────┘
       │             │             │
┌──────▼─────────────▼─────────────▼──────────────────────┐
│                    Engine Layer                           │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ Path A: Simple  │  │ Path B: Tools                │  │
│  │ ContentGenerator│  │ googleSearch, codeExecution   │  │
│  │ + systemInstr   │  │ via GenerateContentConfig     │  │
│  │ + responseSchema│  │                              │  │
│  └────────┬────────┘  └──────────────┬───────────────┘  │
└───────────┼──────────────────────────┼──────────────────┘
            │                          │
┌───────────▼──────────────────────────▼──────────────────┐
│              @google/gemini-cli-core                     │
│         ContentGenerator → Gemini API (OAuth)            │
└─────────────────────────────────────────────────────────┘
```

## Testing

A comprehensive test suite with 23 tests is included:

```bash
# Install Python test deps
pip install openai google-genai requests

# Start server in one terminal
npm run dev

# Run tests in another terminal
python test_api.py
```

Tests cover: health check, model listing, simple chat, streaming, system prompts, JSON schema output, JSON object, web search (grounded), multi-turn, temperature, code execution (numpy eigenvalues, pandas, prime sums), google.genai SDK (simple, system instruction, JSON schema, search, streaming, code execution), error handling, OpenAPI spec, and Swagger UI.

## Project Structure

```
gemini-cli-api-wrapper/
├── src/
│   ├── index.ts                 # Entry point: auth → init → server
│   ├── config.ts                # Server config (port, model, CLI args)
│   ├── auth.ts                  # OAuth pre-flight check
│   ├── engine/
│   │   ├── simple.ts            # Path A: direct ContentGenerator
│   │   └── tools.ts             # Path B: native Gemini tools
│   ├── routes/
│   │   ├── openai.ts            # /v1/chat/completions, /v1/models
│   │   ├── gemini.ts            # /v1beta/models, /gemini/ endpoints
│   │   └── docs.ts              # Swagger UI + OpenAPI spec
│   ├── middleware/
│   │   ├── error-handler.ts     # Error → HTTP status mapping
│   │   └── logger.ts            # Request logging
│   └── utils/
│       ├── message-converter.ts # OpenAI messages → Gemini Content[]
│       ├── stream-adapter.ts    # Gemini stream → OpenAI SSE
│       ├── schema-converter.ts  # OpenAI response_format → Gemini schema
│       └── tool-mapper.ts       # Tool name resolution
├── test_api.py                  # Python test suite (23 tests)
├── package.json
├── tsconfig.json
└── LICENSE
```

## Note
If you can smell the code, you might have noticed that it feels AI written and that's true. It was written by Claude via Antigravity. It's not fully vibe coded though; I did the research, created the draft, and tested it (that's what vibe coding is, isn't it?). And I am with [Linus](https://github.com/torvalds) when he said it’s "just a tool".

## License

Apache 2.0, see [LICENSE](LICENSE) for details
