from pathlib import Path

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader

def procesar_documentos_sri():
    # Obtener la ruta absoluta de la carpeta actual (scripts)
    current_dir = Path(__file__).resolve().parent
    
    # Rutas absolutas basadas en la estructura del proyecto
    raw_pdf_dir = current_dir.parent / "data" / "raw_pdf"
    processed_text_dir = current_dir.parent / "data" / "processed_text"

    # Verificar si la carpeta de PDFs existe y tiene archivos
    if not raw_pdf_dir.is_dir():
        print(f"La carpeta de documentos no existe: {raw_pdf_dir}")
        return

    print(f"Leyendo archivos PDF desde: {raw_pdf_dir}")

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
        print("No se encontró texto extraíble. Los documentos escaneados requieren OCR.")
        return

    print(f"Se cargaron {len(documents)} páginas con texto.")

    # 2. Dividir los documentos en fragmentos (chunks) manejables
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        length_function=len
    )
    
    chunks = text_splitter.split_documents(documents)
    print(f"Los documentos se dividieron en {len(chunks)} fragmentos.")

    # 3. Guardar el texto procesado en la carpeta processed_text
    processed_text_dir.mkdir(parents=True, exist_ok=True)
    output_file = processed_text_dir / "chunks_resumen.txt"
    
    with output_file.open("w", encoding="utf-8") as output:
        for index, chunk in enumerate(chunks, start=1):
            output.write(
                f"--- CHUNK {index} [Fuente: {chunk.metadata.get('source', 'Desconocida')}] ---\n"
            )
            output.write(chunk.page_content + "\n\n")

    print(f"Proceso completado. Fragmentos guardados en: {output_file}")

if __name__ == "__main__":
    procesar_documentos_sri()