# Asistente virtual documental del SRI

Aplicación web para consultar normativa del SRI. El modo web ejecuta la búsqueda y el modelo de lenguaje dentro del navegador: no necesita una API propia, Ollama, Gemini ni una clave de proveedor de IA.

## Modo web gratuito

### Requisitos

- Node.js 20.19 o superior.
- Navegador actualizado con WebGPU, por ejemplo Chrome o Edge en un equipo compatible.

### Probar localmente

Desde la carpeta raíz:

```powershell
cd frontend
npm ci
npm run dev
```

Abre la dirección local que indique Vite. La primera pregunta descarga el modelo WebLLM al navegador; la descarga puede ser grande y requiere conexión a Internet. El modelo se almacena en la caché del navegador y las consultas posteriores se procesan en el equipo. El rendimiento depende de la memoria y la GPU disponibles.

### Publicar gratis en Cloudflare Workers

1. Genera o actualiza el corpus estático desde los PDF:

   ```powershell
   py -3.12 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r backend\requirements.txt
   py scripts\export_web_corpus.py
   ```

2. Sube el contenido de `frontend/` a la raíz del repositorio GitHub conectado a Cloudflare. Incluye `worker.js` y `wrangler.jsonc`.
3. En la configuración de compilación del Worker, usa `npm run build` como comando de compilación y `npx wrangler deploy` como comando de despliegue.
4. El archivo `wrangler.jsonc` publica `dist` como assets y enruta `/model/*` al Worker para descargar el modelo con encabezados CORS. No cambies el directorio raíz del repositorio si este ya contiene directamente `package.json`.
5. No configures URL de API ni claves de IA. El Worker solo reenvía rutas permitidas de los archivos públicos del modelo y sirve el sitio.

El sitio y el corpus normativo serán públicos. Las preguntas se procesan en el navegador; el Worker reenvía solo los archivos del modelo permitidos desde Hugging Face y GitHub para evitar errores CORS. La primera carga del modelo descarga alrededor de 700 MB. La disponibilidad y cuotas del plan gratuito de alojamiento están sujetas a las condiciones de Cloudflare.

## Actualizar los documentos

Coloca los PDF en `data/raw_pdf/` y ejecuta `py scripts\export_web_corpus.py`. El script conserva el nombre del documento y la página PDF en cada fragmento, y escribe el corpus que usa el sitio en `frontend\public\documents.json`. Publica el archivo actualizado junto con la aplicación. Los PDF escaneados requieren OCR antes de incorporarlos.

## API local opcional

El backend Python y la base vectorial se conservan para ejecutar y experimentar con la versión local de la API. No son necesarios para el modo web ni para alojar el sitio estático.

Instala las dependencias, inicia Ollama con los modelos requeridos y genera el índice con `py scripts\vectorize_data.py`. Luego ejecuta:

```powershell
uvicorn backend.main:app --reload
```

La API queda disponible en `http://127.0.0.1:8000` y la documentación en `/docs`. El sitio actual no consume esta API.

## Precisión y privacidad

La recuperación combina coincidencia léxica ponderada y fragmentos identificados por página. Algunas consultas conocidas tienen respuestas determinísticas; las demás se redactan con el modelo local del navegador y se limitan a los fragmentos recuperados. La calidad depende de la legibilidad y vigencia de los PDF. Contrasta las respuestas con la publicación oficial antes de tomar decisiones legales.