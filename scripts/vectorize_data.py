from pathlib import Path
from uuid import uuid4

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_ollama import OllamaEmbeddings
from langchain_chroma import Chroma
from pypdf import PdfReader

def vectorizar_documentos_sri():
    # Obtener la ruta absoluta de la carpeta del script actual
    current_dir = Path(__file__).resolve().parent
    
    # Definir rutas basadas en la estructura del proyecto
    raw_pdf_dir = current_dir.parent / "data" / "raw_pdf"
    vector_db_dir = current_dir.parent / "data" / "vector_db"

    if not raw_pdf_dir.is_dir():
        print(f"No se encontró la carpeta de documentos: {raw_pdf_dir}")
        return

    print(f"Leyendo documentos PDF desde: {raw_pdf_dir}")
    pdf_files = sorted(
        path
        for path in raw_pdf_dir.rglob("*")
        if path.is_file() and path.suffix.lower() == ".pdf"
    )
    documents = []
    for pdf_path in pdf_files:
        reader = PdfReader(pdf_path)
        for page_number, page in enumerate(reader.pages):
            page_text = page.extract_text() or ""
            if page_text.strip():
                documents.append(
                    Document(
                        page_content=page_text,
                        metadata={"source": str(pdf_path.resolve()), "page": page_number},
                    )
                )

    if not documents:
        print("No se encontró texto extraíble en los PDF. Los documentos escaneados requieren OCR.")
        return

    print(f"Se cargaron {len(documents)} páginas.")

    # Dividimos el texto en objetos Document de LangChain para la base vectorial
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200
    )
    docs = text_splitter.split_documents(documents)
    print(f"Se generaron {len(docs)} fragmentos con metadatos de origen.")
    
    print("Generando embeddings en lotes y guardando el índice local...")
    print("El tiempo depende del hardware y de la memoria disponible.")

    embeddings = OllamaEmbeddings(model="nomic-embed-text")
    vector_db_dir.mkdir(parents=True, exist_ok=True)
    collection_name = f"sri_documentos_{uuid4().hex[:12]}"
    vectorstore = None
    batch_size = 16

    try:
        vectorstore = Chroma(
            collection_name=collection_name,
            persist_directory=str(vector_db_dir),
            embedding_function=embeddings,
        )
        for start in range(0, len(docs), batch_size):
            batch = docs[start:start + batch_size]
            vectorstore.add_documents(batch)
            print(f"Indexados {min(start + len(batch), len(docs))} de {len(docs)} fragmentos.")

        active_collection_file = vector_db_dir / "active_collection.txt"
        temporary_marker = active_collection_file.with_suffix(".tmp")
        temporary_marker.write_text(collection_name, encoding="utf-8")
        temporary_marker.replace(active_collection_file)
    except Exception as error:
        if vectorstore is not None:
            try:
                vectorstore.delete_collection()
            except Exception:
                print("No se pudo limpiar la colección temporal incompleta.")
        raise RuntimeError(
            "No se completó la indexación. El índice anterior se conservó. "
            "Libera memoria RAM, verifica que Ollama esté activo y vuelve a intentarlo."
        ) from error

    print("Base vectorial del SRI creada y activada correctamente.")
    print(f"Colección: {collection_name}")
    print(f"Ubicación: {vector_db_dir}")

if __name__ == "__main__":
    vectorizar_documentos_sri()