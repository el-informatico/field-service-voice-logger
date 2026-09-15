# STATUS — Field Service Voice Logger

Bitácora por bloque. Última actualización: **2026-09-15** (fase pre-sprint COMPLETA).
Sprint real: 24–25 sep → `docs/plan.md`. Hackathon cierra **30-sep-2026 15:00 UTC**.

## Estado global — pre-sprint terminado ✅

| Bloque | Estado | Evidencia |
|---|---|---|
| PASO 0 — vigilancia competitiva | ✅ | `docs/research/competitor-landscape-2026-09-15.md`. **Wedge libre**: Relay renuncia al carril ("not a voice form filler"), QuoteReady ocupa read-back en otro dominio (intake de presupuestos), 0/61 submissions publican accuracy. Riesgos no verificables: AutoCopilot, KiaOra → re-auditar antes del video (D6) |
| Investigación docs AssemblyAI | ✅ | `docs/research/assemblyai-notes.md` (contrato verificado). Correcciones al brief: min_silence adaptativo (no fijar), interrupt_response true por defecto, token GET, audio PCM16 24 kHz base64-en-JSON, tool.result como string, siempre session.end |
| Scaffold + contrato | ✅ | `docs/architecture.md` (esquemas §4–§9), LICENSE Apache-2.0, CI (`npm run selftest` + `smoke:mock`) |
| Datos sembrados + GT | ✅ | `node data/validate.js` OK: 10 órdenes (5 HVAC + 5 eléctrico), 25 piezas con pares confundibles, 3 guiones, 3 GT (s2: error sembrado 3/4→3/8; s3: 3 interrupciones) |
| Harness de métricas | ✅ | `node metrics/cli.js --selftest` OK (oráculo hand-computed en fixtures/expected.json). Salida: tabla markdown + report.json |
| Backend token/sessions | ✅ | `bash api/selfcheck.sh` 33/33: token real|mock, rechaza `audio_retained≠false` y payloads tipo-audio, same-origin, no-store |
| Frontend + engine + mock | ✅ | 15 archivos, ESM, cero deps. Canal real (ws-agent.js con mappers puros testeados) + canal mock determinista con MISMA interfaz |
| Pipeline end-to-end (CI) | ✅ | `npm run smoke:mock`: 3 sesiones → artefactos §6 → métricas vs GT → ficha exacta. Piezas P/R/F1 100%, errores sembrados rescatados 2/2, barge-ins 3/3 (255–337 ms), WER 0.003 |
| README + diferenciación | ✅ v1 | Tabla de métricas (placeholders honestos + qué ya está CI-proven), sección "How we differ from Relay" con evidencia citada |
| Repo público GitHub | ✅ | github.com/el-informatico/field-service-voice-logger (Apache-2.0) |

## Verificación local (todo verde, 2026-09-15)

```bash
npm run selftest      # metrics selftest (oráculo) + data/validate.js
npm run smoke:mock    # 3 sesiones mock → artefactos → métricas vs GT + invariante de ficha
bash api/selfcheck.sh # 33 checks del backend (token mock/real, invariants de privacidad)
npm run dev           # http://[::1]:3000 (WSL2 mirrored networking: usar [::1], no 127.0.0.1)
```

## Decisiones tomadas hoy (2026-09-15)

1. **Stack**: estático sin build + Vercel functions (`api/`), ESM en todo, Node 22,
   **cero dependencias npm**. WebSocket crudo (no hay SDK web oficial — verificado).
2. **Sin API key en el entorno** → modo mock documentado: `/api/token` responde
   `mode:"mock"`; TODO el pipeline corre sin key ni audio. Insertar la key:
   `.env` → `ASSEMBLYAI_API_KEY` (`.env.example`); nada más cambia.
3. **Privacidad por diseño**: el SERVER rechaza artefactos con `audio_retained≠false`
   y payloads tipo-audio (>64 KB por campo); audio jamás subido; consentimiento
   antes del micrófono.
4. **Re-wedge confirmado por PASO 0**: "logger de calidad documental" (loop de
   confirmación hablada + ficha auditada en vivo + accuracy medida y publicada).
   La forma se está commoditizando en verticales adyacentes (EvidenTurn, AegisOR,
   +6 subs/día) — la defensa es dominio (field service + ruido) + métricas.
5. **Engine DOM-free** compartido browser/Node → el smoke es CI-able y
   determinista (artefactos idénticos corrida a corrida salvo timestamps wall-clock).

## Fallas y reparaciones del día (transparencia)

- Agente de datos murió por 429 a mitad de `validate.js` (globMatch quedó
  comentado) → reparado a mano + check de acentos relajado a contención de palabra.
- Agente de métricas murió por timeout de API (1 h sin escribir nada) → reanudado
  con directiva "escribe cada archivo ya"; completó con 2 correcciones honestas a
  su propio oráculo hand-computed.
- **Bug de harness encontrado en integración**: WER 90% en sesiones mock por
  emparejar refs por `n` global de guion (1,3,5…) contra índice de turno de
  usuario → corregido a emparejamiento cronológico; WER 0.902 → **0.003**
  (residual = la mal-audição sembrada de s2, exactamente lo que debe detectar).

## Abierto para el sprint (NO hoy)

1. **D1**: API key real + primera sesión de voz real contra ws-agent.js (los
   mappers ya están testeados); promover `set_diagnostico`/`set_notas` a tools
   públicas si el LLM las necesita.
2. **D2 GATE**: tuning turn-taking con ruido (vad_threshold / interruption_delay /
   transcription_mode max_accuracy). Si no converge → Plan B (Voice Incident
   Reporter, ~70% código compartido).
3. **D4 — política del texto libre**: la captura verbatim (muletillas incluidas)
   da similitud baja vs referencia limpia (Jaccard 0.02–0.63, umbral 0.8).
   Decidir con sesiones reales: guardar verbatim + versión normalizada (y medir
   la normalizada), o métrica orientada a recall de contenido. Es una decisión
   de producto (evidencia textual vs ficha facturable), no un bug.
4. **D4**: ruido DEMAND/MUSAN a SNR fijo (mezcla offline), export PDF/CSV.
5. **D5**: deploy Vercel + durable storage para /api/sessions (hoy /tmp efímero,
   documentado en api/README.md).
6. **D6**: re-auditar galería (AutoCopilot/KiaOra/nuevas) ANTES de grabar el video.

## Bitácora

- **2026-09-15 (sprint, D2 — GATE ejecutado con audio real → VEREDICTO:
  PLAN B)** — 16 sesiones reales contra el Voice Agent API (driver
  `scripts/realgate.mjs`: token temporal de un solo uso, wavs del guion a
  ritmo real, DEMAND a SNR fijado; evaluador `scripts/gate-eval.mjs`;
  resultados completos y tabla en `docs/D2-GATE-RESULTS.md`, ~$4.2 de
  crédito). Resumen: **limpio converge** (C1 0.90, C2 0, WER 0.080; ficha
  GT-exacta con 7 tool calls y read-back); **ruido 10dB no converge en los
  guiones de turnos largos**: falsos cierres de turno 2-4 por sesión (splits
  del VAD en pausas enmascaradas) en TODAS las confirmatorias (criterio ≤1),
  barge-in provocado 1/3 y 0/3 (criterio ≥2/3), WER 0.17-0.25 en babble;
  `voice_focus: near-field` no mitigó; tools del LLM colapsan con ruido
  (7→0-2). Criterios pre-registrados → **GATE FALLA → Plan B activado
  (Voice Incident Reporter)**: notas cortas post-visita en ambiente tranquilo
  — ~70% del código se reutiliza (WS, tools, engine, artefacto, métricas,
  export); el diferencial read-back + accuracy medida sobrevive. Fixes del
  día que quedan: get_orden sin args (orden activa de sesión), schema
  get_tiempo_trabajo expone minutos declarados, prompt con máquina de
  estados + saludo con contexto, derivación de confirmaciones del transcript
  (eventos marcados derived:'transcript'), corrección de carrera del driver
  (ceder turno completo al agente).
- **2026-09-15 (sprint, D4-ruido + GATE D2 staged)** — Harness de ruido
  completo: TTS del guion (29 wavs es-MX, 286 s, 24 kHz mono; incluye
  variante as_heard de s2), DEMAND real (DKITCHEN/SPSQUARE/OOFFICE, 300 s
  c/u, provenance con md5), mezclador RMS con SNR post-mix verificado
  (261 mezclas a 10/5/0 dB, peor desvío 0.09 dB, sin clipping). 176 MB en
  `.data/` (gitignored). **`docs/D2-GATE.md` = runbook del gate**: matriz
  T0-T6 + confirmatorias C1-C4 con early-exit, criterios cuantificados
  (turnos ≥90%, falsos cierres ≤1, barge-in ≥2/3, WER limpio ≤0.10),
  presupuesto ~15 sesiones (≈$8-10 de los $50), y camino explícito a Plan B.
  **ÚNICO bloqueo restante para D1-real y el GATE: `ASSEMBLYAI_API_KEY`
  en `.env`** — con la key, el gate corre en minutos sin cambios de código.
- **2026-09-15 (sprint, D3 — UI de sesión, FREEZE de alcance)** — Pantalla de
  sesión completa: barra sticky (orden+estado+cronómetro mm:ss), transcripción
  viva con parciales del técnico en gris, FICHA de una tarjeta por campo con
  traza de auditoría (tool+t_ms / confirmación por voz / edición manual),
  piezas con badge ✓/⏳ y qty editable, banner ámbar de read-back con
  Confirmar/Corregir, botón ¡Espera! destacado, pantalla final con los 4
  botones de export (contract con export.js) y DASHBOARD de órdenes+sesiones.
  Edición ligera vía `store.applyManualEdit` (audit 'edicion_manual' →
  artefacto). Verificado: selftest + smoke:mock verdes + 2 pasadas
  headless-browser (32 aserciones) en claro/oscuro 360px. **Alcance congelado
  tras D3: nada nuevo después de esto** (solo D4 métricas/ruido, D5 deploy,
  D6 video).
- **2026-09-15 (sprint, D4-export)** — Export y conector FSM: `web/js/export.js`
  (CSV con BOM + PDF vía vista de impresión A4 `css/print.css` + descarga de
  artefacto + envío a FSM, contract `initExportPanel`), `api/fsm.js`
  (POST /api/fsm/report valida ficha, rechaza audio, persiste ack en `.data/fsm/`),
  `scripts/export.mjs` (CLI CSV+MD, mismos builders que el browser → CSV
  byte-idéntico). Validado con dev-server ([::1]) y selftest verde. PENDIENTE
  USUARIO: `ASSEMBLYAI_API_KEY` en `.env` — sin ella no hay sesión de voz real
  (D1-real) ni evaluación del GATE D2.
- **2026-09-15 (calidad de repo)** — Triple validación pre-commit activada y
  verificada con bloqueos de prueba: sin atribución de IA en mensajes de
  commit; sin tokens sensibles (paths del host / proyectos hermanos) en
  líneas añadidas staged ni en mensajes. Regla y límites: `CONTRIBUTING.md`.
  Licencia del repo: Apache-2.0.
- **2026-09-15 (pre-sprint, completo)** — Brief ejecutado íntegro: PASO 0 +
  investigación de docs + repo + contrato + datos sembrados + harness de métricas
  + endpoint de token (mock documentado) + esqueleto WS/tools/mock-agent + CI
  verde end-to-end. Todo lo que NO requiere audio real está hecho y verificado.
  Veredicto PASO 0: **seguir, no Plan B** — la accuracy medida/publicada sigue
  libre en todo el evento.
