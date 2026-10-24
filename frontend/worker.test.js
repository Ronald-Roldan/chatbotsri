import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './worker.js';

const documents = [
  {
    text: 'Art. 41 Funciones del CEPAI. Emitir dictamen favorable para la declaratoria de Zona Franca.',
    source: 'COPCI.pdf',
    page: 23,
  },
  {
    text: 'Art. 46 Plazo de existencia. La declaratoria de Zona Franca tendrá como plazo de existencia un periodo mínimo de 30 años y podrá ser prorrogado por un término igual al suscrito en el contrato, las veces que sean necesarias.',
    source: 'COPCI.pdf',
    page: 24,
  },
  {
    text: 'Art. 16 Modalidades de inversión. Las modalidades de inversión y sus excepciones se establecerán en el Reglamento.',
    source: 'COPCI.pdf',
    page: 10,
  },
  {
    text: 'Art. 16.1 Estabilidad jurídica de la inversión. Además de la estabilidad tributaria que se garantiza en este Código, se podrá otorgar estabilidad jurídica de la normativa sectorial específica declarada como esencial en contratos de concesión. El plazo de vigencia de dicha estabilidad jurídica será el mismo plazo del contrato de inversión.',
    source: 'COPCI.pdf',
    page: 10,
  },
];

function createEnv(run = async () => ({ response: 'Respuesta generada con contexto.' })) {
  return {
    AI: { run },
    ASSETS: {
      fetch: async (request) => {
        if (new URL(request.url).pathname === '/documents.json') {
          return Response.json(documents);
        }
        return new Response('static asset');
      },
    },
  };
}

function createQuestionRequest(question, options = {}) {
  return new Request('https://assistant.example/api/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body ?? JSON.stringify({ question }),
  });
}

test('API responds with the verified Article 46 answer and page 24 source', async () => {
  let inferenceCalled = false;
  const response = await worker.fetch(
    createQuestionRequest('¿Cuál es el plazo de existencia de una Zona Franca y cuántas veces puede prorrogarse?'),
    createEnv(async () => {
      inferenceCalled = true;
      return { response: 'unexpected' };
    }),
  );
  const body = await response.json();

  assert.equal(inferenceCalled, false);
  assert.equal(body.mode, 'verificada');
  assert.match(body.answer, /mínimo de 30 años/);
  assert.deepEqual(body.sources, ['COPCI.pdf, pág. 24']);
});

test('API returns only the exact requested article and its source page', async () => {
  let model;
  const response = await worker.fetch(
    createQuestionRequest('¿Qué establece el artículo 16.1 sobre estabilidad jurídica de la inversión?'),
    createEnv(async (modelId, input) => {
      model = modelId;
      return { response: input.messages[1].content };
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(model, undefined);
  assert.match(body.answer, /Art\. 16\.1/);
  assert.match(body.answer, /plazo del contrato de inversión/);
  assert.doesNotMatch(body.answer, /Modalidades de inversión/);
  assert.match(body.answer, /estabilidad jurídica/);
  assert.equal(body.mode, 'extractiva');
  assert.deepEqual(body.sources, ['COPCI.pdf, pág. 10']);
});

test('API returns cited extracts if Cloudflare inference is unavailable', async () => {
  const response = await worker.fetch(
    createQuestionRequest('¿Qué establece el artículo 16.1 sobre estabilidad jurídica de la inversión?'),
    createEnv(async () => {
      throw new Error('AI binding unavailable');
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.mode, 'extractiva');
  assert.match(body.answer, /Art\. 16\.1/);
  assert.deepEqual(body.sources, ['COPCI.pdf, pág. 10']);
});

test('API validates the method, media type, JSON, and question length', async () => {
  const env = createEnv();
  const getResponse = await worker.fetch(
    new Request('https://assistant.example/api/answer'),
    env,
  );
  const textResponse = await worker.fetch(
    new Request('https://assistant.example/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'question',
    }),
    env,
  );
  const invalidJsonResponse = await worker.fetch(
    createQuestionRequest('', { body: '{invalid' }),
    env,
  );
  const longQuestionResponse = await worker.fetch(
    createQuestionRequest('x'.repeat(2001)),
    env,
  );

  assert.equal(getResponse.status, 405);
  assert.equal(textResponse.status, 415);
  assert.equal(invalidJsonResponse.status, 400);
  assert.equal(longQuestionResponse.status, 400);
});

test('Worker continues serving static assets for non-API routes', async () => {
  const response = await worker.fetch(
    new Request('https://assistant.example/'),
    createEnv(),
  );

  assert.equal(await response.text(), 'static asset');
});
