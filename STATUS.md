# STATUS — Field Service Voice Logger

Bitácora por bloque. Última actualización: **2026-09-17** (re-audit galería a 63 envíos + fila barge-in real-session en docs de submit + refresh a master de video 3:00 tras 3 iteraciones; únicos gates restantes: revisión humana del video + push).
Sprint real: 24–25 sep → `docs/plan.md`. Hackathon cierra **30-sep-2026 15:00 UTC**.

## Estado global — pre-sprint terminado ✅

| Bloque | Estado | Evidencia |
|---|---|---|
| PASO 0 — vigilancia competitiva | ✅ | `docs/research/competitor-landscape-2026-09-15.md` + re-auditoría 2026-09-17 (`docs/GALLERY-AUDIT-0917.md`). **Wedge libre**: Relay renuncia al carril ("not a voice form filler", cita reverificada 09-17), QuoteReady ocupa read-back en otro dominio (intake de presupuestos, cita reverificada), 0/63 submissions publican accuracy (el más cercano: Robin Voice Ops publica pass-rate de escenarios + p50/p95 de latencia, NO accuracy de extracción). KiaOra YA verificado (dispatch de emergencias, no documenta, sin accuracy); AutoCopilot sigue sin verificar. Queda 1 conteo final el día del submit |
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

- **2026-09-15 (D6 — guion y plan de grabación LISTOS; grabación pendiente)**
  — `docs/video-script-en.md` (EN, beat a beat con timestamps 0:00–5:00,
  números reales del README, varianza declarada, regla de no citar modelo),
  `docs/video-recording-plan.md` (checklist equipo + captura por beat + notas
  de edición + checklist de submit con re-auditoría de galería ANTES de
  grabar la línea de diferenciación), `docs/video-demo-setup.md` +
  `scripts/demo-video.sh` (demo self-contained en un comando: selftest-gate,
  dev-server en 3199, runbook de grabación, cleanup reforzado — verificado
  boot + banner; modo mock determinista $0 / real ~$0.2/take). README lleva
  la sección video con el pitch del diferencial. **PENDIENTE**: grabar,
  editar <5:00, subir, submit con margen (cierre 30-sep 15:00 UTC).
- **2026-09-15 (D5 — COMPLETO: auditado → pusheado → desplegado, con gate del
  usuario)** — (1) Pruebas negativas de hooks: commit con path local, con
  nombre hermano (un identificador recién añadido a la lista local de
  tokens del git dir) y con
  trailer IA — los tres RECHAZADOS; greps del checklist: 0 hits de
  paths/hermanos/keys en el árbol trackeado; `.env` no trackeado + ignorado.
  (2) Auditoría pre-push completa (21 commits, 138 blobs, objeto-DB entero):
  **PUSH SAFE** — 0 atribución de IA (solo el propio guard como blocklist),
  0 paths internos en lo pusheable, 0 secrets, LICENSE Apache-2.0 en TODOS
  los árboles, mensajes como dev-log normal; 2 hallazgos cerrados (gitignore
  `.env*` commitado; objetos inalcanzables purgados con gc). (3) **Push**
  `20447b1..bec2795` (22 commits en remoto) — CI del push: **success**.
  (4) **Deploy Vercel**: https://field-service-voice-logger.vercel.app —
  verificación en vivo completa: / 200, data/ordenes 200, /api/token 200
  (modo mock SIN key en el server — deseado), /api/sessions POST+GET 200,
  /api/fsm/report 200 (rewrite añadido), `audio_retained:true` → 400, y
  /.env, /.data/, /.vercel → 404. Tres intentos de deploy con dos fallos
  diagnosticados y fixeado quirúrgicamente (payload 190 MB → `.vercelignore`
  con .env*/.data/etc a 61 archivos; alias de runtime `nodejs22.x` rechazado
  por CLI 59.x → default Node 22 vía engines). (5) **Storage**: efímero
  EXPLÍCITO — write-failures devuelven `stored:false`+nota (jamás 500), GET
  en frío devuelve lista vacía, todo response lleva `ephemeral_note`; ruta de
  upgrade durable documentada en `api/README.md` (KV/Neon/Upstash → swap de
  `storeArtifact()`/`storeReport()`). `.env.local` de `vercel link` contiene
  solo un token OIDC efímero del CLI, gitignored, nunca deployado.
- **2026-09-15 (PLAN-B-D2 — 5+1 sesiones REALES tranquilas del incidente,
  tabla publicada en README)** — Sesiones reales contra el API con
  `realgate --domain incident` (prompt v3: máquina de estados + few-shot de
  horas + cadena buscar→agregar con `siguiente_paso` en los resultados de las
  tools). Set final-config: R1c/R1d (i1), R2a (i2), R3a/R3b (i3) + R1a/R1b
  exploratorias y R2b (timeout del watchdog, documentado). Resultados en el
  README ( matched-WER 0.231, turn completion 8-10/10-11, herramientas
  end-of-speech→tool p50 1775 ms; sesiones que engancharon: servicios 100%
  precisión, timeline 3/3, severidad OK). **Hallazgo de producto honesto**: el
  guion narrativo puro (i1) colapsa el agente de entrevista en 2/2 corridas
  (1 tool call) — el dictado necesita pausas/marcadores del operador o un
  prompt que extraiga del flujo continuo; queda como iteración #1 post-D2.
  Métricas crudas con artefactos de medición (WER cronológico por splits,
  latencia agente por orden de eventos) documentadas y EXCLUIDAS de la tabla
  pública. Artefactos: `.data/gate/artifact-i*-tranquilo-R*.json` +
  `report-incidente.json`.
  **FALTA D5 (deploy)**: push (tu YES) + Vercel + storage durable
  /api/sessions y /api/fsm + prueba móvil auriculares. **FALTA D6 (video)**:
  re-auditar galería (AutoCopilot/KiaOra/nuevas), guion video EN <5 min
  (dolor → dictado real con read-back → ficha+export → métricas medidas → 40 s
  arquitectura), README ya lleva la tabla real, submit con margen (cierre
  30-sep 15:00 UTC).
- **2026-09-15 (PLAN-B-D1 — pivote ejecutado: Voice Incident Reporter)** —
  Dominio incidente completo sobre el 70% compartido (ws-agent, session-engine,
  artefacto §6, canal mock/real, métricas, export — INTACTOS, `git diff`
  limpio): (1) datos: 8 incidentes IC-2001..2008 (TI+facilities), 15 servicios
  con 4 pares confundibles (PROD↔STG, RACK-A3↔A8, BOMBA-PRIM↔SEC,
  CORREO-PROD↔BACKUP), 3 guiones+GT (i2: servicio confundido + severidad
  rescatados por read-back; i3: hora 09:20→09:40 + 1 interrupción);
  (2) flujo voice→ficha re-apuntado: 9 tools (get_incidente sin args, enum de
  servicios, severidad enum, hora con pattern, read-back en horas/servicios/
  severidad), runner/store de incidente, mock entrevistador post-visita con
  directivas de guion, UI con selector de modo (Incidente por DEFECTO, Orden
  legado intacto como evidencia del 70% compartido), export CSV/print con rama
  incidente (CSV orden byte-idéntico), `realgate --domain incident` (prompt
  post-visita, wavs limpios en `.data/tts-incidente/` — 34 wavs, 272 s),
  métricas por campo de incidente (servicios/timeline/action-items/severidad)
  con fixtures y oráculo; (3) **selftest + smoke:mock VERDES en ambos
  dominios** (6 sesiones mock, fichas exactas vs GT, errores sembrados
  rescatados 3/3, WER 0.006). Limitación conocida: en modo real desde el
  browser las confirmaciones de servicios se derivan solo al enviar (el
  derivador del driver real sí las marca en vivo).
  **QUEDA PARA D5 (deploy)**: Vercel + storage durable para /api/sessions y
  /api/fsm (hoy /tmp efímero) + prueba móvil con auriculares — requiere tu YES
  para push/deploy. **QUEDA PARA D6 (video+submit)**: re-auditar galería
  (AutoCopilot/KiaOra/nuevas), guion de video EN (<5 min: dolor → dictado en
  vivo con read-back → ficha+export → métricas medidas → 40 s arquitectura),
  README re-apuntado a Incident Reporter con la tabla de métricas, submit con
  margen (cierre 30-sep 15:00 UTC). Sesiones reales del gate de incidente
  (ambiente tranquilo, sin ruido — el modo de fallo está diseñado fuera):
  correr 5+ sesiones con `realgate --domain incident` + métricas para poblar
  la tabla publicable.
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
- **2026-09-15/16 (D6-video — GENERADO, QA 9/9, ENTREGADO)** —
  (1) **Voz**: `CARTESIA_API_KEY` NO existe en `.env` y la regla del proyecto
  es no crear keys del usuario → fallback aprobado **edge-tts
  `en-US-AndrewNeural` rate +8%** (12 segmentos, 143.86 s de locución,
  12/12 caben en sus ventanas). Cartesia Sonic queda pendiente de la key del
  usuario: insertarla en `.env` y regenerar `tts/` es un swap de 1 comando.
  (2) **Grabación**: app REAL en `scripts/demo-video.sh` (dev-server :3199)
  forzada a modo mock determinista (boot con `ASSEMBLYAI_API_KEY=` vacío,
  badge "modo mock" visible a propósito); incidente i2 "servicio confundido"
  contra IC-2001 en unattended auto-replay (101.2 s medidos con probe);
  interacciones reales de Playwright (consent→setup→sesión→ficha→CSV→PDF).
  Etiqueta "DETERMINISTIC REPLAY — scripted session (mock channel)" quemada
  en los beats de roleplay (drawtext, esquina sup-der).
  (3) **Re-auditoría de galería** (pre-línea-de-diferenciación, según plan):
  KiaOra Dispatch confirmado como submission del hackathon (triage autónomo
  inbound, sin read-back, sin accuracy publicada) → wedge intacto; línea
  aprobada: "every voice demo we could find either fills a form or dispatches
  autonomously — none of them publish accuracy, none rescue capture errors by
  speaking them back."
  (4) **Edición**: ffmpeg xfade/acrossfade (12 segmentos: 4 escenas estáticas
  + 8 cortes del take), captions quemadas con aserción dura narración==cues
  (47 cues / 377 palabras, verificada en SRT y en el .ass quemado; re-render
  2026-09-16: 50 cues / 404 palabras), loudnorm
  I=−14 LUFS (−14.1 medido), 1080p30 H264+AAC.
  (5) **QA determinista** (`tools/qa-lanes.mjs`, 9 lanes) — **9/9 PASS**:
  duración 193.0 s (re-render 2026-09-16: 178.1 s) · word-count SRT==ASS==narración (377; re-render: 404) · decode 0 errores ·
  0 blank frames >0.5 s · 15 valores del README §Metrics verbatim en la escena
  · 14/14 assertions del take · −14.1 LUFS · streams video+audio ·
  captions-visible (Δluma 18–20 en banda inferior, Δ=0 sobre contenido).
  Dos defectos encontrados y corregidos DURANTE el QA, con causa raíz:
  (a) el reloj del recorder acumuló drift +1.4..+6.3 s tras t≈46 s (saltos de
  reloj WSL2 + clamp monotónico; print_reveal→print_hide colapsó a 10 ms) →
  cortes de r7/e-exports re-anclados a tiempos REALES de video vía SSIM vs
  keyframes + detección de cambio de escena (`tools/anchor-scan.mjs`);
  (b) captions quemadas invisibles: `subtitles`+SRT escala ×3.75 (PlayRes
  384×288) y `BorderStyle=3,Outline=0` no dibuja caja en este build de libass
  → gemelo **.ass con PlayRes 1920×1080** (estilo en píxeles reales, caja
  opaca y980–1060, nada sobre y930) + lane `captions-visible` anti-regresión.
  (6) **QA visual residual con modelo de visión externo** (secundario): 3 runs. Run 1 (4
  FAIL) detectó 1 defecto real (ventana e-exports por el drift, corregido);
  run 2 (8 FAIL) **invirtió veredictos sobre píxeles idénticos** → inestable
  en frames borderline, se documentó sin iterar; run 3 sobre el final (post
  -fix): **7/11 PASS** y el modelo ahora LEE el texto del caption (confirma el
  fix). Los 4 FAIL restantes analizados contra evidencia determinista = 0
  defectos accionables: 2 son límites naturales entre cues encadenadas
  ("The agent reads"→"it back, naming both catalog services."; "…entries.
  Tool"→"calls at…"), 1 pregunta del check sobre-especificaba el color del
  banner (el read-back legible está), 1 footer del print sheet bajo el
  pliegue (comportamiento real de la app, no del encode). Gate = lanes
  deterministas. Reporte: `build/qa-report.md` dentro del workspace externo de video.
  (7) **Entregable**: `demo-video-d6.mp4` (re-render 2026-09-16: 14.3 MB,
  178.1 s = 2:58 < 5:00; el original 12.1 MB / 193.0 s queda como
  `demo-video-d6-prev.mp4`; pass de 3 iteraciones 2026-09-17 → master final
  **31.0 MB, 180.3 s = 3:00**, cadena -prev2/-N1/N2/N3, QA 9/9 re-pasada —
  fila video en `docs/SUBMISSION-CHECKLIST.md`) +
  `demo-video-d6.srt` (captions EN) en el directorio de entregables externo
  acordado (fuera del repo; >10 MB como se especificó). Sin push. Workspace
  completo de edición (escenas, TTS, take, herramientas, reportes QA) fuera
  del repo, en el workspace de video hermano.

## METRICS-N10 (2026-09-16) — fix del caso narrativo + ampliación a N=10

Pedido: (1) fix del flujo narrativo continuo (i1 colapsaba 2/2 a 1 tool call
con el prompt v3) tocando SOLO el prompt del entrevistador y/o guiones, máx 2
iteraciones medidas; (2) N=5 sesiones reales nuevas (2 narrativas + 2
corrección + 1 mixta) → tabla N=10 en README; (3) artefactos por sesión +
este bloque.

### Iteración del prompt (superficie medida: §incidente de scripts/realgate.mjs)
- **v4 (GANADORA, iteración 1)**: "PERO HOY ERES EL REGISTRADOR DE
  INCIDENTES" + REGLA #1 (ningún dato dicho se queda sin tool call) + MODO
  NARRATIVO (una tool call POR dato, read-back agrupado al cierre) + "NUNCA
  respondas en silencio" + few-shots de conversión de horas ("ocho
  cincuenta"→"8:50"). Evidencia R4a (i1): 10 tools (vs 1 en v3), 3/4 horas,
  sev alta exacta, servicios 2/2, p50 1039 ms.
- **v5 (iteración 2, DESCARTADA)**: 3 ediciones puntuales (dato nuevo tras
  confirmación, read-back corto, doble pendiente). R4b REGRESÓ (5 tools, 0
  servicios, timeline 0: read-backs HABLADOS sin tool call) → revert completa
  a v4 (grep de remanentes = 0; diff de realgate.mjs queda solo v3→v4, 53
  líneas). Conclusión: variabilidad run-to-run del agente de entrevista, no
  efecto de las ediciones. Presupuesto de iteraciones agotado → v4 queda
  como prompt final.

### Sesiones nuevas (todas v4, ambiente tranquilo, mismas condiciones del gate)
| label | guion | resultado vs GT |
|---|---|---|
| R4a | i1 narrativo | 10 tools; horas 3/4 (08:50 quedó embebida en que_paso); sev alta ✓; srv DNS+VPN ✓✓; items 0/2 (turno "sí… y deja dos pendientes" tragado por CONFIRMACIONES); en_proceso |
| R5a | i1 narrativo | 15 tools; horas 4/4; sev ✓; srv ✓✓; items 2/2 ✓; set_resumen ✓; VAD partió el turno 1 en 2 hyps; transcript del último turno vacío; en_proceso |
| R5b | i2 confundible | **WATCHDOG 300 s** (t19+ nunca sonaron); srv WEB-PROD+API ✓✓ (desambiguación y captura final correctas); sev media vs alta = la corrección estaba en el turno cortado (mismo artefacto que R2a publicada); timeline 0/3 (regresión del patrón R4b: read-backs hablados sin tool call); en_proceso |
| R5c | i3 corrección hora | 9 tools; horas 3/3 (incluye 09:20→09:40 con la verdad final en ficha); sev media ✓; srv BOMBA ✓; items 1/2; en_proceso |
| R5d | i4 mixto (nuevo) | 13 tools; horas 3/4 (perdió 07:50); sev alta ✓; srv A3+VPN ✓✓ con el **ERROR SEMBRADO RESCATADO EN REAL** (A8 capturado → read-back de desambiguación → A3 confirmado; n_rescued=1 en el derivado); items 0/2; en_proceso |

### Tabla N=10 publicada (README §Metrics)
Turn completion 7–10 de 9–11/sesión · WER emparejado 0.231 (0.164–0.382,
2134 palabras) · EOS→tool p50/p95 1554/4810 ms (53 turnos) · severidad 6/10 ·
servicios P 100% (12 TP/0 FP) R 70.6% (5 FN) · timeline hora exacta 19/35
(54.3%) · confirm precision 62.1% (29 read-backs).

### Comparativa v3 (5 publicadas) vs v4 (5 nuevas) — mismos guiones y condiciones
| métrica | v3 | v4 |
|---|---|---|
| Servicios P / R | 100% (3 TP) / 37.5% (5 FN) | 100% (9 TP/0 FP) / 100% (0 FN) |
| Timeline hora exacta | 6/17 (35.3%) | 13/18 (72.2%) |
| Severidad exacta | 2/5 | 4/5 |
| EOS→tool p50 / p95 | 1775 / 6192 ms | 1139 / 3726 ms |
| WER emparejado | 0.231 (1081 w) | 0.231 (1053 w) |
| Confirm precision | 61.5% (13) | 62.5% (16) |

i1 (el caso colapsado) solo: v3 0/8 horas y 1 tool/sesión → v4 7/8 horas y
10–15 tools/sesión. El WER no se movió (0.231 ambas mitades): el fix fue
disciplina de tool calls, no de escucha.

### Débil residual (documentado, sin más iteraciones)
1. **Variabilidad run-to-run**: R4b (excluida) y R5b hablaron read-backs sin
   registrar — R5b perdió su timeline completo. v4 reduce la frecuencia, no
   la elimina.
2. **Turno "confirmación + datos nuevos"** ("Sí, así va bien, y deja dos
   pendientes…"): la regla CONFIRMACIONES traga los datos → items 0/2 en
   R4a/R5d (R5a sí los capturó). Era el blanco de v5; quedó sin prueba
   limpia por la regresión de R4b.
3. **Timeline verbatim vs GT limpio**: strict hora+evento (sim≥0.6) sigue en
   0 TP en las 10 sesiones (política D4: la hora exacta es la señal).
4. **Rig**: watchdog 300 s truncó 2/10 sesiones (R2a, R5b); el transcript
   del último turno sale vacío (R5a) y NINGUNA sesión (v3 ni v4) llega a
   enviar_reporte — el rig cierra el WS tras el reply final, estado queda
   en_proceso en todos los artefactos.
5. **Derivación de confirmaciones** subcuenta rescates cuando el operador
   responde con contenido ("Producción.") en vez de sí/no.

### Infra y artefactos
- `scripts/n10-table.mjs`: agregador N=10 (matcher greedy orden-preservante
  ≥0.4 + WER por pares emparejados + pooled hora-exacta + harness CLI).
  VALIDADO: reproduce la tabla publicada N=5 exacta antes de usarse.
- `web/js/domain/incident/mock-agent.js`: fix de plomería del canal mock —
  quePasoFlow ahora encadena a eventoFlow cuando el dictado trae horas
  (espejo de la REGLA #1 del agente real; solo afecta turnos con
  setQuePaso+eventos coexistiendo, p. ej. i4 t3). smoke:mock i4 4/4 horas,
  selftest OK.
- `data/guiones-incidente/i4-mixto.json` + `gt-i4-mixto.json` +
  validador: escenario mixto (narrativa con horas + error sembrado de
  servicio confundible A3↔A8), TTS ya en .data/tts-incidente.
- Artefactos por sesión: `.data/gate/artifact-*-tranquilo-R4a/R4b/R5a/R5b/
  R5c/R5d.json` (patrón existente, fuera de git).
- Coste: 6 sesiones reales nuevas (R4a, R4b, R5a–R5d) ≈ $1.5 USD.

## SUBMISSION-READINESS (2026-09-16) — pack de submit completo; gates restantes: revisión humana del video + push

Meta: día del submit = ejecución pura (objetivo 28-sep; cierre 30-sep 15:00
UTC). Plan de ejecución ítem por ítem con owners (REPO-YA vs HUMANO):
`docs/SUBMISSION-CHECKLIST.md`.

- **Textos del submit**: `docs/SUBMISSION.md` (EN, copy-paste ready; 7
  secciones; tabla N=10 verificada contra README; framing honesto: rig
  rules-only, narración TTS declarada, jamás se presenta audio sintético
  como audio de sesión). Mapeo campo-plataforma → sección en §3 del
  checklist.
- **Revisión del video en ≤10 min**: `docs/VIDEO-REVIEW-GUIDE.md` — 2
  pasadas (1x ficha+captions / 1.5x audio+luces) + tabla minuto-a-minuto de
  los 12 beats + check-off de los 15 valores de la escena de métricas +
  **DECISIÓN #1 — RESUELTA (2026-09-16)**: el video se re-renderizó contra
  la tabla N=10 (beat `m-metrics` regenerado + narración re-grabada; 15/15
  valores verbatim contra README; lane metrics-verbatim re-anclada). Master
  nuevo 178.1 s entregado como `demo-video-d6.mp4` (anterior conservado como
  `demo-video-d6-prev.mp4`; 09-17: superseded por el master final 180.3 s =
  3:00 tras 3 iteraciones); validación con modelo de visión externo 1 ronda, 8/8 ítems del
  audit resueltos o N/A documentado — detalle en
  `VIDEO-AUDIT-d6.md §8 ROUND RESULTS`.
- **Regeneración del video**: `docs/VIDEO-REGEN-PROTOCOL.md` — 7 casos con
  comandos exactos del workspace de edición externo, matriz
  determinista(A)/re-grabar(B)/humano(C), gate obligatorio 9/9 lanes.
- **Portadas**: `cover-a.png` (escena de métricas 01:59) · `cover-b.png`
  (read-back 01:06) · `cover-c.png` (apertura 00:05), 1920x1080 extraídas
  del mp4 final al directorio de entregables — elección humana (ítem 7).
- **Auditoría pre-publicación** (`docs/AUDIT-SUBMISSION-2026-09-16.md`):
  veredicto **PUSH-SAFE** — 0 autoría-atribución, 0 paths del host, 0
  secretos, 0 identificadores de proyectos hermanos en el contenido a
  publicar. 3 fixes aplicados (2 neutralizaciones en este STATUS; 1 en
  SUBMISSION.md revertido por el orquestador: nombrar la herramienta de
  narración es tool-credit, no atribución — veto humano abierto).
- **Historia git**: el mensaje del commit D6-video (único blocker de la
  auditoría) fue reword-eado vía cherry-pick sin cambio de árbol; respaldo
  local `backup-pre-reword`. **Sin push** (regla: ninguno sin "YES"
  explícito del usuario).

Commits del bloque (lógicos): C1 textos+checklist · C2 guías de video · C3
auditoría+fixes de STATUS · C4 este bloque. Verde final verificado:
`npm run selftest` + `npm run smoke:mock`.
