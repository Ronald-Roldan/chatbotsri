# Asistente virtual documental del SRI

Prototipo académico para consultar documentos tributarios del Servicio de Rentas Internas (SRI) mediante recuperación documental y un modelo de lenguaje ejecutado localmente con Ollama.

## Requisitos

- Python 3.10 o superior.
- Node.js 20.19 o superior.
- Ollama instalado y en ejecución.
- Los documentos PDF que se consultarán, guardados en `data/raw_pdf/`.

Descarga los modelos utilizados por defecto:

```powershell
ollama pull phi3
ollama pull nomic-embed-text
```

## Instalación

Desde la carpeta raíz del proyecto, crea y activa un entorno virtual e instala las dependencias:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
```

Instala las dependencias del frontend:

```powershell
cd frontend
npm install
cd ..
```

## Incorporar documentos

Coloca los PDF en `data/raw_pdf/` y genera el índice vectorial:

```powershell
py scripts\vectorize_data.py
```

El indexador conserva el archivo y la página de origen de cada fragmento, y procesa los textos en lotes de 16 para limitar el uso de memoria. Construye una colección temporal y solo la activa cuando todos los fragmentos se guardan correctamente; si Ollama falla, conserva el índice anterior. Necesitas suficiente memoria libre para cargar `nomic-embed-text`. Los documentos escaneados requieren OCR antes de ser indexados.

## Ejecución

En una terminal, desde la raíz del proyecto, inicia la API:

```powershell
uvicorn backend.main:app --reload
```

En otra terminal inicia la interfaz:

```powershell
cd frontend
npm run dev
```

Vite muestra la dirección local de la interfaz. La API queda disponible en `http://127.0.0.1:8000` y su documentación interactiva en `/docs`.

## Configuración

La API permite configurar el modelo y los orígenes de frontend mediante variables de entorno:

- `SRI_LLM_MODEL`: modelo conversacional de Ollama; por defecto `phi3`.
- `SRI_EMBEDDING_MODEL`: modelo de embeddings; por defecto `nomic-embed-text`.
- `SRI_CORS_ORIGINS`: orígenes permitidos separados por comas; por defecto `http://localhost:5173,http://127.0.0.1:5173`.
- `VITE_API_URL`: URL base de la API cuando frontend y backend se despliegan en servidores distintos. En desarrollo Vite reenvía `/api` a `http://127.0.0.1:8000`.

## Alcance

Las respuestas se fundamentan en los documentos cargados e identifican las fuentes recuperadas. La calidad depende de que la normativa incorporada sea legible, pertinente y esté actualizada; el prototipo no sustituye la consulta de las publicaciones oficiales vigentes del SRI.