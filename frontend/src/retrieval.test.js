import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createExtractiveFallback,
  findRequestedArticleAnswer,
  findVerifiedInvestmentStabilityAnswer,
  findVerifiedZoneValidityAnswer,
  retrieveDocuments,
} from './retrieval.js';

test('exact COPCI free-zone validity question uses Article 46 and page 24', () => {
  const documents = [
    {
      text: 'Art. 15 Emitir dictamen favorable de declaratoria de Zonas Francas.',
      source: 'COPCI.pdf',
      page: 10,
    },
    {
      text: 'Art. 41 Funciones del CEPAI para declarar una Zona Franca.',
      source: 'COPCI.pdf',
      page: 23,
    },
    {
      text: 'Art. 46 Plazo de existencia. La declaratoria de Zona Franca tendrá como plazo de existencia un periodo mínimo de 30 años y podrá ser prorrogado por un término igual al suscrito en el contrato, las veces que sean necesarias.',
      source: 'COPCI.pdf',
      page: 24,
    },
  ];
  const question = 'En el COPCI, ¿cuál es el plazo de vigencia de una declaratoria de Zona Franca?';

  const answer = findVerifiedZoneValidityAnswer(question, documents);

  assert.equal(answer.mode, 'verificada');
  assert.match(answer.answer, /artículo 46/);
  assert.match(answer.answer, /mínimo de 30 años/);
  assert.match(answer.answer, /tantas veces como sea necesario/);
  assert.deepEqual(answer.sources, ['COPCI.pdf, pág. 24']);
});

test('lexical retrieval ranks the exact free-zone validity article above CEPAI duties', () => {
  const documents = [
    {
      text: 'Art. 41 Funciones del CEPAI. Emitir dictamen favorable para la declaratoria de Zona Franca.',
      source: 'COPCI.pdf',
      page: 23,
    },
    {
      text: 'Art. 46 Plazo de existencia. La declaratoria de Zona Franca tendrá como plazo de existencia un periodo mínimo de 30 años y podrá ser prorrogado por un término igual al suscrito en el contrato.',
      source: 'COPCI.pdf',
      page: 24,
    },
  ];

  const matches = retrieveDocuments(
    'En el COPCI, ¿cuál es el plazo de vigencia de una declaratoria de Zona Franca?',
    documents,
  );

  assert.equal(matches[0].page, 24);
});

test('an explicitly requested article excludes a neighboring article even on the same page', () => {
  const documents = [
    {
      text: 'Art. 16 Modalidades de inversión. Las modalidades y sus excepciones se establecerán en el Reglamento.',
      source: 'COPCI.pdf',
      page: 10,
    },
    {
      text: 'Art. 16.1 Estabilidad jurídica de la inversión. Se podrá otorgar estabilidad jurídica a normativa sectorial específica declarada esencial en contratos de concesión. El plazo será el mismo del contrato de inversión.',
      source: 'COPCI.pdf',
      page: 10,
    },
    {
      text: 'Art. 17 Contratos de inversión.',
      source: 'COPCI.pdf',
      page: 11,
    },
  ];

  const matches = retrieveDocuments(
    '¿Qué establece el artículo 16.1 sobre la estabilidad jurídica de la inversión?',
    documents,
  );

  assert.equal(matches.length, 1);
  assert.match(matches[0].text, /estabilidad jurídica de la inversión/i);
  assert.doesNotMatch(matches[0].text, /Las modalidades y sus excepciones/);
  assert.doesNotMatch(matches[0].text, /Art\. 16\.2/);
  assert.deepEqual(retrieveDocuments('¿Qué establece el artículo 99?', documents), []);
});

test('explicit article answers quote only that article and cite its page', () => {
  const documents = [
    {
      text: 'Art. 16.1',
      source: 'COPCI.pdf',
      page: 10,
    },
    {
      text: 'Art. 16.1\nEstabilidad jurídica de la inversión. La estabilidad de los correspondientes contrato s de concesión será igual al plazo del contrato.\nArt. 16.2\nOtra disposición.',
      source: 'COPCI.pdf',
      page: 10,
    },
  ];

  const answer = findRequestedArticleAnswer(
    '¿Qué establece el artículo 16.1 sobre estabilidad jurídica?',
    documents,
  );

  assert.equal(answer.mode, 'extractiva');
  assert.match(answer.answer, /Estabilidad jurídica de la inversión/);
  assert.match(answer.answer, /contratos de concesión/);
  assert.doesNotMatch(answer.answer, /contrato s/);
  assert.match(answer.answer, /plazo del contrato/);
  assert.doesNotMatch(answer.answer, /Otra disposición/);
  assert.deepEqual(answer.sources, ['COPCI.pdf, pág. 10']);
});

test('article retrieval ignores a heading-only chunk when the body is in an overlap', () => {
  const documents = [
    {
      text: 'Art. 16.1',
      source: 'COPCI.pdf',
      page: 10,
    },
    {
      text: 'Art. 16.1\nEstabilidad jurídica de la inversión. La estabilidad será igual al plazo del contrato.',
      source: 'COPCI.pdf',
      page: 10,
    },
  ];

  const matches = retrieveDocuments(
    '¿Qué establece el artículo 16.1 sobre estabilidad jurídica?',
    documents,
  );
  assert.equal(matches.length, 1);
  assert.match(matches[0].text, /Estabilidad jurídica/);
});

test('investment stability answer preserves the greater-than threshold and repeal warning', () => {
  const documents = [
    {
      text: 'Dicha estabilidad tributaria también podrá ser concedida a petición de parte, en el contrato de inversión de las sociedades de otros sectores, siempre que: 1. El monto de la inversión sea mayor a 100 millones de dólares.',
      source: 'COPCI.pdf',
      page: 16,
    },
    {
      text: 'Ley 0 derogada por Ley No. 0, publicada en Registro Oficial Suplemento 484 de 9 de Mayo del 2019.',
      source: 'COPCI.pdf',
      page: 16,
    },
  ];

  const answer = findVerifiedInvestmentStabilityAnswer(
    'Según el COPCI, ¿cuál es el monto mínimo de inversión para solicitar estabilidad tributaria a petición de parte?',
    documents,
  );

  assert.equal(answer.mode, 'verificada');
  assert.match(answer.answer, /mayor a USD 100 millones/);
  assert.match(answer.answer, /derogado en 2019/);
  assert.deepEqual(answer.sources, ['COPCI.pdf, pág. 16']);
});

test('investment stability threshold is not inferred when the document lacks it', () => {
  const answer = findVerifiedInvestmentStabilityAnswer(
    '¿Cuál es el monto mínimo de inversión para estabilidad tributaria a petición de parte?',
    [{ text: 'El contrato de inversión podrá establecer estabilidad tributaria.' }],
  );

  assert.equal(answer, null);
});

test('model fallback returns cited document excerpts instead of a failed chat', () => {
  const answer = createExtractiveFallback([
    { text: 'El monto de inversión será mayor a 100 millones.', source: 'COPCI.pdf', page: 16 },
    { text: 'Este fragmento no responde la consulta.', source: 'Otro.pdf', page: 95 },
  ]);

  assert.equal(answer.mode, 'extractiva');
  assert.match(answer.answer, /No se pudo iniciar el modelo/);
  assert.match(answer.answer, /mayor a 100 millones/);
  assert.doesNotMatch(answer.answer, /no responde la consulta/);
  assert.deepEqual(answer.sources, ['COPCI.pdf, pág. 16']);
});
