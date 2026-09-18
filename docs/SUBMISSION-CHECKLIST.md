# Checklist de submission — Field Service Voice Logger

Operativo para el humano. Actualizado: **2026-09-16**.

**Fecha límite: 30-sep-2026 15:00 UTC.** Regla de margen: entregar ≥24–48 h antes
→ **objetivo: submit completo el 28-sep-2026**, límite interno duro 29-sep 15:00 UTC.
Razón extra para no apurar: ventana de aprobación manual de la plataforma (~6 h,
documentada en `docs/video-recording-plan.md`) — jamás dejar el submit para el 30.

Referencias rápidas:

- Repo: https://github.com/el-informatico/field-service-voice-logger
- Live: https://field-service-voice-logger.vercel.app
- Video: `~/projects/field-service-voice-logger-deliverables/demo-video-d6.mp4`

## 1. Ya resuelto (REPO) — esto NO hay que hacerlo

| Qué | Evidencia / ruta | Owner |
|---|---|---|
| Video demo final, QA determinista 9/9 | `~/projects/field-service-voice-logger-deliverables/demo-video-d6.mp4` — **3:00** (180.3 s), 1080p30 H264+AAC, **31 MB**, captions EN quemadas (iteración-1 2026-09-17 sobre el re-render del 09-16: narración acorde a pantalla en r2, banda de captions más fina, zoom lento en escenas largas; iteración-2 2026-09-17: badge DETERMINISTIC REPLAY movido bajo el header (dejaba de tapar el indicador mock); iteración-3 2026-09-17: intro re-estilizada como apertura oscura (reloj 7:00 PM, tarjetas de dolor compactas) — interés de hook 3→7 según auditoría de visión; duración/cues idénticos, QA 9/9 re-pasada (carril 9 ahora también detecta tinta de captions sobre fondos oscuros); anteriores 193.0 s → `demo-video-d6-prev.mp4`, 178.1 s → `demo-video-d6-prev2.mp4`, 180.2 s → `demo-video-d6-prev-N1.mp4`). Subtítulos: `demo-video-d6.srt` (56 cues) | REPO-YA |
| Tabla N=10 en README (LOCAL) | Commits `75b8334` + `e68afed` (METRICS-N10). **OJO: aún NO pusheados** → ítem 3 del checklist. El repo público hoy muestra la tabla N=5 vieja | REPO-YA |
| Deploy live verificado | curl 2026-09-16: `/` → **HTTP 200** (0.54 s); `/api/token` → **HTTP 200** con `"mode":"mock"` (esperado: el server no lleva key; el modo real se activa con key en `.env`) | REPO-YA |
| Re-auditoría de galería pre-video | Hecha antes de grabar la línea de diferenciación (ver STATUS, bloque D6): wedge intacto | REPO-YA |
| Guion + plan + setup de grabación | `docs/video-script-en.md` · `docs/video-recording-plan.md` · `docs/video-demo-setup.md` · `scripts/demo-video.sh` | REPO-YA |
| Portadas candidatas (3 PNG 1920x1080) | `~/projects/field-service-voice-logger-deliverables/cover-a.png` (frame **01:52**, escena de métricas **N=10** — re-extraída del re-render) · `cover-b.png` (frame **01:06**, read-back PROD/STG) · `cover-c.png` (frame **00:05**, apertura). Elección = ítem 7 | REPO-AGREGADO-HOY |
| Textos base del submit | `docs/SUBMISSION.md` — completo: 7 secciones (ver §3), tabla N=10 verificada contra README | REPO-YA |
| Guía de revisión del video + protocolo de regeneración | `docs/VIDEO-REVIEW-GUIDE.md` (12 beats, check-off de 15 valores, DECISIÓN #1 N=5/N=10) · `docs/VIDEO-REGEN-PROTOCOL.md` (7 casos: determinista / re-grabar / humano) | REPO-YA |
| Auditoría pre-publicación | `docs/AUDIT-SUBMISSION-2026-09-16.md` — veredicto **PUSH-SAFE**; único blocker (mensaje del commit D6-video) ya reword-eado sin tocar contenido | REPO-YA |
| Hooks de commit activos | Triple gate de `CONTRIBUTING.md` (sin atribución de herramientas en mensajes; sin paths del host ni proyectos hermanos en líneas añadidas). Regla: nunca `git commit --no-verify` | REPO-YA |

## 2. Checklist del submit (orden de ejecución)

| # | Tarea | Owner | Momento | Estado | Cómo / ruta |
|---|---|---|---|---|---|
| 1 | Revisión humana del video (~10 min): audio, captions, cifras en pantalla, sin datos sensibles | HUMANO | Cuanto antes (hoy 16-sep) | PENDIENTE | Guía: `docs/VIDEO-REVIEW-GUIDE.md` (si aún no existe, revisar contra `docs/video-script-en.md` beat a beat). Archivo: `~/projects/field-service-voice-logger-deliverables/demo-video-d6.mp4` |
| 2 | Commit de los docs del submit | REPO-YA (2026-09-16) | Hecho | **HECHO** | Commits lógicos en `main` (ver bitácora de STATUS): SUBMISSION + CHECKLIST, guías de video, auditoría + fixes, bloque readiness. Si editás un doc después: `cd ~/projects/field-service-voice-logger && git add docs/ && git commit` — los hooks corren solos; no usar `--no-verify` |
| 3 | **Push del repo — CRÍTICO**: sin push, el link del submit muestra la tabla N=5 (METRICS-N10 vive en commits locales) | HUMANO (regla del proyecto: NINGÚN push sin "YES" explícito tuyo) | Antes de pegar cualquier link | PENDIENTE | `git push origin main` — publica METRICS-N10 (README N=10, prompt v4, guion i4) + el pack de submit. Auditorías hechas: pre-push D5 (STATUS) y pre-submission (`docs/AUDIT-SUBMISSION-2026-09-16.md`, PUSH-SAFE; el mensaje del commit D6-video ya fue reword-eado sin tocar contenido). Verificar antes: `git status -sb` |
| 4 | Verificación post-push en GitHub | HUMANO | 5 min tras el push | PENDIENTE | README §Metrics dice "10 REAL voice sessions" con la tabla N=10 (refrescar sin caché); CI verde: pestaña Actions, job `selftest` (`npm run selftest` + `npm run smoke:mock`); `git status -sb` → "up to date" |
| 5 | Verificación Vercel tras el push | HUMANO | Tras el ítem 4 | PENDIENTE | Integración Git → redeploy automático esperado. Verificar: `curl -s -o /dev/null -w "%{http_code}\n" https://field-service-voice-logger.vercel.app/` → 200, y `curl -s https://field-service-voice-logger.vercel.app/api/token` → 200 + `"mode":"mock"`. Si no redeploya o falla: dashboard Vercel → Deployments → Redeploy / logs |
| 6 | Hosting del video: subir a YouTube unlisted (o Streamable) y subir el SRT como subtítulos; probar EN EL TELÉFONO antes de pegar el link | HUMANO | Cuanto antes (bloquea el submit) | PENDIENTE | `~/projects/field-service-voice-logger-deliverables/demo-video-d6.mp4` + `demo-video-d6.srt`. Si la plataforma pide archivo directo: el mp4 (31 MB) cumple de sobra |
| 7 | Elegir portada/thumbnail (1 min) | HUMANO | Junto al ítem 6 | PENDIENTE | `cover-a.png` (tabla de métricas) / `cover-b.png` (momento read-back, el diferencial) / `cover-c.png` (apertura). Mismas rutas de entregables |
| 8 | Rellenar los textos del formulario copiando de `docs/SUBMISSION.md` (mapeo en §3) | HUMANO (fuente: REPO) | Día del submit (o antes) | LISTO PARA COPIAR | `~/projects/field-service-voice-logger/docs/SUBMISSION.md` (7 secciones, tabla N=10 verificada contra README) |
| 9 | Metadatos de equipo/perfil en la plataforma (foto, bio, miembros del equipo) | HUMANO | Día del submit (o antes) | PENDIENTE | Perfil de la plataforma; usar el mismo nombre/avatar que firma el repo |
| 10 | **SUBMIT** | HUMANO | Objetivo 28-sep; duro 29-sep 15:00 UTC | PENDIENTE | Revisar el preview completo antes de confirmar; capturar el URL público de la submission |
| 11 | Verificación post-submit en ventana incógnita | HUMANO | Inmediatamente tras el submit | PENDIENTE | Sin sesión abierta: link del repo carga con la tabla N=10 renderizada; video embebido/reproducible; live demo responde 200; cero links rotos. Si algo falla → §4 |

## 3. Mapeo campo-plataforma → secciones de `docs/SUBMISSION.md`

| Campo del formulario | Sección fuente en `docs/SUBMISSION.md` |
|---|---|
| Nombre / título del proyecto | `## Submission metadata` |
| Descripción corta / pitch de una línea | `## Short description` |
| Descripción completa ("tell us about your project") | `## Full description` — subsecciones en este orden interno: The problem / What it does / How we built it / Honest rig & framing / Challenges / Accomplishments / What's next (pegar cada bloque donde el formulario lo pida) |
| Resultados / evidencia | `## Metrics (N=10 real sessions)` |
| Tecnologías | `## Built with` |
| Links (repo, demo live, video) | `## Links` |
| Dónde vive cada campo en la plataforma | `## Platform mapping` |

Nota: los rótulos exactos de los campos se confirman al abrir el formulario de
submit (POR VERIFICAR); este mapeo es el plano de copiado, no una promesa de
nombres de campo.

## 4. Plan B (contingencias)

1. **La plataforma rechaza el video** (formato/peso): el camino primario ya es un
   link (YouTube unlisted / Streamable); el archivo directo `demo-video-d6.mp4`
   (31 MB) es el fallback si pide upload. Último recurso, solo si exigiera menos
   peso:
   `ffmpeg -i demo-video-d6.mp4 -c:v libx264 -crf 28 -preset slow -c:a aac -b:a 96k demo-video-d6-small.mp4`
   — las captions están quemadas en el cuadro, sobreviven cualquier re-encode;
   verificar duración 3:00 y audio audible antes de subir.
2. **El deploy cae**: el repo corre local — `cp .env.example .env` (opcional; sin
   key = modo mock determinista), `npm run dev` → http://localhost:3000 (en WSL2,
   si 127.0.0.1 cuelga usar `[::1]`); demo guiada de un comando:
   `bash scripts/demo-video.sh` (puerto 3199). El video queda como demo permanente
   del submit mientras se repara Vercel (dashboard → Deployments → logs) y se
   re-verifica con curl (ítem 5).
3. **La tabla N=10 no aparece en GitHub tras el push**: `git status -sb` (¿"up to
   date"?), abrir el README crudo sin caché; confirmar que el push fue a `main`.
4. **CI rojo tras el push**: reproducir local `npm run selftest && npm run
   smoke:mock` antes de tocar nada; no pushear fixes sin diagnóstico.

## 5. Reglas que no se rompen

- Ningún push sin "YES" explícito del usuario (regla del proyecto).
- Nunca `git commit --no-verify` (los hooks son tripwire, no trámite).
- Sin paths absolutos del host ni identificadores de proyectos hermanos en
  contenido del repo — los hooks los bloquean en líneas añadidas; en docs se
  escribe con `~/` (este archivo lo hace a propósito).
