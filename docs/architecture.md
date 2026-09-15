# Arquitectura — Field Service Voice Logger

> Contrato técnico del proyecto. Los esquemas de este archivo son vinculantes para
> `data/`, `web/`, `api/` y `metrics/`: si cambia un campo, cambia aquí primero.
> Fecha: 2026-09-15 (fase pre-sprint). Investigación de la API real en
> `docs/research/assemblyai-notes.md` (los nombres exactos de parámetros del
> Voice Agent API se toman de ahí, no de este archivo).

## 1. Idea en una línea

Un técnico de campo narra una reparación con las manos ocupadas; un **voice agent
en tiempo real** (VAD + turn-taking + barge-in reales, NO dictado-y-resumen)
entrevista, llena la orden de trabajo vía tools con JSON Schema y **confirma en
voz alta** los datos críticos (read-back de piezas: "¿decías la válvula de
3/4?"). La sesión produce un artefacto JSON auditable y la ficha final. El
diferencial público es el **loop de confirmación hablada + accuracy de
extracción medida y publicada**.

## 2. Layout del repo

```
field-service-voice-logger/
├── README.md               # EN, juez-facing: métricas + diferenciación vs Relay
├── STATUS.md               # bitácora de avance (ES), actualizado por bloque
├── LICENSE                 # Apache-2.0
├── .env.example            # ASSEMBLYAI_API_KEY=
├── package.json            # scripts: dev (server local), metrics, selftest
├── vercel.json             # deploy: functions en api/, estático en web/
├── api/                    # serverless functions (Vercel) — NUNCA expone la API key
│   ├── token.js            # POST → token temporal de un solo uso (o mock si no hay key)
│   └── sessions.js         # POST → persiste artefacto de sesión (JSON, nunca audio)
├── web/                    # frontend estático, sin build step
│   ├── index.html          # consentimiento → selector de orden → sesión (ficha viva)
│   ├── css/style.css
│   └── js/
│       ├── app.js          # orquestador de sesión + UI (3 pantallas)
│       ├── ws-agent.js     # canal REAL: WebSocket al Voice Agent API (contrato en assemblyai-notes.md)
│       ├── mock-agent.js   # canal MOCK determinista para dev SIN API key (misma interfaz)
│       ├── session-engine.js # NÚCLEO DOM-free: constructor del artefacto §6 + ejecutor de tools
│       ├── agent-config.js # prompt del entrevistador (ES) + turn detection (params citados)
│       ├── tools.js        # DEFINICIONES de tools (JSON Schema, enum contra catálogo)
│       ├── tool-runner.js  # IMPLEMENTACIÓN cliente de las tools contra data/
│       ├── store.js        # estado de la orden + traza de auditoría
│       ├── dialog-act.js   # utilidades ES: normalización, números hablados, sí/no, cantidades
│       ├── guion-sim.js    # deriva as_heard/interrupt del guion+GT para replay mock
│       ├── clock.js        # relojes (real / simulado determinista)
│       └── smoke-example.mjs # smoke headless: 3 sesiones mock → artefactos en .data/smoke/
├── data/
│   ├── ordenes.json        # 10 órdenes de trabajo mock (HVAC + eléctrico)
│   ├── piezas.json         # ~25 piezas con pares confundibles (3/4 vs 3.8)
│   ├── guiones/            # 3 guiones de prueba con guion de usuario turn a turn
│   └── ground-truth/       # ficha esperada por guion (para accuracy/WER)
├── metrics/
│   ├── cli.js              # `node metrics/cli.js <artefacto(s)> --gt <ground-truth>`
│   ├── lib/                # loader, latency, accuracy, confirmation, wer, bargein, report
│   ├── fixtures/           # artefactos sintéticos + GT → self-test del harness
│   └── README.md           # definiciones exactas de cada métrica
├── scripts/
│   ├── dev-server.mjs      # server dev local zero-dep (estático + /api/* + /data/*)
│   └── smoke-mock.mjs      # CI: 3 sesiones mock → métricas vs GT → invariante de ficha
└── docs/
    ├── architecture.md     # este archivo
    ├── plan.md             # D1–D6 con gate en D2
    └── research/           # competitor-landscape, assemblyai-notes
```

## 3. Reglas duras

1. **Tiempo real sí o sí**: VAD + turn-taking + barge-in del Voice Agent API.
   Prohibido derivar a "grabar todo y resumir al final" (descalifica en espíritu).
2. **La API key nunca llega al navegador**: el frontend pide un token temporal
   de un solo uso a `POST /api/token`.
3. **Cero retención de audio crudo**: se persiste transcript + eventos de tools
   + ficha final. El audio vive solo en memoria del navegador durante la sesión.
   `"audio_retained": false` va firmado dentro del artefacto.
4. **Sesión iniciada por el técnico** (nunca "always-listening") con pantalla de
   consentimiento visible antes de abrir el micrófono.
5. Todo dato demostruible es demostrable: los números que se publiquen salen de
   `metrics/` sobre artefactos reales, con N y condiciones declaradas.

## 4. Esquema — data/ordenes.json

Array de órdenes. IDs `OT-1xxx`. Dos industrias: HVAC y eléctrico.

```json
{
  "id": "OT-1042",
  "cliente": "Panadería La Espiga",
  "sitio": "Local Av. Insurgentes 1204, Col. Centro",
  "equipo": "Campana extractora MKE-450 (extractor industrial)",
  "equipo_id": "HVAC-EXT-450",
  "problema_reportado": "La campana no extrae; el motor zumba pero no gira el ventilador",
  "tecnico": "Marta Ruiz",
  "prioridad": "alta",
  "industria": "HVAC",
  "estado": "abierta",
  "creada": "2026-09-15T08:30:00-06:00"
}
```

## 5. Esquema — data/piezas.json

~25 piezas. Cada pieza lleva sinónimos/jerga para matching tolerante y pares
confundibles deliberados (el motor del diferencial 3/4 vs 3.8).

```json
{
  "sku": "VLV-034-BR",
  "nombre": "Válvula de bola latón 3/4\"",
  "alias": ["válvula 3/4", "valvula tres cuartos", "bola 3/4"],
  "tipo": "valvula",
  "compatible_con": ["HVAC-*", "HID-*"],
  "unidad": "pza",
  "confundible_con": ["VLV-038-BR"]
}
```

## 6. Esquema — artefacto de sesión (el corazón del proyecto)

Lo emite `web/js/app.js` al cierre (y por chunks a `/api/sessions`). Es la única
fuente de verdad para el harness de métricas. `t_ms` = ms transcurridos desde
`session_start` (reloj del cliente, monótono).

```json
{
  "schema_version": 1,
  "session_id": "sess_20260915_1042_a1b2",
  "scenario_id": "s2-pieza-mal-oida",
  "mode": "real",
  "order_id": "OT-1042",
  "started_at": "2026-09-15T14:03:11.240Z",
  "ended_at": "2026-09-15T14:09:58.510Z",
  "audio_retained": false,
  "turn_detection": { "vad_threshold": 0.4, "interrupt_response": true, "interruption_delay": 0 },
  "noise_condition": "clean | demand_10db | musan_10db | real_shop",
  "events": [
    { "t_ms": 0,     "type": "session_start" },
    { "t_ms": 2100,  "type": "user_turn_start" },
    { "t_ms": 6100,  "type": "user_turn_end", "text": "…transcripción final del turno…" },
    { "t_ms": 6250,  "type": "agent_turn_start" },
    { "t_ms": 6480,  "type": "tool_call",   "call_id": "c1", "tool": "buscar_pieza", "args": { "consulta": "válvula 3/4" } },
    { "t_ms": 6510,  "type": "tool_result", "call_id": "c1", "ok": true, "result": { "sku": "VLV-034-BR" } },
    { "t_ms": 7900,  "type": "agent_turn_end", "text": "¿Decías la válvula de bola de 3/4 pulgada?" },
    { "t_ms": 8050,  "type": "confirm_request", "field": "pieza", "value": { "sku": "VLV-034-BR", "qty": 1 } },
    { "t_ms": 10400, "type": "confirm_result",  "field": "pieza", "value": { "sku": "VLV-034-BR", "qty": 1 }, "confirmed": true },
    { "t_ms": 10500, "type": "form_update", "changed": ["piezas"], "form": { "…snapshot completo de final_form…" } },
    { "t_ms": 13000, "type": "barge_in", "agent_text_cut": "¿Decías la válvu—", "user_text": "¡espera, era la de 3/4!", "latency_ms": 320 },
    { "t_ms": 14000, "type": "report_sent" }
  ],
  "transcript": [
    { "role": "user",  "text": "…", "t_start_ms": 2100, "t_end_ms": 6100 },
    { "role": "agent", "text": "…", "t_start_ms": 6250, "t_end_ms": 7900 }
  ],
  "final_form": {
    "order_id": "OT-1042",
    "problema": "…texto libre…",
    "diagnostico": "…",
    "solucion": "…",
    "piezas": [ { "sku": "VLV-034-BR", "nombre": "Válvula de bola latón 3/4\"", "qty": 1, "confirmada": true } ],
    "tiempo_minutos": 45,
    "notas": "…",
    "estado": "enviada"
  }
}
```

Reglas del timeline:
- `user_turn_end` → siguiente `tool_call` (si existe en ese turno) = **latencia
  fin-de-habla→tool call**; `user_turn_end` → siguiente `agent_turn_start` =
  **fin-de-habla→respuesta**.
- `confirm_request`/`confirm_result` solo los emite el loop de read-back de
  piezas y cantidades (no para texto libre).
- `barge_in` se registra con `agent_text_cut` no vacío y la latencia
  interrumpido→silencio del agente.

## 7. Tools (definidas en web/js/tools.js, implementadas en tool-runner.js)

| Tool | Props (JSON Schema) | Efecto |
|---|---|---|
| `get_orden` | `{ orden_id: string }` | Devuelve la orden (de data/ordenes.json) |
| `buscar_pieza` | `{ consulta: string }` | Búsqueda tolerante (alias/jerga) en el catálogo; devuelve candidatos con sku/nombre |
| `agregar_pieza_a_reporte` | `{ sku: enum(catalogo), qty: integer ≥1 }` | Agrega pieza a final_form.piezas; dispara read-back de confirmación |
| `set_problema` | `{ texto: string }` | Fija problema (texto del técnico, no del LLM) |
| `set_solucion` | `{ texto: string }` | Fija solución |
| `get_tiempo_trabajo` | `{}` | Minutos transcurridos desde inicio del trabajo |
| `enviar_reporte` | `{}` | Cierra la ficha, marca estado=enviada, emite artefacto |

El `enum` de `sku` se genera EN TIEMPO DE BUILD-DE-SESIÓN desde `data/piezas.json`
(esto es lo que atrapa "3/4" vs "3.8" a nivel de schema). Las definiciones son
inmutables durante la sesión; las implementaciones son cliente (client-side
function tools del Voice Agent API: el agente emite `tool.call`, el cliente
responde `tool.result` con el result como **string JSON**, enviado cuando el
último evento recibido sea `reply.done` — ver docs/research/assemblyai-notes.md).

Nota de implementación (15-sep): `final_form.diagnostico` y `notas` no tienen
tool pública en el contrato de 7; el tool-runner las cubre con pseudo-tools
INTERNAS (`set_diagnostico`/`set_notas`) que fluyen por el mismo pipeline
`tool_call`→`tool_result`. Si el LLM real las necesita explícitas (D1), se
promueven a definiciones públicas — cambio de una línea en tools.js.

Nota de tuning verificada en docs (2026-09-15): `min_silence`/`max_silence` son
**adaptativos por defecto** y fijarlos a mano mata el pacing adaptativo — no
hacerlo salvo experimento controlado del D2. Para pausas largas de técnico
trabajando: `vad_threshold` bajo + evaluar `transcription_mode: "max_accuracy"`.
`interrupt_response` viene `true` por defecto (barge-in real); `interruption_delay`
0–1000 ms controla cuán rápido cede el agente.

## 8. Métricas (definiciones exactas — implementación en metrics/)

Sobre N sesiones con guion (target N≥10 sesiones, ≥30 turnos para latencia):

1. **Latencia** p50/p95 (ms): `user_turn_end→tool_call` y `user_turn_end→agent_turn_start`,
   calculadas solo de `events[]`. Reportar N y condición de red.
2. **Accuracy de extracción por tipo de campo** vs `ground-truth/`:
   - `problema`, `solucion`: similitud normalizada (minúsculas, sin acentos,
     sin stopwords) ≥ 0.8 con el texto de referencia = correcto.
   - `piezas`: SKU exacto + qty exacta; se reportan precision/recall/F1 del
     conjunto (predichos vs GT) y % de órdenes con el conjunto completo correcto.
   - `tiempo_minutos`: correcto si |pred − gt| ≤ 5 min.
3. **Loop de confirmación hablada**:
   - *Error real* = pieza cuyo valor capturado inicial ≠ GT.
   - **recall** = errores reales rescatados por un confirm_request que derivó en
     corrección ÷ errores reales.
   - **precision** = confirm_requests que terminaron en corrección ÷ confirm_requests
     totales (1 − falsas alarmas de "¿decías…?").
4. **WER** palabra a palabra: referencia = turnos de usuario del guion;
   hipótesis = `transcript[]` role=user. Limpio vs +ruido (DEMAND/MUSAN a SNR
   declarado, mezcla offline en D4).
5. **Barge-in**: N interrupciones provocadas (guion s3) → % respetadas
   (agente calló <500 ms tras el inicio del turno intruso) vs robadas.

Salida del harness: `metrics/report.json` + tabla markdown lista para pegar en
README (pipeline por sesión + agregado).

## 9. Modos de operación

- **`real`**: `GET /api/token` → el server hace
  `GET https://agents.assemblyai.com/v1/token?expires_in_seconds=300` con la API
  key (Bearer) y devuelve `{token, expires_in_seconds, mode:"real"}` (token de un
  solo uso, TTL 1–600 s) → WS a `wss://agents.assemblyai.com/v1/ws?token=…` con
  `session.update` (system_prompt, greeting, tools, turn detection). Requiere
  `ASSEMBLYAI_API_KEY` en el server.
  Audio: PCM16 mono 24 kHz en base64 dentro de JSON (`input.audio`), con pacing
  en tiempo real. Al cerrar SIEMPRE enviar `session.end` (la facturación corre
  por tiempo de WS abierto + 30 s de gracia de resume).
- **`mock`** (sin API key): `/api/token` responde `{ "token": "mock", "mode":
  "mock", "ttl": 0 }`; `mock-agent.js` implementa la MISMA interfaz de eventos
  que el agente real (agent_turn_start/text/end, tool_call…) mediante un
  entrevistador determinista por reglas contra los guiones. Todo el pipeline
  (tools → ficha → artefacto → métricas) es testeable sin gastar un centavo ni
  grabar audio. Este modo existe para desarrollar y para el self-test del repo
  (CI-able), NO para la demo del video.

## 10. Privacidad por diseño

- Pantalla de consentimiento antes de abrir micrófono (texto: qué se graba, qué
  se guarda —solo texto—, cómo se borra).
- Audio: memoria del navegador, se suelta al cerrar la sesión; jamás subido.
- Artefacto: transcript + tools + ficha. Nada más.
- Demo solo con participantes consentidos (evaluación §c: all-party states,
  *Fairhurst v Woodard*, CNIL).
