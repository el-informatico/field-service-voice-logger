# web/ — frontend + session engine (sin build, ESM, cero dependencias)

## Mapa de archivos
| Archivo | Qué es |
|---|---|
| `index.html` + `css/style.css` | 3 pantallas: consentimiento → orden+guion → sesión (ES, mobile-first, dark) |
| `js/app.js` | Orquestador UI; arma canal mock/real + engine; descarga y POSTea el artefacto |
| `js/session-engine.js` | NÚCLEO DOM-free: construye el artefacto §6 (events/transcript/final_form), ejecuta tools |
| `js/store.js` | Ficha `final_form` + auditoría (pure, sin DOM) |
| `js/tool-runner.js` | Implementación de las 7 tools (buscar tolerante, enum de catálogo, etc.) |
| `js/tools.js` | DEFINICIONES para `session.update` (7 tools, `enum` sku = guard anticonfusión) |
| `js/mock-agent.js` | Canal mock determinista (PRNG mulberry32; replay de guiones con pacing plausible) |
| `js/ws-agent.js` | Canal REAL: WS crudo a AssemblyAI (mic AudioWorklet, playback, tool.result drain) |
| `js/agent-config.js` | Prompt v1 del entrevistador ES + turn_detection (vad 0.4, sin min_silence) |
| `js/dialog-act.js` | Utilidades de texto ES: normalización, dígitos hablados, sí/no, qty, minutos |
| `js/guion-sim.js` | Enriquece guiones desde el GT: `as_heard` (mal oída) e `interrupt` |
| `js/clock.js` | realClock / simClock (t_ms deterministas en replay) |
| `js/smoke-example.mjs` | Smoke headless: 3 guiones → artefactos en `.data/smoke/` |

## Interfaz Canal (mock y real son intercambiables)
```js
channel = { on(type, fn), send(type, data), start(), stop(), clock, isMock }
// El canal EMITE:  ready | user_turn_start | user_turn_delta | user_turn_end
//   agent_turn_start | agent_turn_text | agent_turn_end | tool_call
//   confirm_request | confirm_result | barge_in | report_sent | error | ended
// El engine responde: send('tool_result', {call_id, tool, ok, result})
// Controles (mock): send('advance') | send('user_text',{text}) | send('interrupt_request',{text?})
```
El engine (única fuente del artefacto) es agnóstico: mismo vocabulario para ambos canales.

## Cómo funciona el replay mock
- Cada turno `user` del guion se "habla" con duración simulada 3–6 s, respuesta del
  agente a 300–900 ms, tool call ~150 ms después → muestras de latencia plausibles.
- `as_heard`: si el turno lo lleva, ES lo que "oyó" el ASR (s2: "tres cuartos" →
  "tres punto ocho" → buscar_pieza resuelve VLV-038) y es lo que va al transcript.
- `interrupt:true`: el turno interrumpe al agente a mitad de frase (~55 %): emite
  `barge_in` con `agent_text_cut` ("…de tres cuar—") y latencia 250–400 ms.
- Ambos flags los deriva `guion-sim.js` del ground-truth (`seeded_errors`,
  `provoked_interruptions`), con fallback por escenario.
- Determinista: PRNG con seed por escenario → t_ms idénticos corrida a corrida.

## Smoke headless (CI)
```js
import { createStore } from './web/js/store.js';
import { createToolRunner } from './web/js/tool-runner.js';
import { createSessionEngine } from './web/js/session-engine.js';
import { createMockAgentChannel } from './web/js/mock-agent.js';
const guion = JSON.parse(read('data/guiones/s2-pieza-mal-oida.json'));
const channel = createMockAgentChannel({ ordenes, piezas, guion, speed: Infinity });
const store = createStore({ orderId: guion.order_id, now: () => channel.clock.now() });
const engine = createSessionEngine({ channel, toolRunner: createToolRunner({
  ordenes, piezas, store, clock: channel.clock }), store,
  meta: { session_id: 's', scenario_id: guion.scenario_id, mode: 'mock',
    order_id: guion.order_id, noise_condition: 'clean' }, clock: channel.clock });
engine.start(); await channel.start(); const artifact = engine.end();
```
Correr todo: `node web/js/smoke-example.mjs` → `.data/smoke/artifact-*.json` + resumen.
En browser: `npm run dev` (o cualquier server estático en la raíz del repo).

## Qué cambia el D1 (modo real con API key)
1. `ASSEMBLYAI_API_KEY` en `.env` del server → `/api/token` devuelve `{mode:'real', token}`.
2. `app.js` ya cablea `createRealAgentChannel` solo en modo real (mic solo ahí).
3. Ajustar prompt/tools según comportamiento real del LLM; el confirm_request del
   canal real se deriva del read-back hablado (clasificador compartido `dialog-act`).
4. Las tools internas `set_diagnostico`/`set_notas` (solo mock hoy) pueden
   promoverse a definiciones públicas si el LLM las necesita.

## Export del cierre (D4): `js/export.js` + `css/print.css`

En la pantalla de cierre, `app.js` llama:

```js
import { initExportPanel } from './export.js';
initExportPanel({ artifact, statusEl }); // artifact §6 completo + HTMLElement de estado
```

`export.js` cablea los cuatro botones (`#btn-export-csv`, `#btn-export-pdf`,
`#btn-download-artifact`, `#btn-send-fsm`) y escribe líneas de estado en español
en `statusEl`. Si un botón aún no existe en el DOM, se cablea en su primer click
(delegación en captura); re-llamar `initExportPanel` con otro artefacto actualiza
el artefacto activo. Todos los textos del técnico se insertan con
`textContent` (nunca HTML). `scripts/export.mjs` (CLI de métricas/CI) importa los
mismos builders puros (`buildOrdenCsv`, `buildOrdenMarkdown`), así el CSV del
navegador y el del CLI son byte a byte el mismo formato.

### Formato del CSV de la orden (`orden-<id>-<yyyymmdd-hhmm>.csv`)

Dos bloques separados por una línea vacía:

1. **Ficha**: una fila de encabezado + UNA fila de valores con los campos
   escalares de `final_form` — `order_id, cliente, problema, diagnostico,
   solucion, tiempo_minutos, notas, estado` (columnas extra al final si
   `final_form` trae campos nuevos).
2. **Piezas**: encabezado `sku,nombre,qty,confirmada` + una fila por pieza.

```csv
order_id,cliente,problema,diagnostico,solucion,tiempo_minutos,notas,estado
"OT-1004","Escuela Primaria Benito Juárez","Pos te comento...","...","...",50,"el breaker está bien...","enviada"

sku,nombre,qty,confirmada
"CAP-ARR-455","Capacitor de arranque 45+5 µF 370 V",1,true
"CNT-030-24","Contactor 2 polos 30 A bobina 24 VAC",1,true
```

Reglas: BOM UTF-8 (Excel), finales de línea CRLF, TODAS las celdas entrecomilladas
con `""` escapado (RFC 4180, seguro ante comas/comillas/saltos). `cliente` se
rellena desde `final_form.cliente` o del último `get_orden` en `events[]` (vacío
si no existe). `confirmada` es `true|false`; `tiempo_minutos` vacío si es null.
Sin piezas, el bloque 2 queda solo con su encabezado.

### PDF (impresión) — `css/print.css`

`#btn-export-pdf` construye (o reconstruye) un `#print-view` oculto con la ficha
formateada —encabezado de orden, datos generales, problema/diagnóstico/solución,
tabla de piezas con bordes y SKUs monoespaciados, y el pie de auditoría
"Documento generado por sesión de voz — el audio no fue retenido." con sesión y
fecha—, inyecta una sola vez la hoja `css/print.css` y llama `window.print()`.
Al imprimir, la app completa se oculta y sale solo la ficha (A4); en el diálogo,
"Guardar como PDF" produce el PDF sin dependencias.

### Envío al FSM (conector simulado)

`#btn-send-fsm` hace `POST /api/fsm/report` con
`{order_id, final_form, session_id, sent_at}` y muestra el ack devuelto
(`fsm_id`, `received_at`) en `statusEl`; si no hay red, muestra la pista de
reintento (modo mock: mantener `npm run dev` corriendo). Contrato completo del
endpoint en `api/README.md`.

