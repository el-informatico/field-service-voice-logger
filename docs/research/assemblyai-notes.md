# AssemblyAI Voice Agent API — notas de investigación (BUILD CONTRACT)

Fecha: 2026-09-15. Fuentes: docs oficiales (assemblyai.com/docs, versiones `.md` crudas) + repos oficiales en GitHub (AssemblyAI/voice-agent-starter-js y -python). Todo lo citado es textual de esas fuentes; lo que no está en docs se marca **NOT IN DOCS**.

## Resumen ejecutivo

- La API gestiona TODO el pipeline (STT + LLM + TTS + VAD/turn detection) detrás de UN WebSocket: `wss://agents.assemblyai.com/v1/ws`. Confirmado.
- Dos modos de configuración, mutuamente excluyentes: **stored agent** (REST `POST /v1/agents`, luego `{ "agent_id": ... }` en el primer `session.update` — recomendado por AssemblyAI) o **inline** (todo el config en `session.update`).
- Los nombres del brief (`vad_threshold`, `min_silence`, `interrupt_response`) son REALES y van bajo `session.input.turn_detection`. Pero: `min_silence`/`max_silence` por defecto son **adaptativos**, y fijarlos DESACTIVA el pacing adaptativo (advertencia oficial). `interrupt_response` por defecto ya es `true`.
- El flujo de tools client-side existe (`tool.call` → `tool.result`), y hay además **HTTP tools server-side** (AssemblyAI llama a tu endpoint; tu cliente no hace nada) — ideal para un hackathon.
- Token temporal: `GET https://agents.assemblyai.com/v1/token?expires_in_seconds=300` con la API key en el header; single-use; el WS se abre con `?token=`.
- Audio: PCM16 mono 24 kHz base64 en JSON, ambos sentidos (`input.audio` / `reply.audio`).
- Pricing: **$4.50/hora flat** (prorrateado por segundo, facturado por tiempo de WebSocket abierto); $50 de crédito gratuito inicial que cubre Voice Agent.
- Starters oficiales JS (Node ≥18, cero dependencias) y Python (3.9+, solo stdlib) — ambos con cliente browser completo con token endpoint incluido. **No existe SDK npm/pip para Voice Agent**: se usa WebSocket crudo.
- Para la orden de trabajo post-llamada: Sessions API (`GET /v1/sessions/{id}`) devuelve artefactos con timeline JSON (pares `user_transcript`/`agent_text` + `tool_calls` con resultados).

---

## Contrato WS

Fuente: https://www.assemblyai.com/docs/voice-agents/voice-agent-api/events-reference (+ browser-integration, session-configuration, audio-format)

### URL y autenticación

- URL: **`wss://agents.assemblyai.com/v1/ws`** (confirmada; aparece en docs y en los starters).
- Auth opción A (browser): query param `?token=<temporary_token>`, sin header.
- Auth opción B (server-side, con API key directa): header `Authorization: Bearer <API_KEY>` (así lo hace el ejemplo Python de la docs con `websockets.connect(URL, additional_headers={"Authorization": f"Bearer {API_KEY}"})`).

### Secuencia de eventos (diagrama oficial)

```
Client                              Server
  │── WebSocket connect ─────────────►│
  │── session.update ────────────────►│  (system prompt + tools + greeting)
  │◄─── session.ready ────────────────│  (save session_id)
  │── input.audio (stream) ──────────►│  (only after session.ready)
  │◄─── input.speech.started ─────────│
  │◄─── transcript.user.delta ────────│
  │◄─── input.speech.stopped ─────────│
  │◄─── transcript.user ──────────────│
  │◄─── reply.started ────────────────│
  │◄─── reply.audio ──────────────────│
  │◄─── transcript.agent.delta ───────│
  │◄─── transcript.agent ─────────────│
  │◄─── reply.done ───────────────────│
  │◄─── tool.call ────────────────────│  (arguments is a dict)
  │◄─── reply.done ───────────────────│  ← send tool.result here
  │── tool.result ───────────────────►│
  │◄─── reply.started / reply.audio / reply.done │
  │── session.end ───────────────────►│
  │◄─── session.ended ────────────────│
  │◄── WebSocket close ───────────────│
```

### Mensajes cliente → servidor

**`session.update`** — configurar/actualizar la sesión. Enviar como PRIMER mensaje al abrir el WS. Ejemplo completo con todos los campos (fuente: session-configuration):

```json
{
  "type": "session.update",
  "session": {
    "system_prompt": "You are a friendly support agent. Keep responses under 2 sentences.",
    "greeting": "Hi! How can I help you today?",
    "tools": [],
    "input": {
      "format": { "encoding": "audio/pcm" },
      "keyterms": ["AssemblyAI", "Universal"],
      "transcription_mode": "balanced",
      "transcription_prompt": "Expect product names and order IDs.",
      "language_codes": ["en"],
      "voice_focus": "near-field",
      "voice_focus_threshold": 0.5,
      "turn_detection": {
        "vad_threshold": 0.5,
        "min_silence": 1000,
        "max_silence": 3000,
        "interrupt_response": true,
        "interruption_delay": 100
      }
    },
    "output": {
      "voice": "alba",
      "format": { "encoding": "audio/pcm" },
      "volume": 100
    }
  }
}
```

- Con stored agent, el primer `session.update` es solo `{ "type": "session.update", "session": { "agent_id": "<id>" } }` (mutuamente excluyente con los campos inline; enviar ambos → error `agent_id_not_first`).
- `session.agent_id` solo en el primer update. Todos los campos son opcionales (inline).
- Mutable tras `session.ready`: `system_prompt`, `input.turn_detection`, `input.keyterms`, `input.transcription_mode`, `input.transcription_prompt`, `output.volume`, `tools`. Inmutable (error `immutable_field`): `greeting`, `output.voice`, `output.format`.

**`input.audio`** — stream de audio del mic:

```json
{ "type": "input.audio", "audio": "<base64-encoded PCM16>" }
```

- Base64, PCM16 (16-bit signed little-endian), mono, 24 000 Hz (encoding `audio/pcm`, el default). Alternativas telephony: `audio/pcmu` y `audio/pcma` (8 kHz, G.711).
- Enviar solo tras `session.ready`. A ritmo real (más de ~1 s de audio por segundo de reloj se DESCARTA, error `audio_rate_violation`). Chunk size libre; ~50 ms funciona bien.
- `format.sample_rate` (Hz, int) es opcional y deducido del encoding.

**`tool.result`** — responder a un tool.call:

```json
{
  "type": "tool.result",
  "call_id": "call_abc123",
  "result": "{\"temp_c\": 22, \"description\": \"Sunny\"}",
  "is_error": false
}
```

- `result` es un **string JSON** (no objeto). `is_error` opcional, default `false`.
- Enviar cuando `reply.done` es el último evento recibido (ni antes ni después). Patrón: acumular en `tool.call`, drenar en el handler de `reply.done`.

**`session.end`** — cierre limpio (para la facturación de inmediato):

```json
{ "type": "session.end" }
```

Cerrar el WS sin esto deja la sesión 30 s en grace window de `session.resume`… **y esos 30 s se facturan**.

**`session.resume`** — reconectar tras drop dentro de los 30 s:

```json
{ "type": "session.resume", "session_id": "sess_abc123" }
```

**`reply.create`** — forzar una respuesta del agent (útil durante hold-mode tools):

```json
{ "type": "reply.create", "instructions": "Let the customer know we're still processing the transfer." }
```

**`conversation.message`** — inyectar mensaje en el contexto sin que el usuario lo diga:

```json
{ "type": "conversation.message", "role": "user", "content": "I'd like to check my order status." }
```

(`role`: `"user"` o `"system"`.)

### Mensajes servidor → cliente

**`session.ready`** (guardar `session_id`, empezar a mandar audio):

```json
{
  "type": "session.ready",
  "session_id": "sess_abc123",
  "expires_at": 1717180000,
  "resume_token": "...",
  "config": { "system_prompt": "...", "output": { "voice": "alba" }, "...": "..." }
}
```

`config` = configuración resuelta completa (defaults aplicados). `expires_at` = epoch s de duración máxima de la sesión.

**`session.updated`** — eco tras aplicar un `session.update` exitoso: `{ "type": "session.updated", "config": {...} }`.

**`session.ended`** — evento final de todo teardown limpio:

```json
{
  "type": "session.ended",
  "session_duration_seconds": 42.7,
  "audio_duration_seconds": 38.2,
  "timestamp": 1717180000.123
}
```

**`input.speech.started`** / **`input.speech.stopped`** — `{ "type": "input.speech.started" }` (VAD detectó inicio/fin del habla del usuario). `input.speech.started` es la señal más rápida para flush de playback en barge-in.

**`transcript.user.delta`** — parcial del usuario; `text` es el transcript COMPLETO hasta ahora (reemplaza, no concatenar):

```json
{ "type": "transcript.user.delta", "item_id": "item_abc123", "text": "What's the weather in" }
```

**`transcript.user`** — final del utterance: `{ "type": "transcript.user", "text": "...", "item_id": "..." }`.

**`reply.started`** — el agent empieza a responder: `{ "type": "reply.started", "reply_id": "reply_abc123", "item_id": "..." }`. En replies de tool-call, `reply_id` es `fc-<call_id>`.

**`reply.audio`** — chunk de TTS: `{ "type": "reply.audio", "data": "<base64-encoded PCM16>" }`. Decodificar y encolar playback inmediatamente.

**`transcript.agent.delta`** — streaming palabra a palabra alineado al audio:

```json
{ "type": "transcript.agent.delta", "reply_id": "reply_abc123", "item_id": "item_abc123", "delta": "sunny", "start_ms": 1200, "end_ms": 1560 }
```

**`transcript.agent`** — texto final del agent (tras entregarse todo el audio):

```json
{ "type": "transcript.agent", "text": "It's currently 22°C and sunny in Tokyo.", "reply_id": "reply_abc123", "item_id": "item_abc123", "interrupted": false }
```

Si hubo interrupción, `interrupted: true` y `text` recortado a lo realmente hablado.

**`reply.done`** — fin del reply: `{ "type": "reply.done", "reply_id": "reply_abc123", "status": "completed" }` o `"interrupted"`. En `interrupted`: flush del buffer de audio, descartar acumuladores de tool.result pendientes.

**`tool.call`** — el agent quiere llamar una tool:

```json
{ "type": "tool.call", "call_id": "call_abc123", "name": "get_weather", "arguments": { "location": "Tokyo" } }
```

`arguments` es un **dict listo para usar** (no string).

**`session.error`** — `{ "type": "session.error", "code": "...", "message": "...", "timestamp": "2025-01-01T00:00:00Z" }` (a veces con `param`). Códigos: handshake `UNAUTHORIZED` (close 1008), `FORBIDDEN` (1008), `server_error` (1008), `INTERNAL_ERROR` (1011); resume `session_not_found` / `session_forbidden` / `session_expired` (1008); startup `agent_init_failed`, `agent_timeout`; de mensaje `invalid_format`, `invalid_audio`, `invalid_value`, `immutable_field`, `invalid_config`, `agent_id_not_first`, `agent_not_found`, `audio_rate_violation`; **retryables** `at_capacity` y `concurrency_exceeded` (los únicos). Nota browser: fallos pre-handshake pueden llegar solo como `close` 1006 sin payload.

---

## Turn detection

Fuente: https://www.assemblyai.com/docs/voice-agents/voice-agent-api/turn-detection-and-interruptions

Por defecto el turn detection es **semántico y adaptativo** (encendido sin config): decide el fin de turno por el significado, espera valores completos para params de tools (números, emails), adapta el pacing al hablante, y el barge-in es semántico ("uh-huh" no interrumpe, "wait, stop" sí).

Tabla oficial de `session.input.turn_detection` (igual en el stored agent bajo `input.turn_detection`):

| Param | Tipo | Rango | Default | Notas |
|---|---|---|---|---|
| `vad_threshold` | number | 0.0–1.0 | `0.5` | Sensibilidad de detección de habla. Más bajo = más sensible. |
| `min_silence` | number (ms) | **NOT IN DOCS** (sin rango explícito) | `adaptive` | Silencio mínimo para un fin de turno confiado. |
| `max_silence` | number (ms) | **NOT IN DOCS** (sin rango explícito) | `adaptive` | Silencio máximo antes de forzar fin de turno. |
| `interrupt_response` | boolean | true/false | `true` | `false` desactiva el barge-in por completo. |
| `interruption_delay` | number (ms) | 0–1000 | per mode (`0` en `min_latency`, `500` en `balanced`/`max_accuracy`) | Tiempo tras empezar a hablar el usuario antes de que el barge-in pueda cortar al agent. |

Advertencias oficiales relevantes al plan del proyecto:

- **"Setting `min_silence` or `max_silence` turns off the adaptive pacing and entity-aware waiting described above for the rest of the session. Prefer leaving them unset."** → para "pausas largas de trabajo", la docs sugeriría NO fijar `min_silence` alto, sino dejar el pacing adaptativo y/o usar `transcription_mode: max_accuracy` (espera más). Ejemplo oficial con valores: `vad_threshold: 0.5, min_silence: 1000, max_silence: 3000, interrupt_response: true`.
- `transcription_mode` (en `input`): `min_latency` (corta más rápido) | `balanced` (default) | `max_accuracy` (más preciso, espera más). Mutable mid-session (puedes cambiarlo por fase de la llamada).

Señales de interrupción: `reply.done` con `status: "interrupted"` + `transcript.agent` con `interrupted: true`; además `input.speech.started` como señal más temprana para flush de audio.

---

## Tools

Fuentes: https://www.assemblyai.com/docs/voice-agents/voice-agent-api/tools/overview , .../tools/client-side-tools , .../tools/http-tools , https://www.assemblyai.com/docs/voice-agents/voice-agent-api/manage-agents

### Dos tipos

1. **HTTP tools (server-side)** — se definen en el stored agent con bloque `http`; AssemblyAI hace la request por ti; tu cliente NO ve `tool.call`/`tool.result`. Args: `GET`/`DELETE` → query string; `POST`/`PUT`/`PATCH` → JSON body. Response body cap **8 KiB**. Solo `https` y hosts públicos, sin redirects.
2. **Function tools (client-side)** — `"type": "function"` inline en `session.tools`; el agent emite `tool.call`, tu código ejecuta y responde `tool.result`.

### Definición (function tool, en session.update)

```json
{
  "type": "session.update",
  "session": {
    "tools": [
      {
        "type": "function",
        "name": "get_weather",
        "description": "Get current weather for any city. Use this whenever the user asks about weather.",
        "parameters": {
          "type": "object",
          "properties": { "location": { "type": "string", "description": "City name, e.g. London" } },
          "required": ["location"]
        },
        "execution_mode": "interactive",
        "timeout_seconds": 120
      }
    ]
  }
}
```

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `type` | string | requerido | `"function"` (client-side). HTTP tools se definen sin `"type"` en el agent REST y con bloque `http`. |
| `name` | string | requerido | snake_case verbo-sustantivo. |
| `description` | string | `""` | Principal señal de cuándo llamar. |
| `parameters` | JSON Schema | `{}` | `{ "type": "object", "properties": {...}, "required": [...] }`. **No se valida en session.update** — esquemas rotos fallan en runtime. |
| `execution_mode` | string | `"interactive"` | `"interactive"` (agent sigue hablando, <~5 s) o `"hold"` (agent mudo hasta `tool.result`, que auto-dispara la respuesta). |
| `timeout_seconds` | number | `120` | Rango 1–300. |
| `http` | object | `null` | `{ "url", "http_method" (default "POST"), "headers": [{"name","value"}] }` (solo stored agents). url https, máx 2048 chars. |

Hints de precisión por propiedad: `enum`, `examples` (2–4 realistas), `pattern` (regex Python `re`, matchea el valor completo, escapar `\\d` en JSON), `format` (`email`, `date`, `date-time`, `uri`…). Para dígitos hablados largos, escribir `pattern` que tolere espacios interiores.

### Mensajes exactos

Server→client `tool.call`:

```json
{ "type": "tool.call", "call_id": "call_abc123", "name": "get_weather", "arguments": { "location": "Tokyo" } }
```

Client→server `tool.result` (enviar cuando `reply.done` es el último evento):

```json
{ "type": "tool.result", "call_id": "call_abc123", "result": "{\"temp_c\": 22, \"description\": \"Sunny\"}", "is_error": false }
```

Errores útiles para el modelo: devolver `{"error": "..."}` específico dentro del result nombrando el campo que falló.

### Límites

- Número máximo de tools por agente / tamaño de schema: **NOT IN DOCS** (no hay límite duro publicado). Recomendación oficial: **≤10 tools por fase** (más de eso baja la selección); patrón "progressive tool reveal" con `session.update` que **reemplaza** (no mergea) el array `tools` + actualizar `system_prompt` a la vez.
- `timeout_seconds` 1–300; response HTTP tool 8 KiB; url 2048 chars.

---

## Token temporal

Fuentes: https://www.assemblyai.com/docs/voice-agents/voice-agent-api/api-spec/generate-voice-agent-token (OpenAPI oficial), https://www.assemblyai.com/docs/voice-agents/voice-agent-api/browser-integration

- Endpoint: **`GET https://agents.assemblyai.com/v1/token`** (query params, sin body).
- Header: `Authorization: Bearer $ASSEMBLYAI_API_KEY`.
- Params (OpenAPI): `expires_in_seconds` (integer, **requerido** según el spec, 1–600, ej. 300 — ventana para abrir el WS, NO la duración de la sesión) y `max_session_duration_seconds` (opcional, 60–10800, default 10800 = tope de 3 h).
- Response 200:

```json
{ "token": "your-temporary-token", "expires_in_seconds": 300 }
```

- Token **single-use** (arranca exactamente una sesión); fetch inmediatamente antes de cada conexión, incluidos reconnects. Errores 400/401/429/500 con `{ "error": "...", "code": "...", "details": {} }`.
- El starter oficial llama `GET /v1/token?product=voice_agent&expires_in_seconds=60` — el param `product=voice_agent` aparece en el código del starter pero **no** en el OpenAPI spec (probablemente legado/preferido; ambos con la API key en `Authorization`).

curl exacto para el endpoint del server (la API key nunca llega al browser):

```bash
curl "https://agents.assemblyai.com/v1/token?expires_in_seconds=300&max_session_duration_seconds=8640" \
  -H "Authorization: Bearer $ASSEMBLYAI_API_KEY"
```

REST de agents (misma base, misma auth; la key cruda también sirve, `Bearer ` se acepta y se quita): `POST /v1/agents` (201), `GET /v1/agents`, `GET|PUT|DELETE /v1/agents/{id}`. Campos requeridos del stored agent: `name`, `system_prompt`, `voice: { "voice_id": "alba" }` (+ `greeting` recomendado).

Sessions API (post-llamada, para la orden de trabajo): `GET /v1/sessions?limit=50&agent_id=...` (nuevo primero, cursor `response_metadata.next_cursor`), `GET /v1/sessions/{id}` → `artifacts` con URLs pre-firmadas (expiran): `audio` (OGG/Opus), `timeline` (JSON de turnos: `user_transcript`, `agent_text`, `tool_calls[].{name,arguments,result}`), `metadata`. Fuente: https://www.assemblyai.com/docs/voice-agents/voice-agent-api/session-history

---

## Starter repos

- JS: **https://github.com/AssemblyAI/voice-agent-starter-js** (Node ≥18, cero dependencias). Browser app: `deployment/browser/server.mjs`. Deploy 1-click a Render incluido.
- Python: **https://github.com/AssemblyAI/voice-agent-starter-python** (Python ≥3.9, solo stdlib). Browser app: `deployment/browser/server.py`. Mismos 9 agentes JSONC.
- Modelo de uso: cada archivo en `agents/*.jsonc` ES el body de `POST /v1/agents`; `npm run publish` / `python publish.py` lo crea y guarda el `AGENT_ID_<NAME>` en `.env`; el browser solo manda `{ "agent_id": ... }`.
- `agents/turn-taking.jsonc` demuestra exactamente los knobs de turn detection (todos con su valor default explícito: `vad_threshold: 0.5, min_silence: 1000, max_silence: 3000, interrupt_response: true`).

Snippets clave (todos de `deployment/browser/server.mjs` del starter JS, rama `main`):

Token endpoint server-side (~línea donde define rutas; base URL de `lib.mjs`: `https://agents.assemblyai.com/v1`):

```js
if (req.url === '/token') {
  const token = await aai('/token?product=voice_agent&expires_in_seconds=60')
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(token))
}
```

Abrir WS y bind al stored agent:

```js
const { token } = await res.json()
const url = new URL('wss://agents.assemblyai.com/v1/ws')
url.searchParams.set('token', token)
ws = new WebSocket(url)
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'session.update', session: { agent_id: AGENT.id } }))
}
```

Stream de mic (AudioWorklet capture → base64 en JSON, "The API takes base64 inside JSON, not binary frames"):

```js
capture.port.onmessage = ({ data }) => {
  if (!ready || ws.readyState !== 1) return
  const bytes = new Uint8Array(data)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  ws.send(JSON.stringify({ type: 'input.audio', audio: btoa(binary) }))
}
```

Barge-in / interrupciones (flush del ring buffer de playback):

```js
case 'input.speech.started':
  playback?.port.postMessage('stop')   // barge-in: vaciar para cortar mid-word
  break
case 'reply.done':
  if (msg.status === 'interrupted') playback?.port.postMessage('stop')
  break
```

Cierre limpio (evita los 30 s billables del grace window):

```js
function stop() {
  if (ws?.readyState === 1) {
    ws.send(JSON.stringify({ type: 'session.end' }))
    const socket = ws
    setTimeout(() => { if (socket.readyState === 1) socket.close() }, 3000)
  } else ws?.close()
  // ...stop mic tracks, close AudioContexts
}
```

Otros detalles del starter: dos `AudioContext` (capture y playback) forzados a 24 kHz con resample dentro de los worklets por si el browser los ignora; `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })`; contador de coste con `const COST_PER_SECOND = 4.5 / 3600`.

Snippets Python equivalentes en la docs (client-side tools quick start, `websockets.connect(URL, extra_headers={"Authorization": f"Bearer YOUR_KEY"})`, patrón `pending`/`flush_if_idle` para `tool.result` solo tras `reply.done`): https://www.assemblyai.com/docs/voice-agents/voice-agent-api/tools/client-side-tools

---

## Deltas vs suposiciones del brief

| Suposición del brief | Veredicto | Realidad exacta |
|---|---|---|
| `wss://agents.assemblyai.com/v1/ws` | **CONFIRMADA** | Exacta; auth con `?token=` o header `Authorization: Bearer`. |
| `vad_threshold` | **CONFIRMADA** | `session.input.turn_detection.vad_threshold`, number 0.0–1.0, default 0.5 (más bajo = más sensible). |
| `min_silence` | **CONFIRMADA (con matiz)** | Existe (ms), pero default es **adaptativo**, y fijarlo DESACTIVA el pacing adaptativo y la espera de entidades (advertencia oficial). Sin rango publicado (NOT IN DOCS). |
| `max_silence` (no estaba en el brief) | CONFIRMADA | ms, default adaptativo, mismo warning. |
| `interrupt_response` | **CONFIRMADA** | Boolean, default **`true`** (barge-in ya viene activado; `false` lo desactiva). Además existe `interruption_delay` (0–1000 ms, default por transcription_mode). |
| "low vad_threshold + high min_silence para pausas largas" | **PARCIALMENTE CORREGIDO** | La docs recomienda NO fijar min/max_silence y confiar en el turn detection semántico adaptativo; para esperas más pacientes el knob recomendado es `transcription_mode: "max_accuracy"`. Tunear thresholds = "last resort". |
| 'no official npm SDK' | **CONFIRMADA (de facto)** | No hay SDK npm/pip para Voice Agent; docs y starters oficiales usan WebSocket crudo (JS: cero dependencias; Python: solo stdlib). |
| Mensajes tipo "begin" / "session created" | **CORREGIDO** | El config se llama `session.update`; el ack es `session.ready` (no `session.created`); transcripts son `transcript.user` / `transcript.agent`; audio del agent llega como `tool.call`→`reply.audio` events. |
| Tool result como objeto JSON | **CORREGIDO** | `tool.result.result` es un **string JSON**; `tool.call.arguments` sí es un dict. Y hay que enviarlo cuando `reply.done` es el último evento. |
| TTL/body del token | **PRECISADO** | Es `GET` (no POST), params en query string: `expires_in_seconds` 1–600, `max_session_duration_seconds` 60–10800 (default 10800). Single-use. |

---

## Rate limits & pricing

Fuentes: https://www.assemblyai.com/docs/billing-and-pricing , https://www.assemblyai.com/products/voice-agent-api , https://www.assemblyai.com/docs/streaming/rate-limits (Streaming STT, NO voice agents)

- **Precio Voice Agent: $4.50/hora flat** (STT+LLM+TTS en una conexión), prorrateado **por segundo** de sesión. El starter JS usa `4.5/3600` $/s como constante.
- **Facturación por tiempo de WebSocket ABIERTO** (no por audio hablado): el silencio/idle se factura; cerrar sin `session.end` deja 30 s de grace window **billable**. Duración máx por sesión: 3 h (10800 s, configurable vía token).
- **Crédito gratis: $50** para cuentas nuevas, aplicable a Voice Agent API (también STT pre/real-time, Speech Understanding, Guardrails). No expira.
- LLM Gateway (BYO LLM tipo Claude vía gateway) se factura aparte por tokens y **NO** está cubierto por los $50.
- Rate limits específicos de Voice Agent: **no hay página dedicada** (NOT IN DOCS). Señales disponibles: errores WS retryables `at_capacity` y `concurrency_exceeded` ("Your account's concurrent-session limit"); límite visible en el dashboard (Rate Limits page). Referencia Streaming STT (otro producto): 5 sesiones nuevas/min en free, 100+ en paid, auto-scaling +10%/min al pasar 70% de uso.
