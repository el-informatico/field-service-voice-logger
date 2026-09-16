# Video research 2026-09 — cómo mejorar el pipeline probado para el video D6

Investigación 2026-09-15/16 vía 4 subagentes en paralelo (MCP ddg-search +
fetch; tavily no montado en esta sesión — fallback de la política). Anclada en
el pipeline v7 probado (skill `demo-video-automation` + artefactos locales del
workspace, fuera del repo): 7 iteraciones, 10 lanes deterministas de
verificación, takes con aserciones que atraparon cada fallo antes de subir, y
QA visual con GLM-Flash sobre frames data-URI cuyas categorías de crítica
(captions cortados, espacio muerto, frames estáticos >20 s) fueron las que
efectivamente drove las correcciones.

## Mantener (probado, no tocar)

1. Las **lanes deterministas** bajo el QA visual (word-count SRT vs narración,
   ffprobe de duraciones, decode/blank-frame, aserciones por take) — la
   evidencia 2026 dice explícitamente: determinista primero, VLM solo para el
   residuo semántico.
2. Takes con aserciones (4 gate-takes v7, cada fallo atrapado antes del render).
3. Ensamblado ffmpeg xfade + acrossfade + SRT quemado con chequeo de palabras.

## Q1 — Voz (el upgrade real; hoy edge-tts AndrewNeural, gratis)

| Opción | $/1k chars | Free tier | TTFB | Naturalidad |
|---|---|---|---|---|
| ElevenLabs Flash v2.5 | ~$0.0125 | 10k cr/mes (≈20k chars con Flash) pero con atribución | ~75-135 ms | gold standard |
| OpenAI gpt-4o-mini-tts | ~$0.015/min | $5 crédito nuevo usuario | ~240 ms | mejor OpenAI, prosodia dirigible |
| Cartesia Sonic-3/3.6 | ~$0.02-0.05 | **20k créditos/mes ≈ 27 min, SIN atribución** | ~85 ms | cercana a ElevenLabs |
| Kokoro-82M / Piper / F5-TTS (local) | $0 | ilimitado | RT (CPU) / <100 ms | Kokoro Piper; F5 para clonación |

Fuentes: voiceaibench.com · docs.cartesia.ai/pricing · elevenlabs.io/blog/meet-flash ·
costgoat.com/pricing/openai-tts · huggingface.co/rhasspy/piper-voices (es_MX).

**Veredicto D6**: narración EN → **Cartesia Sonic free tier** (salto de calidad
sobre edge-tts, sin costo ni atribución, mp3/wav directo). Fallback edge-tts.
Audio es-MX de DEV (guiones) sigue con edge-tts (ToS gris — nunca en el video).
Costo total: $0. Riesgo: rate-limit del free tier (mitigar: generar N de golpe,
cache por segmento).

## Q2 — Prompts de QA visual con modelos vision (GLM-Flash y familia)

1. **Sin CoT en checks simples**: veredicto-primero, salidas cortas;
   `thinking` deshabilitado para checks rápidos (docs.z.ai/guides/vlm/glm-4.5v;
   arxiv.org/abs/2601.04442; openreview.net/forum?id=rpbzBXdo4x). Excepción:
   dos pasos ESTRUCTURADOS (observar→verificar) reduce error (arxiv 2507.11662).
2. **Schema forzado `{pass, reason}`** mejor que multiple-choice (sesgo de
   posición/letra documentado: arxiv 2410.14248, 2306.05685; promptfoo judge guide).
3. **Un criterio por llamada** (readability / caption-cortado / blank frame por
   separado) — promptfoo.com/docs/guides/llm-as-a-judge.
4. **Cortar la región a testear** (banda de caption como imagen aparte): los
   VLM fallan en juicios de elementos pequeños y aciertan ~100% con targets
   separados/ampliados (arxiv 2407.06581); resolución: parches de 28 px, no
   mandar <200 px.
5. **Contra el yes-bias** (documentado en VLMs, empeora con system prompts
   pesados: arxiv 2601.12430): fraseo neutral ("¿el caption está completo o
   cortado?"), system prompt mínimo, calibrar con frames etiquetados antes de
   usar como gate de CI.
6. Plantillas existentes para copiar-adaptar: markaicode.com/usecases/vision-model-qa-ui-testing ·
   getstream.io/blog/gpt-4o-vision-guide · github.com/zai-org/GLM-V.

## Q3 — Tools 2026 vs pipeline DIY

Nada reemplaza el DIY bajo estos constraints (WSL2 headless, app real local,
captions, $0): Screen Studio = macOS GUI sin CLI real; Arcade/Guidde/Supademo =
SaaS hosted por asiento; screencli (2026) = lo más cercano pero sin
voz/captions; Remotion = renderer no recorder (licencia muerde a >3 personas /
$100/mes mínimo en automatización); Stagehand = driver sin pipeline de video.
**Veredicto**: mantener DIY + adoptar **Playwright 1.59 Screencast API**
(capsítulos/overlays quemados → timestamps exactos para sincronizar
TTS+SRT+xfade programáticamente; playwright.dev/docs/videos) + opcional
`screenstudio-alt` (CLI) para auto-zoom en clicks. Fuentes: remotion.dev/docs/license/pricing ·
hub.screen.studio/p/more-automation-and-agent-friendly · github.com/usefulagents/screencli.

## Q4 — Modelos Z.AI disponibles con la key de esta sesión

Endpoint Anthropic-protocol (`api.z.ai/api/anthropic`); mismos IDs vía paas/v4.
Modelos: `glm-4.5, glm-4.5-air, glm-4.6, glm-4.7, glm-5, glm-5-turbo, glm-5.1,
glm-5.2, glm-5.3, glm-5.3-flash`. **Solo `glm-5.3-flash` es vision** (multimodal
nativo, ya configurado como AUXILIARY_VISION_MODEL); glm-5.3 flagship es
solo-texto. **No hay TTS/audio ni embeddings en esta key** (GLM-TTS existe solo
como self-host Apache-2.0: github.com/zai-org/GLM-TTS) → la voz viene de Q1.
Fuentes: docs.z.ai/guides/llm/glm-5.3 · docs.z.ai/guides/vlm/glm-5.3-flash.

## VEREDICTO ACCIONABLE para el pipeline D6

| # | Cambio | Costo | Riesgo |
|---|---|---|---|
| 1 | Voz EN → Cartesia Sonic free (fallback edge-tts Andrew) | $0 | rate-limit; mitigar cache/por-segmento |
| 2 | QA de frames → glm-5.3-flash con: schema {pass,reason}, un criterio/llamada, CROP de la banda de caption, fraseo neutral anti-yes-bias, thinking off | $0 (key ya pagada) | yes-bias residual → calibrar con frames etiquetados antes de gatear CI |
| 3 | Captura → añadir capítulos/overlays del Screencast API de Playwright 1.59 como timestamps canónicos | $0 | API nueva (abr-2026); fallback: durations.json como hoy |
| 4 | NO cambiar: lanes deterministas, takes con aserciones, ffmpeg xfade/acrossfade+SRT | — | — |
| 5 | Audio es-MX de guiones: edge-tts solo DEV (ToS gris); nunca en el video | $0 | reputacional si se publica — regla ya documentada |

Regla de oro que sobrevive todo: el VLM jamás reemplaza las lanes
deterministas — las cubre solo en el residuo semántico.
