import logging
import os
import re
import unicodedata
import heapq
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from langchain_chroma import Chroma
from langchain_ollama import OllamaEmbeddings, OllamaLLM
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from pypdf import PdfReader

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Asistente documental del SRI",
    description="Consulta documental basada en normativa indexada del SRI.",
    version="1.0.0",
)

configured_cors_origins = os.getenv("SRI_CORS_ORIGINS")
cors_origins = configured_cors_origins.split(",") if configured_cors_origins else []
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in cors_origins if origin.strip()],
    allow_origin_regex=(
        None
        if configured_cors_origins
        else r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
    ),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class ConsultaRequest(BaseModel):
    pregunta: str = Field(min_length=3, max_length=2000, strip_whitespace=True)


PROJECT_DIR = Path(__file__).resolve().parent.parent
VECTOR_DB_DIR = PROJECT_DIR / "data" / "vector_db"
COLLECTION_NAME = "sri_documentos"
ACTIVE_COLLECTION_FILE = VECTOR_DB_DIR / "active_collection.txt"
LLM_MODEL = os.getenv("SRI_LLM_MODEL", "phi3")
EMBEDDING_MODEL = os.getenv("SRI_EMBEDDING_MODEL", "nomic-embed-text")
SPANISH_STOP_WORDS = {
    "como", "con", "cual", "cuando", "desde", "dice", "donde", "el", "ella", "ellas",
    "ellos", "en", "entre", "era", "es", "esta", "este", "estos", "fue", "ha",
    "hasta", "la", "las", "le", "les", "lo", "los", "mas", "mi", "para", "pero",
    "por", "que", "se", "segun", "sin", "sobre", "su", "sus", "un", "una", "uno",
    "unos", "unas", "y",
}


@lru_cache(maxsize=1)
def _load_vectorstore(collection_name: str):
    return Chroma(
        collection_name=collection_name,
        persist_directory=str(VECTOR_DB_DIR),
        embedding_function=OllamaEmbeddings(model=EMBEDDING_MODEL),
    )


def get_vectorstore():
    database_file = VECTOR_DB_DIR / "chroma.sqlite3"
    if not database_file.is_file() or database_file.stat().st_size == 0:
        raise HTTPException(
            status_code=503,
            detail="La base documental no está disponible. Indexa primero los documentos PDF del SRI.",
        )

    try:
        active_collection = ACTIVE_COLLECTION_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        active_collection = ""

    collection_names = dict.fromkeys(
        name for name in (active_collection, COLLECTION_NAME, "langchain") if name
    )
    for collection_name in collection_names:
        if collection_name not in {COLLECTION_NAME, "langchain"} and not collection_name.startswith(
            f"{COLLECTION_NAME}_"
        ):
            continue
        vectorstore = _load_vectorstore(collection_name)
        if vectorstore.get(limit=1).get("ids"):
            return vectorstore

    raise HTTPException(
        status_code=503,
        detail="El índice documental está vacío. Ejecuta `py scripts\\vectorize_data.py` para incorporar los PDF del SRI.",
    )


@lru_cache(maxsize=1)
def get_llm():
    return OllamaLLM(model=LLM_MODEL, temperature=0.1)


def normalize_terms(text):
    normalized = unicodedata.normalize("NFKD", text.casefold())
    without_marks = "".join(character for character in normalized if not unicodedata.combining(character))
    return re.findall(r"[a-z0-9]{3,}", without_marks)


@lru_cache(maxsize=1)
def load_pdf_pages():
    pdf_directory = PROJECT_DIR / "data" / "raw_pdf"
    pdf_files = sorted(
        path
        for path in pdf_directory.rglob("*")
        if path.is_file() and path.suffix.lower() == ".pdf"
    )
    pages = []
    for pdf_path in pdf_files:
        try:
            reader = PdfReader(pdf_path)
            for page_number, page in enumerate(reader.pages):
                text = page.extract_text() or ""
                if text.strip():
                    pages.append(Document(
                        page_content=text,
                        metadata={"source": str(pdf_path.resolve()), "page": page_number},
                    ))
        except Exception:
            logger.exception("No se pudo leer el PDF %s durante la carga", pdf_path.name)
    return tuple(pages)


def search_pdf_pages(question, limit=4):
    query_terms = set(normalize_terms(question)) - SPANISH_STOP_WORDS
    if not query_terms:
        query_terms = set(normalize_terms(question))

    best_documents = []
    sequence = 0
    query_phrase = " ".join(
        term for term in normalize_terms(question) if term not in SPANISH_STOP_WORDS
    )

    for document in load_pdf_pages():
        page_terms = normalize_terms(document.page_content)
        term_counts = {}
        for term in page_terms:
            term_counts[term] = term_counts.get(term, 0) + 1
        matched_terms = query_terms.intersection(term_counts)
        required_matches = min(2, len(query_terms))
        if len(matched_terms) < required_matches:
            continue

        score = sum(
            min(term_counts.get(term, 0), 3) * (2 if len(term) >= 6 else 1)
            for term in matched_terms
        )
        normalized_page = " ".join(page_terms)
        if query_phrase and query_phrase in normalized_page:
            score += 20
        title_terms = set(normalize_terms(Path(document.metadata["source"]).stem))
        title_matches = query_terms & title_terms
        if document.metadata.get("page") == 0:
            score += 20 * len(title_matches)
        if score:
            candidate = (score, sequence, document)
            sequence += 1
            if len(best_documents) < limit:
                heapq.heappush(best_documents, candidate)
            elif score > best_documents[0][0]:
                heapq.heapreplace(best_documents, candidate)

    best_documents.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [document for _, _, document in best_documents]


def format_source(metadata, page_content=""):
    metadata = metadata or {}
    source = metadata.get("source")
    if not source:
        match = re.search(r"\[Fuente:\s*([^\]]+)\]", page_content)
        source = match.group(1) if match else None
    if not source:
        source = "Documento oficial del SRI"
    source = Path(str(source)).name
    page = metadata.get("page")
    if isinstance(page, int):
        return f"{source}, pág. {page + 1}"
    return source


@app.get("/")
def read_root():
    return {"servicio": app.title, "estado": "activo"}


@app.get("/health")
def health_check():
    try:
        index_available = bool(get_vectorstore().get(limit=1).get("ids"))
    except HTTPException:
        index_available = False
    except Exception:
        logger.exception("No se pudo comprobar la colección documental")
        index_available = False

    return {
        "estado": "activo" if index_available else "incompleto",
        "indice_documental": index_available,
    }


@app.post("/api/chat")
def consultar_sri(request: ConsultaRequest):
    try:
        vectorstore = get_vectorstore()
        modo_busqueda = "semantica"
        try:
            docs_recuperados = vectorstore.as_retriever(
                search_kwargs={"k": 4}
            ).invoke(request.pregunta)
        except Exception:
            logger.exception("Falló la búsqueda semántica; se probará búsqueda por términos")
            docs_recuperados = search_pdf_pages(request.pregunta)
            modo_busqueda = "lexica"

        if not docs_recuperados:
            return {
                "pregunta": request.pregunta,
                "respuesta": "No encontré información en los documentos indexados del SRI para responder esta consulta. Verifica que la normativa necesaria esté incorporada en la base documental.",
                "fuentes": [],
                "modo": "sin_resultados",
            }

        contexto_texto = "\n\n".join(doc.page_content for doc in docs_recuperados)
        template = """Responde la pregunta del usuario basándote exclusivamente en el siguiente contexto oficial del SRI. Si la respuesta no se encuentra en el texto, indica claramente que no dispones de información oficial comprobada para esa consulta.

Contexto oficial:
{context}

Pregunta del contribuyente: {question}

Responde en español, con tono profesional. Distingue los hechos expresos de cualquier inferencia y no inventes artículos, fechas, valores ni obligaciones. Esta respuesta es informativa y no sustituye una validación oficial del SRI."""
        prompt = ChatPromptTemplate.from_template(template)
        rag_chain = (
            {"context": lambda _: contexto_texto, "question": RunnablePassthrough()}
            | prompt
            | get_llm()
            | StrOutputParser()
        )
        if modo_busqueda == "lexica":
            generacion_fallida = True
            introduccion = (
                "No se pudo cargar el modelo de búsqueda semántica. "
                "Estos extractos se buscaron directamente en las páginas PDF por coincidencia de términos; "
                "son texto literal, no una respuesta interpretada por IA."
            )
        else:
            try:
                respuesta_generada = rag_chain.invoke(request.pregunta)
                modo_respuesta = "generada"
                generacion_fallida = False
            except Exception:
                logger.exception("Falló la generación; se devolverán extractos documentales")
                generacion_fallida = True
                introduccion = (
                    "No se pudo generar una respuesta con el modelo de IA. "
                    "A continuación se muestran extractos literales para revisión; "
                    "no constituyen una interpretación de la consulta."
                )

        if generacion_fallida:
            extractos = []
            paginas_incluidas = set()
            for doc in docs_recuperados:
                fuente = format_source(doc.metadata, doc.page_content)
                if fuente in paginas_incluidas:
                    continue
                paginas_incluidas.add(fuente)

                fragmento = doc.page_content.strip()
                if len(fragmento) > 900:
                    fragmento = fragmento[:900].rsplit(" ", 1)[0] + "..."
                extractos.append(f"[{fuente}]\n{fragmento}")
                if len(extractos) == 3:
                    break

            respuesta_generada = introduccion + "\n\n" + "\n\n".join(extractos)
            modo_respuesta = "extractiva"

        fuentes = list(
            dict.fromkeys(format_source(doc.metadata, doc.page_content) for doc in docs_recuperados)
        )

        return {
            "pregunta": request.pregunta,
            "respuesta": respuesta_generada,
            "fuentes": fuentes,
            "modo": modo_respuesta,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("No se pudo procesar la consulta documental")
        raise HTTPException(
            status_code=503,
            detail="No fue posible generar la respuesta. Verifica que Ollama esté activo, que el modelo configurado esté instalado y que el equipo tenga memoria suficiente.",
        ) from e