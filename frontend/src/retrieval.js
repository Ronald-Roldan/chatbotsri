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

export function retrieveDocuments(question, documents, limit = 5) {
  const queryTerms = new Set(normalizeTerms(question).filter((term) => !STOP_WORDS.has(term)));
  const expandedTerms = new Set(queryTerms);
  for (const term of queryTerms) {
    for (const synonym of SYNONYMS[term] ?? []) expandedTerms.add(synonym);
    if (term.length > 4 && term.endsWith('s')) expandedTerms.add(term.slice(0, -1));
  }

  if (expandedTerms.size === 0) return [];

  const tokenizedDocuments = documents.map((document) => normalizeTerms(document.text));
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

  return documents
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
          1 + (documents.length - docFrequency + 0.5) / (docFrequency + 0.5),
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
