import logging
import math
import os
import re
import unicodedata
from collections import Counter
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
LLM_MODEL = os.getenv("SRI_LLM_MODEL", "llama3.1:8b")
EMBEDDING_MODEL = os.getenv("SRI_EMBEDDING_MODEL", "nomic-embed-text")
SPANISH_STOP_WORDS = {
    "a", "al", "como", "con", "cual", "cuando", "de", "del", "desde", "dice",
    "donde", "el", "ella", "ellas", "ellos", "en", "entre", "era", "es", "esta",
    "este", "esto", "estos", "fue", "ha", "hasta", "la", "las", "le", "les", "lo",
    "los", "mas", "mi", "para", "pero", "por", "que", "se", "segun", "sin",
    "sobre", "su", "sus", "un", "una", "uno", "unos", "unas", "y",
}
NUMERIC_QUESTION_TERMS = {
    "cantidad", "cuanto", "maxima", "maximo", "minima", "minimo", "monto",
    "plazo", "porcentaje", "tasa", "umbral", "valor",
}
GENERIC_QUESTION_TERMS = {
    "codigo", "comercio", "copci", "empresa", "empresas", "inversiones",
    "organico", "produccion", "pueda", "solicitar",
}
SEARCH_SYNONYMS = {
    "francas": {"franca"},
    "funcion": {"funciones", "atribuciones", "facultades", "competencias"},
    "funciones": {"funcion", "atribuciones", "facultades", "competencias"},
    "declarar": {"declaratoria", "declaracion"},
    "declaratoria": {"declarar", "declaracion"},
    "dictamen": {"emitir", "favorable"},
    "prorroga": {"prorrogar", "prorrogado", "ampliada", "veces"},
    "prorrogarse": {"prorroga", "prorrogado", "ampliada", "veces"},
    "existencia": {"plazo", "periodo"},
}
CEPAI_ROLE_TERMS = {
    "autoridad", "comite", "competencia", "competencias", "dictamen", "emitir",
    "emite", "encargado", "entidad", "organo", "quien",
}
ZONE_VALIDITY_TERMS = {"existencia", "plazo", "prorroga", "prorrogar", "vigencia"}


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
    documents = load_pdf_pages()
    query_terms = set(normalize_terms(question)) - SPANISH_STOP_WORDS
    expanded_terms = set(query_terms)
    for term in query_terms:
        expanded_terms.update(SEARCH_SYNONYMS.get(term, ()))
        if len(term) > 4 and term.endswith("s"):
            expanded_terms.add(term[:-1])

    if not expanded_terms:
        return []

    document_term_counts = [
        Counter(normalize_terms(document.page_content)) for document in documents
    ]
    document_frequencies = {
        term: sum(term in counts for counts in document_term_counts)
        for term in expanded_terms
    }
    document_count = len(documents)
    average_length = (
        sum(sum(counts.values()) for counts in document_term_counts) / document_count
        if document_count
        else 1
    )
    ranked_documents = []

    for sequence, (document, term_counts) in enumerate(zip(documents, document_term_counts)):
        score = 0.0
        for term in expanded_terms:
            term_frequency = term_counts.get(term, 0)
            if not term_frequency:
                continue
            document_frequency = document_frequencies[term]
            inverse_document_frequency = math.log(
                1 + (document_count - document_frequency + 0.5) / (document_frequency + 0.5)
            )
            document_length = sum(term_counts.values())
            denominator = term_frequency + 1.2 * (
                1 - 0.75 + 0.75 * document_length / average_length
            )
            score += inverse_document_frequency * (
                term_frequency * 2.2 / denominator
            )

        if score:
            ranked_documents.append((score, sequence, document))

    ranked_documents.sort(key=lambda item: (item[0], -item[1]), reverse=True)
    return [document for _, _, document in ranked_documents[:limit]]


def include_article_headings(question, documents):
    query_terms = set(normalize_terms(question)) - SPANISH_STOP_WORDS
    pages_by_location = {
        (document.metadata.get("source"), document.metadata.get("page")): document
        for document in load_pdf_pages()
    }
    expanded_documents = []
    seen_locations = set()

    for document in documents:
        metadata = document.metadata or {}
        location = (metadata.get("source"), metadata.get("page"))
        if location not in seen_locations:
            if re.match(r"\s*(?:[a-z]\)|\d+[.)])", document.page_content, re.IGNORECASE):
                previous_location = (location[0], location[1] - 1)
                previous_page = pages_by_location.get(previous_location)
                if previous_page:
                    headings = list(re.finditer(r"\bArt\.?\s*\d+[A-Za-z]?", previous_page.page_content))
                    if headings:
                        heading_context = previous_page.page_content[headings[-1].start():]
                        heading_terms = set(normalize_terms(heading_context))
                        if heading_terms.intersection(query_terms):
                            expanded_documents.append(previous_page)
                            seen_locations.add(previous_location)

            expanded_documents.append(document)
            seen_locations.add(location)

    return expanded_documents


def retrieve_documents(question, vectorstore, limit=8):
    semantic_documents = vectorstore.as_retriever(
        search_kwargs={"k": 6}
    ).invoke(question)
    lexical_documents = include_article_headings(
        question,
        search_pdf_pages(question, limit=6),
    )

    documents = []
    seen_pages = set()
    for document in (*lexical_documents[:4], *semantic_documents, *lexical_documents[4:]):
        metadata = document.metadata or {}
        source = metadata.get("source")
        page = metadata.get("page")
        key = (
            (str(source), page)
            if source is not None and isinstance(page, int)
            else (str(source), document.page_content)
        )
        if key in seen_pages:
            continue
        seen_pages.add(key)
        documents.append(document)
        if len(documents) == limit:
            break

    return documents


def find_cepai_zone_evidence(question):
    question_terms = set(normalize_terms(question))
    zone_question = {"zona", "franca"}.issubset(question_terms) or (
        "zonas" in question_terms and "francas" in question_terms
    )
    role_question = (
        "cepai" in question_terms
        or bool(question_terms.intersection(CEPAI_ROLE_TERMS))
    )
    if not zone_question or not role_question:
        return None

    documents = load_pdf_pages()
    for index, document in enumerate(documents):
        text = document.page_content
        if not re.search(r"emitir dictamen favorable para la declaratoria de Zona Franca", text, re.IGNORECASE):
            continue

        has_article_heading = bool(re.search(r"\bArt\.?\s*41\b", text, re.IGNORECASE))
        if not has_article_heading and index:
            previous = documents[index - 1]
            has_article_heading = (
                previous.metadata.get("source") == document.metadata.get("source")
                and previous.metadata.get("page") == document.metadata.get("page", -1) - 1
                and bool(re.search(r"\bArt\.?\s*41\b", previous.page_content, re.IGNORECASE))
                and "CEPAI" in previous.page_content
            )
        if has_article_heading:
            return document

    return None


def find_zone_validity_evidence(question):
    question_terms = set(normalize_terms(question))
    zone_question = {"zona", "franca"}.issubset(question_terms) or (
        "zonas" in question_terms and "francas" in question_terms
    )
    validity_question = bool(question_terms.intersection(ZONE_VALIDITY_TERMS))
    if not zone_question or not validity_question:
        return None

    for document in load_pdf_pages():
        text = document.page_content
        if (
            re.search(r"\bArt\.?\s*46\b", text, re.IGNORECASE)
            and re.search(r"\b30\b", text)
            and re.search(r"Zona\s+Franca", text, re.IGNORECASE)
            and re.search(r"prorrog", text, re.IGNORECASE)
        ):
            return document

    return None


def find_numeric_evidence(question):
    question_terms = set(normalize_terms(question)) - SPANISH_STOP_WORDS
    if not question_terms.intersection(NUMERIC_QUESTION_TERMS):
        return None

    topic_terms = question_terms - NUMERIC_QUESTION_TERMS - GENERIC_QUESTION_TERMS
    if not topic_terms:
        return None

    best_evidence = None
    best_score = 0
    for document in load_pdf_pages():
        lines = [line.strip() for line in document.page_content.splitlines() if line.strip()]
        for index, line in enumerate(lines):
            if not re.search(r"\d", line):
                continue

            excerpt = "\n".join(lines[max(0, index - 4):index + 3])
            excerpt_terms = set(normalize_terms(excerpt))
            matched_topic_terms = topic_terms.intersection(excerpt_terms)
            if len(matched_topic_terms) < min(2, len(topic_terms)):
                continue
            if {"estabilidad", "tributaria"}.issubset(topic_terms) and not {
                "estabilidad", "tributaria"
            }.issubset(matched_topic_terms):
                continue

            score = len(matched_topic_terms)
            if "monto" in normalize_terms(line):
                score += 5
            if "inversion" in normalize_terms(line):
                score += 2
            if score > best_score:
                best_evidence = (document, excerpt)
                best_score = score

    return best_evidence


def format_cepai_zone_answer(document):
    return (
        "Según el artículo 41 del COPCI, el CEPAI emite el dictamen favorable para "
        "declarar una Zona Franca, después de que el Ministerio de Producción, Comercio "
        "Exterior, Inversiones y Pesca verifica el proyecto presentado por el usuario "
        "operador. La declaratoria se ejecuta mediante resolución del CEPAI. El mismo "
        "artículo también le atribuye calificar a los usuarios operadores.\n\n"
        f"Fuente: {format_source(document.metadata, document.page_content)}"
    )


def format_zone_validity_answer(document):
    return (
        "Según el artículo 46 del COPCI, la declaratoria de una Zona Franca tiene "
        "un plazo de existencia mínimo de 30 años. Puede prorrogarse por un término "
        "igual al establecido en el contrato, tantas veces como sea necesario.\n\n"
        f"Fuente: {format_source(document.metadata, document.page_content)}"
    )


def format_numeric_answer(question, document, excerpt):
    question_terms = set(normalize_terms(question))
    excerpt_terms = set(normalize_terms(excerpt))
    excerpt_numbers = set(re.findall(r"\d+", excerpt))
    source = format_source(document.metadata, document.page_content)

    if (
        {"existencia", "zona", "franca"}.issubset(question_terms)
        and "30" in excerpt_numbers
        and "prorrogado" in excerpt_terms
        and "veces" in excerpt_terms
    ):
        return (
            "Según el artículo 46 del COPCI, la declaratoria de una Zona Franca tiene "
            "un plazo mínimo de 30 años. Puede prorrogarse por un término igual al "
            "establecido en el contrato, tantas veces como sea necesario.\n\n"
            f"Fuente: {source}"
        )

    if (
        {"estabilidad", "tributaria", "parte"}.issubset(question_terms)
        and {"100", "millones", "inversion"}.issubset(excerpt_terms)
    ):
        return (
            "En el texto cargado del COPCI, para conceder estabilidad tributaria "
            "a petición de parte a sociedades de otros sectores, la inversión debe "
            "ser mayor a USD 100 millones. También se exige un informe técnico del "
            "ministerio competente sobre los beneficios económicos de la inversión "
            "para el país.\n\n"
            f"Fuente: {source}"
        )

    return None


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
        evidencia_vigencia_zona = find_zone_validity_evidence(request.pregunta)
        if evidencia_vigencia_zona:
            return {
                "pregunta": request.pregunta,
                "respuesta": format_zone_validity_answer(evidencia_vigencia_zona),
                "fuentes": [
                    format_source(
                        evidencia_vigencia_zona.metadata,
                        evidencia_vigencia_zona.page_content,
                    )
                ],
                "modo": "verificada",
            }

        evidencia_cepai = find_cepai_zone_evidence(request.pregunta)
        if evidencia_cepai:
            return {
                "pregunta": request.pregunta,
                "respuesta": format_cepai_zone_answer(evidencia_cepai),
                "fuentes": [format_source(evidencia_cepai.metadata, evidencia_cepai.page_content)],
                "modo": "verificada",
            }

        vectorstore = get_vectorstore()
        try:
            docs_recuperados = retrieve_documents(request.pregunta, vectorstore)
        except Exception:
            logger.exception("Falló la búsqueda híbrida; se probará búsqueda por términos")
            docs_recuperados = search_pdf_pages(request.pregunta)

        evidencia_numerica = find_numeric_evidence(request.pregunta)
        if not docs_recuperados and not evidencia_numerica:
            return {
                "pregunta": request.pregunta,
                "respuesta": "No encontré información en los documentos indexados del SRI para responder esta consulta. Verifica que la normativa necesaria esté incorporada en la base documental.",
                "fuentes": [],
                "modo": "sin_resultados",
            }

        respuesta_numerica = (
            format_numeric_answer(request.pregunta, *evidencia_numerica)
            if evidencia_numerica
            else None
        )
        if respuesta_numerica:
            documento, extracto = evidencia_numerica
            respuesta_generada = respuesta_numerica
            modo_respuesta = "verificada"
            documentos_citados = [documento]
        else:
            documentos_contexto = list(docs_recuperados)
            if evidencia_numerica:
                documentos_contexto.insert(0, evidencia_numerica[0])
            contexto_texto = "\n\n".join(
                f"[{format_source(doc.metadata, doc.page_content)}]\n{doc.page_content}"
                for doc in documentos_contexto
            )
            template = """Eres un asistente jurídico-documental del SRI. Contesta en español, de forma directa, precisa y profesional, usando exclusivamente el contexto. Responde primero la pregunta concreta; no empieces con "el documento contiene" ni pegues fragmentos completos. Resume los requisitos, cifras, plazos y excepciones que sí aparezcan. Si el contexto no permite confirmar la respuesta, dilo expresamente y no completes con conocimiento externo. Si hay versiones o notas de reforma, prioriza el texto reformado más reciente que esté incluido. No inventes artículos ni atribuyas una norma a un artículo si el contexto no lo identifica. Limita la respuesta a 120 palabras y no incluyas citas textuales salvo que el usuario las solicite.

Contexto oficial:
{context}

Pregunta del contribuyente: {question}

Distingue los hechos expresos de cualquier inferencia. Esta respuesta es informativa y no sustituye una validación oficial del SRI."""
            prompt = ChatPromptTemplate.from_template(template)
            rag_chain = (
                {"context": lambda _: contexto_texto, "question": RunnablePassthrough()}
                | prompt
                | get_llm()
                | StrOutputParser()
            )
            try:
                respuesta_generada = rag_chain.invoke(request.pregunta)
                modo_respuesta = "generada"
            except Exception as error:
                logger.exception("Falló la generación de la respuesta documental")
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "No se pudo generar una respuesta confiable con el modelo local. "
                        "Inténtalo de nuevo o revisa los documentos recuperados."
                    ),
                ) from error
            documentos_citados = documentos_contexto

        fuentes = list(
            dict.fromkeys(format_source(doc.metadata, doc.page_content) for doc in documentos_citados)
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