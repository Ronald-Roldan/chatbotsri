const STOP_WORDS = new Set([
  'a', 'al', 'como', 'con', 'cual', 'cuando', 'de', 'del', 'desde', 'donde',
  'el', 'ella', 'ellas', 'ellos', 'en', 'entre', 'es', 'esta', 'este', 'esto',
  'fue', 'ha', 'hasta', 'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'para',
  'pero', 'por', 'que', 'se', 'segun', 'sin', 'sobre', 'su', 'sus', 'un',
  'una', 'uno', 'unos', 'unas', 'y',
]);

const SYNONYMS = {
  existencia: ['plazo', 'periodo'],
  vigencia: ['existencia', 'plazo', 'periodo'],
  prorroga: ['prorrogado', 'prorrogada', 'veces'],
  declaratoria: ['declaracion', 'declarar'],
  zona: ['zonas'],
  franca: ['francas'],
};

export function normalizeTerms(text) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .match(/[a-z0-9]{3,}/g) ?? [];
}

function requestedArticleNumber(question) {
  const normalizedQuestion = question
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
  return normalizedQuestion.match(/\b(?:articulo|art)\.?\s*(\d+(?:\.\d+)?)/)?.[1] ?? null;
}

function extractArticleExcerpt(text, articleNumber) {
  const escapedArticleNumber = articleNumber.replace('.', '\\.');
  const headingPattern = new RegExp(
    `(?:^|\\n)\\s*Art\\.?\\s*${escapedArticleNumber}(?![\\d.])`,
    'im',
  );
  const headingMatch = headingPattern.exec(text);
  if (!headingMatch) return null;

  const articleStart = headingMatch.index + headingMatch[0].search(/Art/i);
  const articleEnd = new RegExp(
    '\\n\\s*Art\\.?\\s*\\d+(?:\\.\\d+)?(?![\\d.])',
    'gim',
  );
  articleEnd.lastIndex = articleStart + headingMatch[0].length;
  const nextHeading = articleEnd.exec(text);
  return text.slice(articleStart, nextHeading?.index ?? text.length).trim();
}

export function retrieveDocuments(question, documents, limit = 5) {
  const articleNumber = requestedArticleNumber(question);
  const candidateDocuments = articleNumber
    ? documents.flatMap((document) => {
      const text = extractArticleExcerpt(document.text, articleNumber);
      return text ? [{ ...document, text }] : [];
    })
    : documents;
  if (candidateDocuments.length === 0) return [];

  const queryTerms = new Set(normalizeTerms(question).filter((term) => !STOP_WORDS.has(term)));
  const expandedTerms = new Set(queryTerms);
  for (const term of queryTerms) {
    for (const synonym of SYNONYMS[term] ?? []) expandedTerms.add(synonym);
    if (term.length > 4 && term.endsWith('s')) expandedTerms.add(term.slice(0, -1));
  }

  if (expandedTerms.size === 0) return [];

  const tokenizedDocuments = candidateDocuments.map((document) => normalizeTerms(document.text));
  const documentFrequency = new Map();
  for (const tokens of tokenizedDocuments) {
    for (const term of new Set(tokens)) {
      if (expandedTerms.has(term)) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
    }
  }

  const averageLength = tokenizedDocuments.reduce((sum, tokens) => sum + tokens.length, 0)
    / Math.max(tokenizedDocuments.length, 1);

  return candidateDocuments
    .map((document, index) => {
      const tokens = tokenizedDocuments[index];
      const counts = new Map();
      for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

      let score = 0;
      for (const term of expandedTerms) {
        const frequency = counts.get(term) ?? 0;
        if (!frequency) continue;
        const docFrequency = documentFrequency.get(term) ?? 0;
        const idf = Math.log(
          1 + (candidateDocuments.length - docFrequency + 0.5) / (docFrequency + 0.5),
        );
        const denominator = frequency + 1.2 * (
          1 - 0.75 + 0.75 * tokens.length / Math.max(averageLength, 1)
        );
        score += idf * frequency * 2.2 / denominator;
      }

      return { document, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ document }) => document);
}

export function findRequestedArticleAnswer(question, documents) {
  const articleNumber = requestedArticleNumber(question);
  if (!articleNumber) return null;

  const article = documents
    .map((document) => ({
      document,
      excerpt: extractArticleExcerpt(document.text, articleNumber),
    }))
    .find(({ excerpt }) => excerpt);
  if (!article) return null;

  return {
    answer: `El artículo ${articleNumber} del COPCI establece: “${article.excerpt.replace(/\s+/g, ' ')}”`,
    sources: [`${article.document.source}, pág. ${article.document.page}`],
    mode: 'extractiva',
  };
}

export function findVerifiedZoneValidityAnswer(question, documents) {
  const terms = new Set(normalizeTerms(question));
  const isFreeZoneQuestion = terms.has('zona') && terms.has('franca');
  const asksAboutValidity = ['vigencia', 'existencia', 'plazo', 'prorroga', 'prorrogar']
    .some((term) => terms.has(term));
  if (!isFreeZoneQuestion || !asksAboutValidity) return null;

  const article = documents.find((document) => (
    /\bArt\.?\s*46\b/i.test(document.text)
    && /\b30\b/.test(document.text)
    && /Zona\s+Franca/i.test(document.text)
    && /prorrog/i.test(document.text)
    && /veces/i.test(document.text)
  ));
  if (!article) return null;

  return {
    answer: 'Según el artículo 46 del COPCI, la declaratoria de una Zona Franca tiene un plazo de existencia mínimo de 30 años. Puede prorrogarse por un término igual al establecido en el contrato, tantas veces como sea necesario.',
    sources: [`${article.source}, pág. ${article.page}`],
    mode: 'verificada',
  };
}

export function findVerifiedInvestmentStabilityAnswer(question, documents) {
  const terms = new Set(normalizeTerms(question));
  const asksForInvestmentAmount = ['monto', 'minimo', 'inversion']
    .some((term) => terms.has(term));
  const asksForStabilityOnRequest = (
    terms.has('estabilidad')
    && terms.has('tributaria')
    && terms.has('peticion')
    && terms.has('parte')
  );
  if (!asksForInvestmentAmount || !asksForStabilityOnRequest) return null;

  const article = documents.find(({ text }) => {
    const normalizedText = text.replace(/\s+/g, ' ');
    return /estabilidad tributaria/i.test(normalizedText)
      && /a petición de parte/i.test(normalizedText)
      && /monto de la inversión sea mayor a 100 millones de dólares/i.test(normalizedText);
  });
  if (!article) return null;

  const repealNoteExists = documents.some(({ text }) => (
    /Ley 0 derogada por Ley/i.test(text)
    && /9 de Mayo del 2019/i.test(text)
  ));
  const currentStatusNote = repealNoteExists
    ? 'Advertencia: el corpus también indica que ese capítulo fue derogado en 2019. Por tanto, esta es la cifra del texto incorporado, no una confirmación de que siga vigente; debe contrastarse con la versión oficial actual.'
    : 'El documento consultado no permite confirmar si esta disposición sigue vigente; debe contrastarse con la versión oficial actual.';

  return {
    answer: `El texto del COPCI incluido en el documento exige una inversión mayor a USD 100 millones (no basta con exactamente USD 100 millones) para conceder estabilidad tributaria a petición de parte. ${currentStatusNote}`,
    sources: [`${article.source}, pág. ${article.page}`],
    mode: 'verificada',
  };
}

export function createExtractiveFallback(documents) {
  const mostRelevantDocuments = documents.slice(0, 1);
  const excerpts = mostRelevantDocuments.map(({ text }) => {
    const excerpt = text.trim();
    return `“${excerpt.length > 900 ? `${excerpt.slice(0, 900).trimEnd()}…` : excerpt}”`;
  });

  return {
    answer: [
      'No se pudo iniciar el modelo de respuesta en este dispositivo. Para no inventar una interpretación, te muestro los fragmentos más relacionados del documento:',
      ...excerpts,
    ].join('\n\n'),
    sources: [...new Set(
      mostRelevantDocuments.map(({ source, page }) => `${source}, pág. ${page}`),
    )],
    mode: 'extractiva',
  };
}
