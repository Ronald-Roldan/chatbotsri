import assert from 'node:assert/strict';
import test from 'node:test';
import { findVerifiedZoneValidityAnswer, retrieveDocuments } from './retrieval.js';

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
