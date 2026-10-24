import { findVerifiedZoneValidityAnswer, retrieveDocuments } from './retrieval.js';

const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
let documentsPromise;
let enginePromise;

export function loadDocuments() {
  documentsPromise ??= fetch('/documents.json')
    .then((response) => {
      if (!response.ok) throw new Error('No se pudo cargar el corpus documental.');
      return response.json();
    })
    .then((documents) => {
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

function loadModel(onProgress) {
  if (!navigator.gpu) {
    throw new Error(
      'Este navegador o equipo no ofrece WebGPU. Prueba la última versión de Chrome o Edge en un equipo compatible.',
    );
  }

  enginePromise ??= import('@mlc-ai/web-llm')
    .then(({ CreateMLCEngine }) => CreateMLCEngine(MODEL_ID, {
      initProgressCallback: ({ text }) => onProgress(text),
    }))
    .catch((error) => {
      enginePromise = undefined;
      throw new Error(
        `No se pudo iniciar el modelo local del navegador: ${error.message}`,
        { cause: error },
      );
    });

  return enginePromise;
}

export async function answerQuestion(question, onProgress = () => {}) {
  const documents = await loadDocuments();
  const verifiedAnswer = findVerifiedZoneValidityAnswer(question, documents);
  if (verifiedAnswer) return verifiedAnswer;

  const matches = retrieveDocuments(question, documents);
  if (matches.length === 0) {
    return {
      answer: 'No encontré fragmentos pertinentes en los documentos incorporados para responder esta consulta.',
      sources: [],
      mode: 'sin_resultados',
    };
  }

  const context = matches
    .map((document) => `[Fuente: ${document.source}, pág. ${document.page}]\n${document.text}`)
    .join('\n\n');
  const engine = await loadModel(onProgress);
  const result = await engine.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: 'Eres un asistente jurídico-documental del SRI. Contesta en español, de forma directa y precisa, exclusivamente con el contexto proporcionado. Distingue la pregunta concreta de otros artículos que compartan palabras. Para cifras, plazos y requisitos, prioriza el artículo cuyo encabezado y tema coincidan con la pregunta; no confundas funciones del CEPAI con plazos de vigencia. Si no hay evidencia suficiente, dilo sin completar con conocimiento externo. No inventes artículos ni fuentes. Cita el artículo solo si está identificado en el contexto. Máximo 120 palabras.',
      },
      {
        role: 'user',
        content: `Contexto oficial:\n${context}\n\nPregunta: ${question}`,
      },
    ],
    temperature: 0.1,
    max_tokens: 320,
  });

  return {
    answer: result.choices[0]?.message?.content?.trim()
      || 'El modelo no produjo una respuesta. Inténtalo nuevamente.',
    sources: [...new Set(matches.map((document) => `${document.source}, pág. ${document.page}`))],
    mode: 'generada',
  };
}
