import { useEffect, useRef, useState } from 'react';
import { answerQuestion, loadDocuments } from './assistant.js';
import './App.css';

const HISTORY_KEY = 'sri-document-assistant-conversations';
const EMPTY_MESSAGES = [];
const SUGGESTED_QUESTIONS = [
  '¿Qué documentos necesito para inscribirme en el RUC?',
  '¿Qué establece la normativa sobre comprobantes de venta?',
  '¿Qué información contienen los documentos tributarios indexados?',
];

function loadConversations() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function App() {
  const [conversaciones, setConversaciones] = useState(loadConversations);
  const [conversacionActiva, setConversacionActiva] = useState(null);
  const [mensaje, setMensaje] = useState('');
  const [cargando, setCargando] = useState(false);
  const [estadoIndice, setEstadoIndice] = useState('comprobando');
  const [progresoModelo, setProgresoModelo] = useState('');
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);

  const chat = conversaciones.find((item) => item.id === conversacionActiva)?.mensajes ?? EMPTY_MESSAGES;

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(conversaciones));
    } catch {
      // El chat sigue disponible aunque el navegador bloquee el almacenamiento local.
    }
  }, [conversaciones]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat, cargando]);

  useEffect(() => {
    loadDocuments()
      .then(() => setEstadoIndice('disponible'))
      .catch(() => setEstadoIndice('incompleto'));
  }, []);

  const iniciarConversacion = () => {
    setConversacionActiva(null);
    setMensaje('');
    textareaRef.current?.focus();
  };

  const enviarPregunta = async (event) => {
    event.preventDefault();
    const pregunta = mensaje.trim();
    if (!pregunta || cargando) return;

    const id = conversacionActiva || window.crypto?.randomUUID?.() || `consulta-${Date.now()}`;
    const conversacion = conversaciones.find((item) => item.id === id);
    setConversacionActiva(id);
    setMensaje('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setConversaciones((prev) => [
      {
        id,
        titulo: conversacion?.titulo || pregunta.slice(0, 52),
        actualizada: Date.now(),
        mensajes: [
          ...(conversacion?.mensajes ?? []),
          { remitente: 'usuario', texto: pregunta },
        ],
      },
      ...prev.filter((item) => item.id !== id),
    ]);
    setCargando(true);

    try {
      const data = await answerQuestion(pregunta, setProgresoModelo);
      setConversaciones((prev) => prev.map((item) => item.id === id
        ? {
          ...item,
          actualizada: Date.now(),
          mensajes: [
            ...item.mensajes,
            {
              remitente: 'asistente',
              texto: data.answer,
              fuentes: data.sources,
              modo: data.mode,
            },
          ],
        }
        : item));
    } catch (error) {
      const textoError = error instanceof Error
        ? error.message
        : 'No se pudo procesar la consulta en este navegador.';
      setConversaciones((prev) => prev.map((item) => item.id === id
        ? {
          ...item,
          mensajes: [...item.mensajes, { remitente: 'asistente', texto: textoError, error: true }],
        }
        : item));
    } finally {
      setCargando(false);
      setProgresoModelo('');
    }
  };

  const manejarTecla = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const estadoTexto = {
    disponible: 'Base documental lista',
    incompleto: 'Índice documental pendiente',
    comprobando: 'Cargando documentos',
  }[estadoIndice];

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Conversaciones">
        <a className="brand" href="/" aria-label="Asistente documental del SRI">
          <span className="brand-mark" aria-hidden="true">SRI</span>
          <span className="brand-name">Asistente documental</span>
        </a>

        <button className="new-chat-button" onClick={iniciarConversacion} type="button">
          <span aria-hidden="true">+</span>
          Nueva consulta
        </button>

        <div className="history-heading">Recientes</div>
        <nav className="conversation-history" aria-label="Consultas recientes">
          {conversaciones.length === 0 ? (
            <p className="empty-history">Tus consultas aparecerán aquí.</p>
          ) : conversaciones.map((item) => (
            <button
              aria-current={item.id === conversacionActiva ? 'page' : undefined}
              className={`history-item${item.id === conversacionActiva ? ' history-item-active' : ''}`}
              key={item.id}
              onClick={() => setConversacionActiva(item.id)}
              title={item.titulo}
              type="button"
            >
              <span className="history-icon" aria-hidden="true">◷</span>
              <span>{item.titulo}</span>
            </button>
          ))}
        </nav>

        <footer className="sidebar-footer">
          <div className="index-status">
            <span className={`status-dot status-${estadoIndice}`} aria-hidden="true" />
            <span>{estadoTexto}</span>
          </div>
          <p>Modelo local en el navegador. Primera carga requiere conexión.</p>
        </footer>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark" aria-hidden="true">SRI</span>
            <span>Asistente documental</span>
          </div>
          <div className="topbar-title">
            <span>Consulta tributaria</span>
            <span className="topbar-separator">/</span>
            <strong>{conversacionActiva ? 'Conversación' : 'Nueva consulta'}</strong>
          </div>
          <button className="mobile-new-chat" onClick={iniciarConversacion} type="button">
            Nueva consulta
          </button>
        </header>

        <section className={`conversation${chat.length ? ' conversation-active' : ''}`} aria-label="Conversación">
          {chat.length === 0 ? (
            <div className="welcome-panel">
              <div className="welcome-mark" aria-hidden="true">SRI</div>
              <h1>¿En qué puedo ayudarte?</h1>
              <p>Consulta normativa con un modelo local. Tus preguntas se procesan en este navegador.</p>
              <div className="suggestions" aria-label="Preguntas sugeridas">
                {SUGGESTED_QUESTIONS.map((question) => (
                  <button
                    className="suggestion"
                    key={question}
                    onClick={() => {
                      setMensaje(question);
                      textareaRef.current?.focus();
                    }}
                    type="button"
                  >
                    <span>{question}</span>
                    <span className="suggestion-arrow" aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {chat.map((item, index) => (
                <article
                  className={`message message-${item.remitente}${item.error ? ' message-error' : ''}${item.modo === 'extractiva' ? ' message-extractiva' : ''}`}
                  key={`${conversacionActiva}-${index}`}
                >
                  {item.remitente === 'usuario' ? (
                    <div className="user-message-content">{item.texto}</div>
                  ) : (
                    <>
                      <div className="assistant-avatar" aria-hidden="true">SRI</div>
                      <div className="assistant-content">
                        <p className="message-label">
                          {item.modo === 'extractiva'
                            ? 'Extractos documentales · sin interpretación IA'
                            : item.modo === 'verificada'
                              ? 'Respuesta basada en fuente oficial'
                            : 'Asistente documental'}
                        </p>
                        <p className="message-text">{item.texto}</p>
                        {item.fuentes?.length > 0 && (
                          <div className="sources">
                            <p className="sources-label">Fuentes consultadas</p>
                            <ul>
                              {item.fuentes.map((fuente) => <li key={fuente}>{fuente}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </article>
              ))}
              {cargando && (
                <div className="loading-message" role="status">
                  <span className="assistant-avatar" aria-hidden="true">SRI</span>
                  <span className="loading-indicator" aria-hidden="true" />
                  {progresoModelo || 'Buscando en documentos y preparando el modelo local...'}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}
        </section>

        <footer className="composer-area">
          <form className="composer" onSubmit={enviarPregunta}>
            <label className="visually-hidden" htmlFor="pregunta">Escribe tu consulta</label>
            <textarea
              autoComplete="off"
              id="pregunta"
              maxLength={2000}
              onChange={(event) => {
                setMensaje(event.target.value);
                event.target.style.height = 'auto';
                event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`;
              }}
              onKeyDown={manejarTecla}
              placeholder="Pregunta sobre normativa, trámites u obligaciones tributarias..."
              ref={textareaRef}
              rows={1}
              value={mensaje}
            />
            <button
              aria-label="Enviar consulta"
              className="submit-button"
              disabled={cargando || !mensaje.trim()}
              type="submit"
            >
              <span aria-hidden="true">↑</span>
            </button>
          </form>
          <p className="disclaimer">
            Revisa las fuentes citadas. La información debe contrastarse con la normativa oficial vigente.
          </p>
        </footer>
      </section>
    </main>
  );
}

export default App;