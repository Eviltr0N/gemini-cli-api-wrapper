"""
Gemini CLI API Wrapper — Comprehensive API Test Suite

Uses the OpenAI Python client (pointed at localhost:3000) to test
OpenAI-compatible endpoints, and the google.genai client to test
Gemini-native endpoints at /v1beta/models/{model}:generateContent.

Also uses `requests` for direct endpoint testing.

Install deps:
    pip install openai google-genai requests

Run:
    python test_api.py
"""

import json
import time
import base64
import struct
import zlib
import requests
from openai import OpenAI
from google import genai
from google.genai import types

BASE_URL = "http://localhost:3000"
# MODEL = "gemini-3-flash-preview"
MODEL = "gemini-3.1-flash-lite-preview"

# ── OpenAI client pointed at our local wrapper ──────────────────────
client = OpenAI(
    base_url=f"{BASE_URL}/v1",
    api_key="not-needed",  # Wrapper doesn't require an API key
)

# ── google.genai client pointed at our local wrapper ────────────────
genai_client = genai.Client(
    api_key="not-needed",
    http_options=types.HttpOptions(
        base_url=BASE_URL,
        api_version="v1beta",
    ),
)

passed = 0
failed = 0


def create_test_png(r: int, g: int, b: int) -> bytes:
    """Create a minimal 2x2 PNG image with the given RGB color."""
    header = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', 2, 2, 8, 2, 0, 0, 0)
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff
    ihdr = struct.pack('>I', 13) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)
    raw = (b'\x00' + bytes([r, g, b, r, g, b])) * 2
    compressed = zlib.compress(raw)
    idat_crc = zlib.crc32(b'IDAT' + compressed) & 0xffffffff
    idat = struct.pack('>I', len(compressed)) + b'IDAT' + compressed + struct.pack('>I', idat_crc)
    iend_crc = zlib.crc32(b'IEND') & 0xffffffff
    iend = struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc)
    return header + ihdr + idat + iend


def test(name: str):
    """Decorator to run and report test results."""
    def decorator(fn):
        def wrapper():
            global passed, failed
            print(f"\n{'='*60}")
            print(f"TEST: {name}")
            print(f"{'='*60}")
            try:
                fn()
                passed += 1
                print(f"✅ PASSED: {name}")
            except Exception as e:
                failed += 1
                print(f"❌ FAILED: {name}")
                print(f"   Error: {e}")
        return wrapper
    return decorator


# ═══════════════════════════════════════════════════════════════════
#  OPENAI-COMPATIBLE ENDPOINT TESTS
# ═══════════════════════════════════════════════════════════════════


@test("Health Check — GET /")
def test_health():
    r = requests.get(f"{BASE_URL}/")
    assert r.status_code == 200, f"Status {r.status_code}"
    data = r.json()
    assert data["status"] == "ok"
    print(f"   Server: {data['name']} v{data['version']}")


@test("Model Listing — GET /v1/models (dynamic)")
def test_models():
    models = client.models.list()
    model_ids = [m.id for m in models.data]
    print(f"   Models ({len(model_ids)}): {model_ids}")
    assert len(model_ids) >= 5, f"Expected ≥5 models, got {len(model_ids)}"
    # Should include Gemini 3.1 models
    has_3_1 = any("3.1" in m or "3-" in m for m in model_ids)
    assert has_3_1, f"Missing Gemini 3.x models. Got: {model_ids}"
    print(f"   ✓ Includes Gemini 3.x models")


@test("Simple Chat — Non-Streaming")
def test_simple_chat():
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Say exactly: HELLO WORLD"}],
        stream=False,
    )
    content = response.choices[0].message.content
    print(f"   Response: {content}")
    assert response.id.startswith("chatcmpl-")
    assert response.choices[0].finish_reason == "stop"
    assert content and len(content) > 0


@test("Streaming Chat — SSE via OpenAI client")
def test_streaming():
    stream = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Count from 1 to 5, each on a new line."}],
        stream=True,
    )
    chunks = []
    full_content = ""
    for chunk in stream:
        chunks.append(chunk)
        if chunk.choices and chunk.choices[0].delta.content:
            full_content += chunk.choices[0].delta.content

    print(f"   Chunks received: {len(chunks)}")
    print(f"   Full response: {full_content[:100]}...")
    assert len(chunks) > 1, "Expected multiple SSE chunks"
    assert len(full_content) > 0


@test("System Prompt — Persona Override")
def test_system_prompt():
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": "You are a pirate. Every response must include 'Arrr'."},
            {"role": "user", "content": "What is 2+2?"},
        ],
        stream=False,
    )
    content = response.choices[0].message.content.lower()
    print(f"   Response: {response.choices[0].message.content}")
    assert "arrr" in content or "arr" in content, f"Pirate speak not detected"


@test("Structured Output — JSON Schema (recipe)")
def test_json_schema():
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Give me a recipe for chocolate chip cookies"}],
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
        stream=False,
    )
    content = response.choices[0].message.content
    parsed = json.loads(content)
    print(f"   Recipe: {parsed.get('name')}")
    print(f"   Ingredients: {len(parsed.get('ingredients', []))}")
    assert "name" in parsed and "ingredients" in parsed and "steps" in parsed
    assert len(parsed["ingredients"]) > 0 and len(parsed["steps"]) > 0


@test("Structured Output — json_object (free-form)")
def test_json_object():
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "user", "content": "Return JSON with 'capital' and 'population' for France."}
        ],
        response_format={"type": "json_object"},
        stream=False,
    )
    parsed = json.loads(response.choices[0].message.content)
    print(f"   Parsed: {parsed}")
    assert "capital" in parsed or "Capital" in parsed


@test("Web Search — Real-time grounded search (googleSearch tool)")
def test_web_search():
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Whats todays date? Whats the newest Claude Model that Anthropic launched"}],
        tools=[{"type": "function", "function": {"name": "web_search"}}],
        stream=False,
    )
    content = response.choices[0].message.content
    print(f"   Response (first 300 chars): {content[:300]}...")
    # Should contain current/recent dates (proving real search happened)
    assert "2026" in content or "2025" in content, \
        f"No recent dates found — search may not be working. Response: {content[:200]}"
    print(f"   ✓ Contains recent dates — real web search confirmed")


@test("Multi-turn — Conversation Context")
def test_multi_turn():
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "user", "content": "My name is Mayank."},
            {"role": "assistant", "content": "Nice to meet you, Mayank!"},
            {"role": "user", "content": "What is my name?"},
        ],
        stream=False,
    )
    content = response.choices[0].message.content.lower()
    print(f"   Response: {response.choices[0].message.content}")
    assert "mayank" in content


@test("Temperature — Deterministic (low temp)")
def test_temperature():
    responses = []
    for _ in range(2):
        r = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": "What is 2+2? Reply with just the number."}],
            temperature=0.0,
            stream=False,
        )
        responses.append(r.choices[0].message.content.strip())
    print(f"   Response 1: {responses[0]}")
    print(f"   Response 2: {responses[1]}")
    assert "4" in responses[0] and "4" in responses[1]


# ═══════════════════════════════════════════════════════════════════
#  TOOL USE: CODE EXECUTION TESTS (OpenAI endpoint)
# ═══════════════════════════════════════════════════════════════════


@test("Code Execution — Numpy eigenvalues (verifiable math)")
def test_code_exec_eigenvalues():
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{
            "role": "user",
            "content": (
                "Use code execution: import numpy as np, compute the eigenvalues "
                "of matrix [[4, -2], [1, 1]] using np.linalg.eig(). Print the eigenvalues."
            ),
        }],
        tools=[{"type": "function", "function": {"name": "code_execution"}}],
        stream=False,
    )
    content = response.choices[0].message.content
    print(f"   Response (first 400 chars): {content[:400]}")
    # Eigenvalues of [[4,-2],[1,1]] are 3 and 2 (characteristic eq: λ²-5λ+6=0)
    assert "3" in content and "2" in content, \
        f"Expected eigenvalues 3 and 2 in response"
    # Should contain code block (proves code execution happened)
    assert "```" in content, "Expected code block in response"
    print(f"   ✓ Correct eigenvalues [3, 2] found")
    print(f"   ✓ Code block present — code execution confirmed")


@test("Code Execution — Pandas data manipulation")
def test_code_exec_pandas():
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{
            "role": "user",
            "content": (
                "Use code execution to: import pandas as pd, create a DataFrame with "
                "columns 'name' and 'score' containing: Alice=95, Bob=87, Charlie=92. "
                "Calculate and print the mean score and who has the highest score."
            ),
        }],
        tools=[{"type": "function", "function": {"name": "code_execution"}}],
        stream=False,
    )
    content = response.choices[0].message.content
    print(f"   Response (first 400 chars): {content[:400]}")
    # Mean of [95, 87, 92] = 91.33...
    assert "91" in content, f"Expected mean ~91.33 in response"
    assert "alice" in content.lower(), "Expected Alice as highest scorer"
    print(f"   ✓ Correct mean (~91.33) found")
    print(f"   ✓ Alice identified as highest scorer")


@test("Code Execution — Symbolic math with complex verification")
def test_code_exec_symbolic():
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{
            "role": "user",
            "content": (
                "Use code execution to compute: the sum of the first 100 prime numbers. "
                "Write Python code that finds all primes up to a sufficient limit, "
                "takes the first 100, and prints their sum."
            ),
        }],
        tools=[{"type": "function", "function": {"name": "code_execution"}}],
        stream=False,
    )
    content = response.choices[0].message.content
    print(f"   Response (first 400 chars): {content[:400]}")
    # Sum of first 100 primes = 24133
    assert "24133" in content, \
        f"Expected 24133 (sum of first 100 primes) in response"
    assert "```" in content, "Expected code block in response"
    print(f"   ✓ Correct answer: 24133")


# ═══════════════════════════════════════════════════════════════════
#  MULTIMODAL IMAGE TESTS
# ═══════════════════════════════════════════════════════════════════


@test("Image Input — Base64 PNG via OpenAI client (red)")
def test_image_base64_openai():
    png_bytes = create_test_png(255, 0, 0)  # red
    b64 = base64.b64encode(png_bytes).decode()

    response = client.chat.completions.create(
        model=MODEL,
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": "What color is this image? Reply with just the color name."},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
            ],
        }],
        stream=False,
    )
    content = response.choices[0].message.content.lower()
    print(f"   Response: {response.choices[0].message.content}")
    assert "red" in content, f"Expected 'red' in: {content}"
    print(f"   ✓ Correctly identified red image")


@test("Image Input — Base64 PNG via google.genai SDK (blue)")
def test_image_base64_genai():
    png_bytes = create_test_png(0, 0, 255)  # blue
    b64 = base64.b64encode(png_bytes).decode()

    response = genai_client.models.generate_content(
        model=MODEL,
        contents=[
            types.Part(text="What color is this image? Reply with just the color name."),
            types.Part(inline_data=types.Blob(mime_type="image/png", data=b64)),
        ],
    )
    text = response.text.lower()
    print(f"   Response: {response.text}")
    assert "blue" in text, f"Expected 'blue' in: {text}"
    print(f"   ✓ Correctly identified blue image via genai SDK")


@test("Image + Text — Color analysis with structured reasoning (green)")
def test_image_with_text_analysis():
    png_bytes = create_test_png(0, 255, 0)  # green
    b64 = base64.b64encode(png_bytes).decode()

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": "You are a color expert. Always respond in JSON format."},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Analyze this image. Return JSON with keys: color_name, hex_code, rgb_values"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                ],
            },
        ],
        response_format={"type": "json_object"},
        stream=False,
    )
    content = response.choices[0].message.content
    print(f"   Response: {content[:300]}")
    parsed = json.loads(content)
    color = str(parsed.get("color_name", "")).lower()
    assert "green" in color, f"Expected 'green' in color_name: {color}"
    print(f"   ✓ Correctly identified green + returned structured JSON")


# ═══════════════════════════════════════════════════════════════════
#  GOOGLE GENAI SDK TESTS (via /v1beta/models/{model}:generateContent)
# ═══════════════════════════════════════════════════════════════════


@test("google.genai SDK — Simple generation")
def test_genai_simple():
    response = genai_client.models.generate_content(
        model=MODEL,
        contents="What is the capital of Japan? Reply in one word.",
    )
    text = response.text
    print(f"   Response: {text}")
    assert "tokyo" in text.lower(), f"Expected 'Tokyo' in: {text}"


@test("google.genai SDK — System instruction")
def test_genai_system_instruction():
    response = genai_client.models.generate_content(
        model=MODEL,
        contents="What is 2+2?",
        config=types.GenerateContentConfig(
            system_instruction="You are a pirate. Always say 'Arrr' in your response.",
        ),
    )
    text = response.text.lower()
    print(f"   Response: {response.text}")
    assert "arr" in text, f"Pirate speak not found in: {text}"


@test("google.genai SDK — Structured JSON output (responseSchema)")
def test_genai_json_schema():
    response = genai_client.models.generate_content(
        model=MODEL,
        contents="Tell me about Python programming language.",
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema={
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "creator": {"type": "STRING"},
                    "year": {"type": "STRING"},
                    "use_cases": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["name", "creator", "year"],
            },
        ),
    )
    text = response.text
    parsed = json.loads(text)
    print(f"   Parsed: {json.dumps(parsed, indent=2)[:200]}...")
    assert "name" in parsed
    assert "creator" in parsed


@test("google.genai SDK — Google Search (grounding)")
def test_genai_google_search():
    response = genai_client.models.generate_content(
        model=MODEL,
        contents="What are today's top technology news headlines?",
        config=types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())],
        ),
    )
    text = response.text
    print(f"   Response (first 300 chars): {text[:300]}...")
    assert "2026" in text or "2025" in text, \
        f"No recent dates — search may not be working"
    print(f"   ✓ Grounded search working via google.genai SDK")


@test("google.genai SDK — Streaming")
def test_genai_streaming():
    chunks = []
    full_text = ""
    for chunk in genai_client.models.generate_content_stream(
        model=MODEL,
        contents="Write a haiku about coding.",
    ):
        chunks.append(chunk)
        if chunk.text:
            full_text += chunk.text

    print(f"   Chunks: {len(chunks)}")
    print(f"   Text: {full_text}")
    assert len(chunks) > 0
    assert len(full_text) > 0


@test("google.genai SDK — Code Execution (numpy matrix det)")
def test_genai_code_execution():
    response = genai_client.models.generate_content(
        model=MODEL,
        contents=(
            "Use code execution: compute the determinant of the 3x3 matrix "
            "[[1,2,3],[4,5,6],[7,8,9]] using numpy. Print the result."
        ),
        config=types.GenerateContentConfig(
            tools=[types.Tool(code_execution=types.ToolCodeExecution())],
        ),
    )
    # The response should contain executableCode and codeExecutionResult parts
    has_code = False
    has_result = False
    for part in response.candidates[0].content.parts:
        if hasattr(part, 'executable_code') and part.executable_code:
            has_code = True
            print(f"   Code: {part.executable_code.code[:100]}...")
        if hasattr(part, 'code_execution_result') and part.code_execution_result:
            has_result = True
            print(f"   Result: {part.code_execution_result.output}")
        if hasattr(part, 'text') and part.text:
            print(f"   Text: {part.text[:200]}")

    assert has_code, "Expected executableCode part in response"
    assert has_result, "Expected codeExecutionResult part in response"
    print(f"   ✓ Code execution with numpy verified via genai SDK")


# ═══════════════════════════════════════════════════════════════════
#  ERROR HANDLING & INFRASTRUCTURE TESTS
# ═══════════════════════════════════════════════════════════════════


@test("Error — Missing messages field")
def test_error_missing_messages():
    r = requests.post(f"{BASE_URL}/v1/chat/completions", json={"model": MODEL})
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    print(f"   Error response: {r.json()}")


@test("Error — Empty messages array")
def test_error_empty_messages():
    r = requests.post(f"{BASE_URL}/v1/chat/completions", json={"model": MODEL, "messages": []})
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"


@test("OpenAPI Spec — GET /openapi.json")
def test_openapi_spec():
    r = requests.get(f"{BASE_URL}/openapi.json")
    assert r.status_code == 200
    spec = r.json()
    assert spec["openapi"] == "3.1.0"
    print(f"   Paths: {list(spec['paths'].keys())}")


@test("Swagger UI — GET /docs")
def test_swagger_ui():
    r = requests.get(f"{BASE_URL}/docs")
    assert r.status_code == 200
    assert "swagger" in r.text.lower() or "SwaggerUI" in r.text
    print(f"   HTML: {len(r.text)} chars")


# ═══════════════════════════════════════════════════════════════════
#  RUN ALL TESTS
# ═══════════════════════════════════════════════════════════════════

@test("Gemini native endpoint â€” responseJsonSchema passthrough")
def test_gemini_response_json_schema():
    r = requests.post(
        f"{BASE_URL}/v1beta/models/{MODEL}:generateContent",
        json={
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": "Tell me about Python programming language."}],
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseJsonSchema": {
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "creator": {"type": "string"},
                        "year": {"type": "string"},
                        "use_cases": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["name", "creator", "year"],
                    "additionalProperties": False,
                },
            },
        },
    )
    assert r.status_code == 200, f"Status {r.status_code}: {r.text[:400]}"
    data = r.json()
    parts = data["candidates"][0]["content"]["parts"]
    text = "".join(part.get("text", "") for part in parts if "text" in part)
    parsed = json.loads(text)
    print(f"   Parsed: {json.dumps(parsed, indent=2)[:200]}...")
    assert "name" in parsed
    assert "creator" in parsed


if __name__ == "__main__":
    print("\n" + "🧪 " * 20)
    print("  GEMINI CLI API WRAPPER — FULL API TEST SUITE")
    print("🧪 " * 20)
    print(f"\n  Server: {BASE_URL}")
    print(f"  Model:  {MODEL}\n")

    start = time.time()

    # OpenAI-compatible tests
    test_health()
    test_models()
    test_simple_chat()
    test_streaming()
    test_system_prompt()
    test_json_schema()
    test_json_object()
    test_web_search()
    test_multi_turn()
    test_temperature()

    # Code execution tests (OpenAI endpoint)
    test_code_exec_eigenvalues()
    test_code_exec_pandas()
    test_code_exec_symbolic()

    # Multimodal image tests
    test_image_base64_openai()
    test_image_base64_genai()
    test_image_with_text_analysis()

    # google.genai SDK tests
    test_genai_simple()
    test_genai_system_instruction()
    test_genai_json_schema()
    test_gemini_response_json_schema()
    test_genai_google_search()
    test_genai_streaming()
    test_genai_code_execution()

    # Error handling & infra
    test_error_missing_messages()
    test_error_empty_messages()
    test_openapi_spec()
    test_swagger_ui()

    elapsed = time.time() - start

    print(f"\n{'='*60}")
    print(f"  RESULTS: {passed} passed, {failed} failed ({elapsed:.1f}s)")
    print(f"{'='*60}\n")

    if failed > 0:
        exit(1)
