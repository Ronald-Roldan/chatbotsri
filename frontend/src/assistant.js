export async function answerQuestion(question) {
  const response = await fetch('/api/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'No se pudo procesar la consulta en línea.');
  }
  return result;
}
