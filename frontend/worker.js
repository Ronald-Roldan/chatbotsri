import {
  createExtractiveFallback,
  findRequestedArticleAnswer,
  findVerifiedInvestmentStabilityAnswer,
  findVerifiedZoneValidityAnswer,
  retrieveDocuments,
} from './src/retrieval.js';

const MODEL_ID = '@cf/meta/llama-3.2-1b-instruct';
const MAX_QUESTION_LENGTH = 2000;
let documentsPromise;

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function loadDocuments(request, assets) {
  documentsPromise ??= assets.fetch(new Request(new URL('/documents.json', request.url)))
    .then(async (response) => {
      if (!response.ok) throw new Error(`No se pudo cargar el corpus (${response.status}).`);
      const documents = await response.json();
      if (!Array.isArray(documents) || documents.length === 0) {
        throw new Error('El corpus documental está vacío.');
      }
      return documents;
    })
    .catch((error) => {
      documentsPromise = undefined;
      throw error;
    });
  return documentsPromise;
}

function getAnswerText(result) {
  if (typeof result === 'string') return result.trim();
  if (result && typeof result === 'object' && 'response' in result) {
    return typeof result.response === 'string' ? result.response.trim() : '';
  }
  return '';
}

async function answerQuestion(request, env) {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return jsonResponse({ error: 'El contenido debe enviarse como application/json.' }, 415);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'El cuerpo de la consulta no es JSON válido.' }, 400);
  }

  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return jsonResponse({
      error: `La pregunta debe tener entre 1 y ${MAX_QUESTION_LENGTH} caracteres.`,
    }, 400);
  }

  const documents = await loadDocuments(request, env.ASSETS);
  const verifiedAnswer = findVerifiedZoneValidityAnswer(question, documents)
    ?? findVerifiedInvestmentStabilityAnswer(question, documents);
  if (verifiedAnswer) return jsonResponse(verifiedAnswer);

  const articleAnswer = findRequestedArticleAnswer(question, documents);
  if (articleAnswer) return jsonResponse(articleAnswer);

  const matches = retrieveDocuments(question, documents);
  if (matches.length === 0) {
    return jsonResponse({
      answer: 'No encontré fragmentos pertinentes en los documentos incorporados para responder esta consulta.',
      sources: [],
      mode: 'sin_resultados',
    });
  }

  const sources = [...new Set(matches.map(({ source, page }) => `${source}, pág. ${page}`))];
  const context = matches
    .map(({ source, page, text }) => `[Fuente: ${source}, pág. ${page}]\n${text}`)
    .join('\n\n')
    .slice(0, 12000);

  try {
    const result = await env.AI.run(MODEL_ID, {
      messages: [
        {
          role: 'system',
          content: 'Eres un asistente jurídico-documental del SRI. Responde en español y exclusivamente con el contexto. Identifica el artículo que trata el tema concreto; no confundas artículos que solo comparten palabras. Para cifras, plazos y requisitos, exige evidencia textual directa. Si la evidencia no basta o el documento indica que una norma fue derogada, adviértelo claramente. No inventes artículos, vigencia ni fuentes. Responde de forma directa en máximo 120 palabras.',
        },
        {
          role: 'user',
          content: `Contexto documental:\n${context}\n\nPregunta: ${question}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 320,
    });
    const answer = getAnswerText(result);
    if (!answer) throw new Error('Workers AI no devolvió texto para la respuesta.');
    return jsonResponse({ answer, sources, mode: 'generada' });
  } catch (error) {
    console.error('Falló la inferencia de Workers AI; se mostrarán extractos documentales.', error);
    return jsonResponse(createExtractiveFallback(matches));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/answer') {
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'Método no permitido.' }, 405);
      }

      try {
        return await answerQuestion(request, env);
      } catch (error) {
        console.error('No se pudo procesar la consulta documental.', error);
        return jsonResponse({ error: 'No se pudo consultar la base documental en línea.' }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
