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

2. En Cloudflare **Workers & Pages**, conecta el Worker `frontend` con `Ronald-Roldan/chatbotsri`, rama `main`, y configura `frontend` como directorio raíz. Usa `npm run build` como comando de compilación y `npx wrangler deploy --config wrangler.jsonc` como comando de implementación.
3. Cloudflare Workers Builds implementa automáticamente los cambios de `main`. GitHub Actions ejecuta por separado las pruebas, el lint y la compilación; no necesita secretos ni variables de Cloudflare.
4. No configures URL de API ni claves de IA. El Worker solo reenvía rutas permitidas de los archivos públicos del modelo y sirve el sitio.

El sitio y el corpus normativo serán públicos. Las preguntas se procesan en el navegador; el Worker reenvía solo los archivos del modelo permitidos desde Hugging Face y GitHub para evitar errores CORS. La primera carga del modelo descarga alrededor de 700 MB. La disponibilidad y cuotas del plan gratuito de alojamiento están sujetas a las condiciones de Cloudflare.

El despliegue también puede ejecutarse manualmente desde un equipo que ya tenga Wrangler autenticado: desde `frontend/`, ejecuta `npm ci`, `npm run build` y `npx wrangler deploy --config wrangler.jsonc`.

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

La recuperación combina coincidencia léxica ponderada y fragmentos identificados por página. Algunas consultas conocidas tienen respuestas determinísticas; las demás se redactan con el modelo local del navegador y se limitan a los fragmentos recuperados. Si WebGPU o el modelo no están disponibles, la consulta no se pierde: el asistente muestra los extractos recuperados con sus fuentes, sin inventar una respuesta generada. El requisito de estabilidad tributaria de más de USD 100 millones se identifica como texto del documento y se acompaña de una advertencia porque el propio corpus señala que ese capítulo fue derogado en 2019. La calidad depende de la legibilidad y vigencia de los PDF. Contrasta las respuestas con la publicación oficial antes de tomar decisiones legales.