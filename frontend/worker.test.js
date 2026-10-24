import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './worker.js';

test('proxy allows CORS and streams the approved model file', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl;
  let upstreamHeaders;
  globalThis.fetch = async (url, options) => {
    upstreamUrl = url;
    upstreamHeaders = options.headers;
    return new Response('model-config', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const response = await worker.fetch(
      new Request(
        'https://assistant.example/model/hf/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC/resolve/main/mlc-chat-config.json',
        { headers: { Range: 'bytes=0-99', Origin: 'https://assistant.example' } },
      ),
      { ASSETS: { fetch: () => new Response('static asset') } },
    );

    assert.equal(upstreamUrl, 'https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC/resolve/main/mlc-chat-config.json');
    assert.equal(upstreamHeaders.get('range'), 'bytes=0-99');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(await response.text(), 'model-config');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('proxy allows the WebLLM tensor cache manifest', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl;
  globalThis.fetch = async (url) => {
    upstreamUrl = url;
    return new Response('{"records":[]}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const response = await worker.fetch(
      new Request(
        'https://assistant.example/model/hf/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC/resolve/main/tensor-cache.json',
      ),
      { ASSETS: { fetch: () => new Response('static asset') } },
    );

    assert.equal(upstreamUrl, 'https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC/resolve/main/tensor-cache.json');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"records":[]}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('proxy rejects arbitrary upstream paths and methods', async () => {
  const env = { ASSETS: { fetch: () => new Response('static asset') } };
  const badPath = await worker.fetch(
    new Request('https://assistant.example/model/hf/other/model/file.bin'),
    env,
  );
  const badMethod = await worker.fetch(
    new Request(
      'https://assistant.example/model/hf/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC/resolve/main/mlc-chat-config.json',
      { method: 'POST' },
    ),
    env,
  );

  assert.equal(badPath.status, 404);
  assert.equal(badMethod.status, 405);
});

test('proxy routes model preflight and leaves static assets on the asset binding', async () => {
  const env = { ASSETS: { fetch: () => new Response('static asset') } };
  const preflight = await worker.fetch(
    new Request('https://assistant.example/model/hf/model', { method: 'OPTIONS' }),
    env,
  );
  const asset = await worker.fetch(new Request('https://assistant.example/'), env);

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(await asset.text(), 'static asset');
});
