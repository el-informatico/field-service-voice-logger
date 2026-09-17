# Guía de revisión — demo video D6 (≤10 minutos)

**Video:** `demo-video-d6.mp4` — 193.0 s (3:13) · 1920×1080 @30 fps · H264+AAC ·
captions EN quemadas · loudness −14 LUFS (−14.1 medido) · 12 segmentos =
4 escenas estáticas + 8 cortes del take de la app.

**Dónde está:** `~/projects/field-service-voice-logger-deliverables/demo-video-d6.mp4`
(+ `demo-video-d6.srt`, 47 cues / 377 palabras — byte-idéntico al quemado en el video).

**Fuente de verdad de los timestamps:** el `.srt` entregable y `build/segments.json`
del workspace de edición (directorio hermano `video-d6-work`, fuera del repo).
Los cortes entre segmentos son fundidos de 0.4 s: los límites de la tabla tienen
±1 s de tolerancia.

---

## DECISIÓN #1 — leer ANTES de prender el video: el video cita la tabla N=5; el README publica N=10

- El video se renderizó **antes** del bloque METRICS-N10 (STATUS.md). Su narración
  y su escena de métricas muestran la tabla **N=5** vigente en ese momento — la QA
  determinista (lane `metrics-verbatim`) la validó verbatim contra el README de
  esa hora. Hoy `README.md` §Metrics y `docs/SUBMISSION.md` publican la tabla
  **N=10** (10 sesiones reales, fix narrativo prompt v4 incluido).
- **Consecuencia:** los jueces verían números del video (N=5) ≠ tabla del
  repo/submission (N=10). `docs/SUBMISSION.md` ya lo declara: *"The narration was
  recorded against the earlier five-session table; the N=10 numbers below are the
  superset — same rig, five more sessions, matched-pair WER unchanged at 0.231."*
- **Opciones:**
  - **(a) Aceptar la discrepancia** — video honesto pero con la tabla anterior;
    la divergencia ya está declarada en SUBMISSION.
  - **(b) Regenerar escena de métricas + narración** — determinista, $0, minutos:
    ver **docs/VIDEO-REGEN-PROTOCOL.md § "Actualizar la escena de métricas a
    N=10"** (caso más probable de regeneración).
- **Alcance exacto del problema:** SOLO el beat `m-metrics` (1:51–2:16), cues
  25–31 del SRT. Los otros 11 beats no tocan cifras.
- **Frases afectadas de la narración quemada** (citas exactas del SRT):
  - cue 25–26 (1:51–1:58): *"We measured this instead of promising it. Five real
    voice sessions against the live AssemblyAI API."* → README dice 10 sesiones.
  - cue 29 (2:05–2:09): *"Tool calls at about one point eight seconds median."*
    → README actual: p50 1,554 ms (≈1.6 s).
  - cue 30 (2:09–2:12): *"honestly, two of five sessions collapsed. Failures
    included, published in the README."* → en N=10 el colapso narrativo v3 está
    corregido; la nota honesta actual es otra (2/10 sesiones truncadas por
    watchdog).
- **Frases que SÍ siguen siendo ciertas en N=10:** cue 27 *"zero point two three
  one"* (WER 0.231) y cue 28 *"one hundred percent"* (precisión de servicios).

---

## Protocolo de revisión (2 pasadas + check-off, ~10 min)

1. **Pasada 1 — velocidad 1x (3:13):** mirar la **ficha de la app** (timeline,
   chips de servicios, severidad, banners de read-back) y las **captions**
   (legibles, abajo, sin pisar contenido).
2. **Pasada 2 — velocidad 1.5x (~2:05):** **escuchar** el audio (VO completa, sin
   cortes) y vigilar las **luces**: banners de confirmación, chips que giran a ✓,
   fundidos entre beats, frames negros.
3. **Check-off:** tabla minuto-a-minuto + los 15 valores de la escena de métricas
   + DECISIÓN #1.

---

## Tabla minuto-a-minuto (12 beats)

| Rango · beat (cues) | Qué hay en pantalla | Qué escuchar (citas = SRT) | Qué verificar — PASS si… |
|---|---|---|---|
| **0:00–0:18** · `s1-pain` (cues 1–5) | Escena estática: título *"The incident closed hours ago. The report still isn't written."*, 3 tarjetas (Paper notes / Retype the evening / No evidence trail), pie *"Voice Incident Reporter — AssemblyAI Voice Agent Hackathon 2026"* | *"It's seven PM. The incident closed hours ago, but the report still isn't written. … Paper notes, details gone by Friday, and no evidence trail anyone can audit."* (0:00–0:14) | Caption legible en la banda inferior sin pisar las tarjetas; lo narrado refleja las 3 tarjetas. |
| **0:18–0:26** · `r1-setup` (cues 6–8) | App real: dashboard → incidente IC-2001 → consentimiento → sesión inicia. Badge **"modo mock"** + label quemado **"DETERMINISTIC REPLAY — scripted session (mock channel)"** (sup-der) | *"Voice Incident Reporter. After the visit, the technician opens the incident and starts a voice session. Consent comes before the microphone."* | Label DETERMINISTIC REPLAY presente; badge "modo mock" visible; la pantalla de consentimiento coincide con *"Consent comes before the microphone."* |
| **0:26–0:52** · `r2-start` (cues 9–11) | Sesión corriendo en auto-replay: transcript y ficha se llenan solos | *"He just talks. The agent transcribes, and the incident form builds itself. Every field with its own audit trail."* (0:26–0:34); **0:34–0:52 silencio por diseño** (mock no produce audio de sesión) | La ficha/timeline se llena sola durante el silencio. El silencio NO es fallo. |
| **0:52–1:00** · `r3-timeline` (cues 12–13) | Banner de read-back de hora *"¿Confirmo el evento a las 05:40?"* → confirmación → fila de timeline con timestamp | *"Times are confirmed out loud. Monitoring detected the outage at five forty? Yes. Locked, with a timestamp."* | Banner legible; la hora en pantalla (**05:40**) es la misma que la narrada (*"five forty"*). |
| **1:00–1:17** · `r4-prodstg` (cues 14–18) — **MOMENTO CLAVE** | La captura oye *staging* → read-back nombrando **ambos** servicios del catálogo → corrección a producción; chip ✓ | *"The technician said production. The capture heard staging. The agent reads it back, naming both catalog services. The technician corrects it. The wrong service never reaches the report. A seeded capture error, rescued by voice."* | La pregunta de read-back se lee; el servicio final en la ficha es **producción** (no staging); label DETERMINISTIC REPLAY presente. |
| **1:17–1:23** · `r5-pagos` (cue 19) | Confirmación de la API de pagos (mismo mecanismo de read-back) | *"The payments API confirms the same way."* | La confirmación se alcanza a ver aunque el beat es corto (~6 s). |
| **1:23–1:42** · `r6-severity` (cues 20–22) | Severidad entra como **MEDIA** → read-back → corrección a **ALTA** | *"Severity comes in as medium, and the agent reads it back anyway. Three hours down in sales hours? High. Second seeded error, second rescue by spoken confirmation."* (1:23–1:33); 1:33–1:42 silencio con la corrección en pantalla | El chip de severidad termina en **ALTA** al cierre del beat. |
| **1:42–1:51** · `r7-ficha` (cues 23–24) | End screen: ficha completa IC-2001 — producción, API de pagos, alta, horas 05:40/07:30/08:45, action items | *"Session over. The form is complete. Timeline, services, severity, action items. Every field showing where it came from."* | Los campos citados se ven; el zoom de ficha es legible. |
| **1:51–2:16** · `m-metrics` (cues 25–31) — **ver DECISIÓN #1** | Tabla *"Real sessions, published numbers"* con kicker *"Measured, not promised · N=5 · failures included"* + nota honesta | *"We measured this instead of promising it. Five real voice sessions … zero point two three one. … one hundred percent … one point eight seconds median. … two of five sessions collapsed. Failures included, published in the README."* | Los 15 valores del check-off (abajo) se leen; la caption no pisa la última fila de la tabla. |
| **2:16–2:34** · `e-exports` (cues 32–37) | CSV descargado → PDF print-view → FSM ack (toast) | *"The report leaves the session as evidence. CSV for the ticket system. A print-ready PDF whose audit footer states the audio was never retained. … the field-service connector accepts it with an ack. Text only, no audio, by design."* | Se ven: descarga CSV, vista de impresión, ack `FSM-…`. **Aquí NO hay label DETERMINISTIC REPLAY por diseño** — no flaggear. |
| **2:34–3:00** · `a-arch` (cues 38–44) | Diagrama: navegador ⇄ WebSocket `wss://agents.assemblyai.com/v1/ws` (chips STT/LLM/TTS/VAD), tools JSON-Schema con enums de catálogo, token de un solo uso, audio never persisted, zero npm deps, CI | *"Under the hood, one managed WebSocket … Tools are JSON-Schema functions with catalog enums … zero npm dependencies, and the pipeline is proven in CI."* | La URL del WebSocket es legible; lo narrado corresponde a las cajas del diagrama; caption no pisa el pie del diagrama. |
| **3:00–3:13** · `c-close` (cues 45–47) | End card: *"Voice in. Evidence out."* + repo `github.com/el-informatico/field-service-voice-logger` + `npm run smoke:mock` | *"Voice in. Evidence out. … It's open source. One command runs the whole demo. Link below."* | URL del repo exacta; al oírse *"Link below"* el link está visible en pantalla. |

---

## Check-off visual — los 15 valores de la escena de métricas (1:51–2:16)

Valores **tal como aparecen en pantalla** (tabla N=5 del build; fueron validados
verbatim por la QA determinista contra la escena fuente). Columna derecha: estado
frente al README §Metrics actual (N=10) — ver DECISIÓN #1.

| # | Valor en pantalla (build N=5) | README actual (N=10) | ¿Difiere? |
|---|---|---|---|
| 1 | `0.231` (WER, matched pairs) | `0.231` | No |
| 2 | `0.164` (rango inferior/session) | `0.164` | No |
| 3 | `0.382` (rango superior/session) | `0.382` | No |
| 4 | `8–10 of 10–11` (turn completion) | `7–10 of 9–11` | **Sí** |
| 5 | `1,775` ms (EOS→tool p50) | `1,554` | **Sí** |
| 6 | `6,192` ms (EOS→tool p95) | `4,810` | **Sí** |
| 7 | `100% (3 TP / 0 FP)` (precisión servicios) | `100% (12 TP / 0 FP)` | **Sí** (TP) |
| 8 | `37.5% (5 FN)` (recall servicios) | `70.6% (5 FN)` | **Sí** |
| 9 | `61.5%` (precisión del loop de confirmación) | `62.1%` | **Sí** |
| 10 | `3/3` (timeline en engaged sessions) | `19/35 (54.3%)` | **Sí** |
| 11 | `2/5` (severidad exacta) | `6/10` | **Sí** |
| 12 | `1,081` (ref words) | `2,134` | **Sí** |
| 13 | `13 read-backs` | `29 read-backs` | **Sí** |
| 14 | `23 tool turns` | `53 tool turns` | **Sí** |
| 15 | `5 sessions` | `10 sessions` | **Sí** |

También difieren (mismo beat): el kicker `N=5 · failures included` y la nota
honesta *"2 of 5 sessions (pure-narrative script) collapsed to 1 tool call…"*
(en el README actual esa historia es la mitad v3 de la comparativa).

---

## Qué dice el video sobre el fix narrativo (prompt v4)

**No lo dice.** El video se renderizó antes de METRICS-N10: la narración quemada
no menciona el prompt ni el fix narrativo en ningún cue. Lo más cercano es la
nota honesta del beat de métricas — cue 30 (2:09–2:12): *"honestly, two of five
sessions collapsed. Failures included, published in the README."* — que describe
el estado v3 (el colapso del guion narrativo, 2/5 sesiones). La historia del
fix (prompt v4: colapso corregido, 10–15 tool calls, 7/8 horas) vive hoy en
`README.md` §Metrics, `STATUS.md` (bloque METRICS-N10) y `docs/SUBMISSION.md`.
Si se quiere que el video la cuente, es parte del caso "actualizar a N=10" del
protocolo de regeneración.

---

## Residuos conocidos y ACEPTADOS (no re-flaggear)

Hallazgos del QA visual asistido residual ya analizados contra evidencia
determinista = **0 defectos accionables** (gate = 9/9 lanes deterministas):

1. **cap-r4 (≈1:07)** — la cue 15 termina *"The agent reads"* y la cue 16 arranca
   *"it back, naming both catalog services."* Límite natural entre cues
   encadenadas (~9 palabras por cue); empezar mid-clause es práctica estándar de
   subtitulado. Recorte físico imposible: márgenes laterales 120 px + padding 8,
   caja medida completa.
2. **cap-m (≈2:04)** — cue 28 *"…no / wrong entries. Tool"* → cue 29 *"calls at
   about one point eight seconds"*. Mismo caso: continuación exacta en la cue
   siguiente. No es texto cortado.
3. **r4-readback (1:04–1:14)** — la pregunta de read-back aparece con el styling
   real de la app (botón amarillo *"¡Espera!"* + pregunta en gris), no como un
   banner ámbar sólido: el check de QA sobre-especificaba el color. El criterio
   real — **pregunta de read-back legible** — se cumple; los eventos de banner
   pasaron en las assertions del take (14/14).
4. **e-pdf (2:19–2:26)** — el footer de auditoría del print sheet queda bajo el
   pliegue de la vista de impresión: comportamiento real de la app, no defecto de
   encode. La página es legible y el PDF exportado es un archivo real descargado
   durante el take.
5. **Drift del reloj del recorder — ya corregido en build:** el reloj de eventos
   acumuló drift (+1.4…+6.3 s tras t≈46 s, saltos de reloj WSL2); los cortes de
   `r7`/`e-exports` se re-anclaron a tiempos reales de video (SSIM contra
   keyframes). No es visible en el final y no requiere revisión.
6. **Silencios por diseño:** el modo mock no produce audio de sesión. Ventanas
   mudas mientras la app trabaja: 0:34–0:52, 1:20–1:23, 1:33–1:42 (y colas de
   ~2 s en m/a/c). No es audio cortado.

---

## Señales que SÍ requieren acción

- **Audio cortado:** la VO se trunca a mitad de frase (la última palabra de un
  beat no cierra, o el corte llega antes del final de la palabra).
- **Caption sobre contenido:** la caja del caption sube por encima de y≈930
  (pisando la tabla de métricas, la ficha o el diagrama). Umbral de diseño:
  nada sobre y930.
- **Número en pantalla ≠ valor esperado** de esta guía (fuera del estado N=5 ya
  cubierto por la DECISIÓN #1 — ese caso no es defecto de encode).
- **Label "DETERMINISTIC REPLAY — scripted session (mock channel)" ausente en
  los beats de roleplay r1–r7** (esquina superior derecha). Su ausencia en
  `e-exports` (2:16) SÍ es por diseño — no flaggear ahí.
- **Desync audio-video:** la narración describe otra escena de la que se ve
  (p. ej. se oye *"CSV for the ticket system"* mientras aún está la ficha).
- **Frames negros o congelamiento** >0.5 s en cualquier punto (decode roto).

---

## Si algo falla

→ **[docs/VIDEO-REGEN-PROTOCOL.md](VIDEO-REGEN-PROTOCOL.md)** — matriz
cambio→comando con los pasos exactos, verificados contra el workspace de edición
(`video-d6-work`, directorio hermano del repo), y el gate de re-QA (9/9 lanes).
