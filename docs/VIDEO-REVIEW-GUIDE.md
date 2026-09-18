# Guía de revisión — demo video D6 (≤10 minutos)

**Video:** `demo-video-d6.mp4` — 180.3 s (3:00) · 1920×1080 @30 fps · H264+AAC ·
captions EN quemadas · loudness −14 LUFS (−14.1 medido) · 12 segmentos =
4 escenas estáticas + 8 cortes del take de la app.

**Re-render 2026-09-16 (tarde):** el master se regeneró aplicando el fix-list
de la auditoría independiente (`VIDEO-AUDIT-d6.md` §6/§8): tabla de métricas
**N=10**, disclosure del replay **hablado**, silencios recortados (máx 7.6 s),
cadena de encode CRF 16/17, captions del print-view arriba. El master
anterior (193.0 s, tabla N=5) queda como `demo-video-d6-prev.mp4`.

**Dónde está:** `~/projects/field-service-voice-logger-deliverables/demo-video-d6.mp4`
(+ `demo-video-d6.srt`, 56 cues / 429 palabras — byte-idéntico al quemado en el video).

**Fuente de verdad de los timestamps:** el `.srt` entregable y `build/segments.json`
del workspace de edición (directorio hermano `video-d6-work`, fuera del repo).
Los cortes entre segmentos son fundidos de 0.4 s: los límites de la tabla tienen
±1 s de tolerancia.

---

## DECISIÓN #1 — RESUELTA (2026-09-16): el video ya cita la tabla N=10

- El beat `m-metrics` se regeneró desde README §Metrics y la narración se
  re-grabó: **10 sesiones reales**, p50 "one point six seconds", watchdog 2/10,
  nota honesta v3→v4. Los 15 valores en pantalla == README verbatim (lane
  determinista `metrics-verbatim` re-anclada, 15/15).
- El video ahora también **dice en voz alta** que el roleplay es un replay
  determinista (cue 11, 0:30): *"What you're watching is a deterministic
  replay — the scripted session on a mock channel, in the operator's Spanish
  UI. The numbers later come from real API runs."*
- Residual aceptado y documentado: timestamps del seed-data internos de la app
  (visibles solo en pausa) — N/A sin re-grabar el take
  (`VIDEO-AUDIT-d6.md` §8, ítem 6).

---

## Protocolo de revisión (2 pasadas + check-off, ~10 min)

1. **Pasada 1 — velocidad 1x (3:00):** mirar la **ficha de la app** (timeline,
   chips de servicios, severidad, banners de read-back) y las **captions**
   (legibles, abajo — ARRIBA solo dentro del print-view de e-exports, por diseño).
2. **Pasada 2 — velocidad 1.5x (~2:00):** **escuchar** el audio (VO completa, sin
   cortes) y vigilar las **luces**: banners de confirmación, chips que giran a ✓,
   fundidos entre beats, frames negros.
3. **Check-off:** tabla minuto-a-minuto + los 15 valores de la escena de métricas.

---

## Tabla minuto-a-minuto (12 beats)

| Rango · beat (cues) | Qué hay en pantalla | Qué escuchar (citas = SRT) | Qué verificar — PASS si… |
|---|---|---|---|
| **0:00–0:16** · `s1-pain` (cues 1–5) | Escena estática: título *"The incident closed hours ago. The report still isn't written."*, 3 tarjetas (Paper notes / Retype the evening / No evidence trail), pie *"Voice Incident Reporter — AssemblyAI Voice Agent Hackathon 2026"* | *"It's seven PM. The incident closed hours ago, but the report still isn't written. … Paper notes, details gone by Friday, and no evidence trail anyone can audit."* | Caption legible en la banda inferior sin pisar las tarjetas; lo narrado refleja las 3 tarjetas. |
| **0:16–0:24** · `r1-setup` (cues 6–8) | App real: dashboard → incidente IC-2001 → consentimiento → sesión inicia. Badge **"modo mock"** + label quemado **"DETERMINISTIC REPLAY — scripted session (mock channel)"** (sup-der) | *"Voice Incident Reporter. After the visit, the technician opens the incident and starts a voice session. Consent comes before the microphone."* | Label DETERMINISTIC REPLAY presente; badge "modo mock" visible; la pantalla de consentimiento coincide con *"Consent comes before the microphone."* |
| **0:24–0:48** · `r2-start` (cues 9–16) | Sesión corriendo en auto-replay: transcript y ficha se llenan solos | *"He just talks. The agent transcribes, and the incident form builds itself. Every field with its own audit trail. What you're watching is a deterministic replay — the scripted session on a mock channel, in the operator's Spanish UI. The numbers later come from real API runs."* (0:24–0:45); **0:45–0:48 silencio por diseño** (dictado del operador, la ficha sigue llenándose) | La ficha/timeline se llena sola durante el silencio. El silencio NO es fallo. |
| **0:48–0:56** · `r3-timeline` (cues 17–18) | Banner de read-back de hora *"¿Confirmo el evento a las 05:40?"* → confirmación → fila de timeline con timestamp | *"Times are confirmed out loud. Monitoring detected the outage at five forty? Yes. Locked, with a timestamp."* | Banner legible; la hora en pantalla (**05:40**) es la misma que la narrada (*"five forty"*). |
| **0:56–1:13** · `r4-prodstg` (cues 19–24) — **MOMENTO CLAVE** | La captura oye *staging* → read-back nombrando **ambos** servicios del catálogo → corrección a producción; chip ✓ | *"The technician said production. The capture heard staging. The agent reads it back, naming both catalog services. The technician corrects it. The wrong service never reaches the report. A seeded capture error, rescued by voice."* | La pregunta de read-back se lee; el servicio final en la ficha es **producción** (no staging); label DETERMINISTIC REPLAY presente. |
| **1:13–1:18** · `r5-pagos` (cue 25) | Confirmación de la API de pagos (mismo mecanismo de read-back) | *"The payments API confirms the same way."* | La confirmación se alcanza a ver aunque el beat es corto (~5 s). |
| **1:18–1:35** · `r6-severity` (cues 26–29) | Severidad entra como **MEDIA** → read-back → corrección a **ALTA** (banner ≈1:26–1:29) | *"Severity comes in as medium, and the agent reads it back anyway. Three hours down in sales hours? High. Second seeded error, second rescue by spoken confirmation. Those cross marks? Manual edits — not errors."* (1:21–1:34) | El chip de severidad termina en **ALTA** al cierre del beat. |
| **1:35–1:43** · `r7-ficha` (cues 30–32) | End screen: ficha completa IC-2001 — producción, API de pagos, alta, horas 05:40/07:30/08:45, action items | *"Session over. The form is complete. Timeline, services, severity, action items. Every field showing where it came from."* | Los campos citados se ven; el zoom de ficha es legible. |
| **1:43–2:04** · `m-metrics` (cues 33–39) | Tabla *"Real sessions, published numbers"* con kicker *"Measured, not promised · N=10 · failures included"* + sub-línea v3/v4 + nota honesta (watchdog 2/10) | *"We measured this instead of promising it. Ten real voice sessions … zero point two three one. … one hundred percent … about one point six seconds median. … honestly, two of ten sessions hit the watchdog timer. Failures included, published in the README."* | Los 15 valores del check-off (abajo) se leen; la caption no pisa la nota honesta. |
| **2:05–2:24** · `e-exports` (cues 40–45) | CSV descargado → PDF print-view → FSM ack (toast). **Desde ≈2:10 las captions van ARRIBA (por diseño)** para no tapar el footer del PDF que la narración cita | *"The report leaves the session as evidence. CSV for the ticket system. A print-ready PDF whose audit footer states the audio was never retained. … the field-service connector accepts it with an ack. Text only, no audio, by design."* | Se ven: descarga CSV, vista de impresión con footer legible (*"el audio no fue retenido"*), ack `FSM-…`. **Aquí NO hay label DETERMINISTIC REPLAY por diseño** — no flaggear. |
| **2:25–2:48** · `a-arch` (cues 46–53) | Diagrama: navegador ⇄ WebSocket `wss://agents.assemblyai.com/v1/ws` (chips STT/LLM/TTS/VAD), tools JSON-Schema con enums de catálogo, token de un solo uso, audio never persisted, zero npm deps, CI | *"Under the hood, one managed WebSocket … Tools are JSON-Schema functions with catalog enums … zero npm dependencies, and the pipeline is proven in CI."* | La URL del WebSocket es legible; lo narrado corresponde a las cajas del diagrama; caption (abajo de nuevo) no pisa el pie del diagrama. |
| **2:49–3:00** · `c-close` (cues 54–56) | End card: *"Voice in. Evidence out."* + repo `github.com/el-informatico/field-service-voice-logger` + `npm run smoke:mock` | *"Voice in. Evidence out. … It's open source. One command runs the whole demo. Link below."* | URL del repo exacta; al oírse *"Link below"* el link está visible en pantalla. |

---

## Check-off visual — los 15 valores de la escena de métricas (1:43–2:04)

Valores **tal como aparecen en pantalla** (tabla N=10 del build; validados
verbatim por la QA determinista contra la escena fuente == README §Metrics).

| # | Valor en pantalla (= README N=10) |
|---|---|
| 1 | `10 REAL voice sessions` (kicker/sub-línea) |
| 2 | `7–10 of 9–11 per session` (turn completion, `10 sessions`) |
| 3 | `0.231` (WER, matched pairs) |
| 4 | `0.164–0.382/session` (rango por sesión) |
| 5 | `2,134 ref words` |
| 6 | `1,554 ms / 4,810 ms` (EOS→tool p50/p95) |
| 7 | `53 tool turns` |
| 8 | `100% (12 TP / 0 FP)` (precisión servicios, fila verde) |
| 9 | `70.6% (5 FN)` (recall servicios) |
| 10 | `6/10 sessions` (severidad exacta) |
| 11 | `19/35 GT events (54.3%)` (timeline) |
| 12 | `62.1%` (precisión del loop de confirmación) |
| 13 | `29 read-backs` |
| 14 | `1,139 ms` (EOS→tool p50 v4-alone, en la nota honesta) |
| 15 | Nota honesta: *"two of ten sessions hit the 300 s driver watchdog"* |

---

## Qué dice el video sobre el fix narrativo (prompt v4)

**Ya lo dice.** Desde el re-render: la sub-línea de la escena de métricas
muestra *"10 REAL voice sessions — 5 on interview prompt v3 + 5 on prompt v4
(the narrative-capture fix)"* y la nota honesta cierra con los números v4
(*"Prompt-v4 sessions alone: 100%/100% service set, 13/18 timeline hours,
EOS→tool p50 1,139 ms"*). La historia completa vive en `README.md` §Metrics,
`STATUS.md` (bloque METRICS-N10) y `docs/SUBMISSION.md`.

---

## Residuos conocidos y ACEPTADOS (no re-flaggear)

Hallazgos del QA visual asistido residual ya analizados contra evidencia
determinista = **0 defectos accionables** (gate = 9/9 lanes deterministas):

1. **cap-r4 (≈1:03)** — cues encadenadas que parten mid-clause (p. ej. *"The
   agent reads"* → *"it back, naming both catalog services."*): continuación
   exacta en la cue siguiente (~9 palabras por cue), práctica estándar de
   subtitulado. Recorte físico imposible: márgenes laterales 120 px + padding 8,
   caja medida completa.
2. **r4-readback (1:00–1:10)** — la pregunta de read-back aparece con el styling
   real de la app (botón amarillo *"¡Espera!"* + pregunta en gris), no como un
   banner ámbar sólido: el check de QA sobre-especificaba el color. El criterio
   real — **pregunta de read-back legible** — se cumple; los eventos de banner
   pasaron en las assertions del take (14/14).
3. **e-pdf (≈2:10–2:24)** — durante el print-view la caption va **arriba**
   (`{\an8}`) para dejar visible el footer de auditoría que la narración cita.
   Cubre parcialmente la fila *"Equipo:"* del encabezado del PDF (~12 s):
   trade-off aceptado (el footer es el elemento citado; abajo lo tapa; al
   centro taparía el cuerpo). El footer sí queda legible completo.
4. **Drift del reloj del recorder — ya corregido en build:** el reloj de eventos
   acumuló drift (+1.4…+6.3 s tras t≈46 s, saltos de reloj WSL2); los cortes de
   `r7`/`e-exports` se re-anclaron a tiempos reales de video (SSIM contra
   keyframes). No es visible en el final y no requiere revisión.
5. **Silencios por diseño:** el modo mock no produce audio de sesión. Ventanas
   mudas mientras la app trabaja: 0:45–0:48 (dictado), colas de ≤3 s en los
   demás cortes (máx. gap medido 7.6 s
   < 8 s). No es audio cortado.
6. **Seed-data interno de la app** (IDs de sesión/ack/fechas de impresión)
   visible solo en pausa — N/A documentado en `VIDEO-AUDIT-d6.md` §8 ítem 6.

---

## Señales que SÍ requieren acción

- **Audio cortado:** la VO se trunca a mitad de frase (la última palabra de un
  beat no cierra, o el corte llega antes del final de la palabra).
- **Caption sobre contenido:** la caja del caption pisa contenido FUERA de los
  casos diseñados. Regla: banda inferior (nada de contenido por debajo de
  y≈930), EXCEPTO el print-view de `e-exports` (≈2:10–2:24) donde ir arriba es
  el fix diseñado (ítem 3 de residuos).
- **Número en pantalla ≠ valor esperado** de esta guía (la guía ya refleja la
  tabla N=10 == README).
- **Label "DETERMINISTIC REPLAY — scripted session (mock channel)" ausente en
  los beats de roleplay r1–r7** (esquina superior derecha). Su ausencia en
  `e-exports` (2:05) SÍ es por diseño — no flaggear ahí.
- **Desync audio-video:** la narración describe otra escena de la que se ve
  (p. ej. se oye *"CSV for the ticket system"* mientras aún está la ficha).
- **Frames negros o congelamiento** >0.5 s en cualquier punto (decode roto).

---

## Si algo falla

→ **[docs/VIDEO-REGEN-PROTOCOL.md](VIDEO-REGEN-PROTOCOL.md)** — matriz
cambio→comando con los pasos exactos, verificados contra el workspace de edición
(`video-d6-work`, directorio hermano del repo), y el gate de re-QA (9/9 lanes).
