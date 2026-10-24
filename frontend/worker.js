const HUGGING_FACE_MODEL_PREFIX = (
  'mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC/resolve/main/'
);
const GITHUB_MODEL_LIBRARY = (
  'mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_86/base/'
  + 'Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm'
);
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, If-Range, If-None-Match',
  'Access-Control-Expose-Headers': (
    'Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified'
  ),
  'Access-Control-Max-Age': '86400',
};

function getModelUrl(pathname) {
  if (pathname.startsWith('/model/hf/')) {
    const modelPath = pathname.slice('/model/hf/'.length);
    if (!modelPath.startsWith(HUGGING_FACE_MODEL_PREFIX)) return null;

    const filename = modelPath.slice(HUGGING_FACE_MODEL_PREFIX.length);
    const isAllowedFile = (
      /^(mlc-chat-config|ndarray-cache|tensor-cache|tokenizer|tokenizer_config)\.json$/.test(filename)
      || /^params_shard_\d+\.bin$/.test(filename)
    );
    return isAllowedFile ? `https://huggingface.co/${modelPath}` : null;
  }

  if (pathname === `/model/github/${GITHUB_MODEL_LIBRARY}`) {
    return `https://raw.githubusercontent.com/${GITHUB_MODEL_LIBRARY}`;
  }

  return null;
}

async function proxyModelRequest(request, url) {
  const headers = new Headers();
  for (const header of ['range', 'if-range', 'if-none-match', 'if-modified-since']) {
    const value = request.headers.get(header);
    if (value) headers.set(header, value);
  }

  let upstream;
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers,
      redirect: 'follow',
    });
  } catch (error) {
    console.error('No se pudo descargar un archivo del modelo', error);
    return new Response('No se pudo descargar el modelo.', { status: 502 });
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    responseHeaders.set(name, value);
  }

  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    if (!requestUrl.pathname.startsWith('/model/')) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Método no permitido.', {
        status: 405,
        headers: { Allow: 'GET, HEAD, OPTIONS' },
      });
    }

    const modelUrl = getModelUrl(requestUrl.pathname);
    if (!modelUrl) {
      return new Response('Archivo de modelo no permitido.', { status: 404 });
    }
    return proxyModelRequest(request, modelUrl);
  },
};
