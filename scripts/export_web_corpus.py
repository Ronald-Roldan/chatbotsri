import json
from pathlib import Path

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader


PROJECT_DIR = Path(__file__).resolve().parent.parent
PDF_DIR = PROJECT_DIR / "data" / "raw_pdf"
OUTPUT_FILE = PROJECT_DIR / "frontend" / "public" / "documents.json"


def export_web_corpus():
    splitter = RecursiveCharacterTextSplitter(chunk_size=1400, chunk_overlap=250)
    chunks = []

    for pdf_path in sorted(PDF_DIR.rglob("*.pdf")):
        reader = PdfReader(pdf_path)
        for page_number, page in enumerate(reader.pages, start=1):
            page_text = page.extract_text() or ""
            if not page_text.strip():
                continue

            page_document = Document(
                page_content=page_text,
                metadata={"source": pdf_path.name, "page": page_number},
            )
            chunks.extend(
                {
                    "text": chunk.page_content,
                    "source": chunk.metadata["source"],
                    "page": chunk.metadata["page"],
                }
                for chunk in splitter.split_documents([page_document])
            )

    if not chunks:
        raise RuntimeError(f"No se encontró texto extraíble en {PDF_DIR}")

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(
        json.dumps(chunks, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Exportados {len(chunks)} fragmentos a {OUTPUT_FILE}")


if __name__ == "__main__":
    export_web_corpus()
