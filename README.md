# Asistente virtual documental del SRI

Aplicación web para consultar normativa del SRI. La búsqueda documental y la generación de respuestas se ejecutan en Cloudflare: el navegador no descarga ni ejecuta modelos y no necesita GPU.

## Modo web en línea

### Requisitos

- Node.js 20.19 o superior.
- Un navegador actualizado y conexión a Internet.

### Probar localmente

Desde la carpeta raíz:

```powershell
cd frontend
npm ci
npm run dev
```

Para probar la aplicación completa localmente, compila los recursos y ejecuta el Worker con Wrangler:

```powershell
npm ci
npm run build
npx wrangler@4 dev --config wrangler.jsonc
```

Wrangler debe estar autenticado con la cuenta de Cloudflare que contiene el binding de Workers AI. Las llamadas al modelo desde el entorno local también consumen la cuota de esa cuenta.

### Publicar gratis en Cloudflare Workers

1. Genera o actualiza el corpus estático desde los PDF:

   ```powershell
   py -3.12 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r backend\requirements.txt
   py scripts\export_web_corpus.py
   ```

2. En Cloudflare **Workers & Pages**, conecta el Worker `frontend` con `Ronald-Roldan/chatbotsri`, rama `main`, y configura `frontend` como directorio raíz. Usa `npm run build` como comando de compilación y `npx wrangler deploy --config wrangler.jsonc` como comando de implementación. La configuración crea el binding `AI` de Workers AI.
3. Cloudflare Workers Builds implementa automáticamente los cambios de `main`. GitHub Actions ejecuta por separado las pruebas, el lint y la compilación; no necesita secretos ni variables de Cloudflare.
4. No configures claves de IA ni GPU en el navegador. El Worker carga el corpus, recupera los fragmentos pertinentes y llama al modelo `@cf/meta/llama-3.2-1b-instruct` alojado por Cloudflare.

El sitio y el corpus normativo son públicos. Las preguntas y los fragmentos consultados se envían al Worker de Cloudflare para la inferencia. Workers AI incluye actualmente 10.000 Neurons gratuitos por día por cuenta; al alcanzar el límite diario, la aplicación presenta extractos documentales con sus fuentes en lugar de depender del modelo. Consulta los [precios y límites vigentes de Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/).

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

La recuperación combina coincidencia léxica ponderada y fragmentos identificados por página. Algunas consultas conocidas tienen respuestas determinísticas; las demás se redactan en Cloudflare AI y se limitan a los fragmentos recuperados. Si el modelo en la nube no está disponible o se agota la cuota gratuita, el asistente muestra el extracto documental más pertinente con su fuente, sin inventar una respuesta generada. El requisito de estabilidad tributaria de más de USD 100 millones se identifica como texto del documento y se acompaña de una advertencia porque el propio corpus señala que ese capítulo fue derogado en 2019. La calidad depende de la legibilidad y vigencia de los PDF. Contrasta las respuestas con la publicación oficial antes de tomar decisiones legales.