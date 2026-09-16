# Contrato del dominio INCIDENTE (Plan B — Voice Incident Reporter)

> Vinculante para data/, web/js/domain/, metrics/ y scripts/ del pivote.
> El 70% compartido NO se toca: ws-agent, session-engine (vocabulario de
> eventos idéntico), artefacto §6 (misma forma; solo cambia `final_form`),
> canal mock/real, export, harness. El diseño ELIMINA el modo de fallo del
> gate: dictado corto POST-VISITA en AMBIENTE TRANQUILO (sin tuning anti-ruido).

## 1. Caso de uso

Un operador/técnico, terminada la visita, dicta en 60–120 s qué pasó. El agente
entrevista brevemente, estructura la nota y **confirma en voz alta los campos
críticos** (severidad, servicios afectados, horas del timeline) con read-back.
Salida: ficha de incidente auditable + artefacto §6 → métricas.

## 2. final_form (incidente)

```json
{
  "incidente_id": "IC-2001",
  "resumen": "…una línea…",
  "que_paso": "…texto del operador, sin parafrasear…",
  "timeline": [ { "hora": "09:20", "evento": "…" } ],
  "servicios_afectados": [ { "id": "SRV-WEB-PROD", "confirmado": true } ],
  "action_items": [ "…" ],
  "severidad": "alta",
  "estado": "enviada"
}
```

## 3. data/incidentes.json (8 semillas)

`{ id: "IC-2001"…"IC-2008", cliente, sitio, equipo?, reporte_inicial, tecnico,
categoria: "TI"|"facilities", estado: "abierta", creada }` — mezcla TI (caída de
servicio, rack, red) y facilities (bomba, elevador, eléctrico).

## 4. data/servicios.json (~15, con pares confundibles)

`{ id: "SRV-WEB-PROD", nombre, alias[], tipo, confundible_con: ["SRV-WEB-STG"] }`
Pares confundibles OBLIGATORIOS: WEB-PROD↔WEB-STG, RACK-A3↔RACK-A8,
BOMBA-PRIMARIA↔BOMBA-SECUNDARIA, CORREO-PROD↔CORREO-Backup. El `enum` de
servicio valida contra estos ids (el par confundible dispara read-back de
desambiguación — MISMO mecanismo que válvulas 3/4↔3/8).

## 5. Tools (8) — mismo formato function-tool que tools.js

| Tool | Params | Efecto |
|---|---|---|
| `get_incidente` | `{}` (orden activa de sesión) | Devuelve el incidente activo |
| `set_resumen` | `{texto}` | Fija el resumen (1 línea) |
| `set_que_paso` | `{texto}` | Narrativa literal del operador |
| `buscar_servicio` | `{consulta}` | Búsqueda tolerante + `confusable_warning` |
| `agregar_servicio_afectado` | `{id: enum(servicios), afectados?: int}` | Agrega + read-back |
| `agregar_evento_timeline` | `{hora: "HH:MM", evento: string}` | Hora validada por regex `^\d{1,2}:\d{2}$` + read-back de la hora |
| `agregar_action_item` | `{descripcion}` | Lista de pendientes |
| `enviar_reporte` | `{}` | Cierra (estado=enviada) |

`set_severidad {severidad: enum(baja|media|alta|critica)}` es la 9ª tool y
SIEMPRE dispara read-back de confirmación.

## 6. Guiones (3) + GT — data/guiones-incidente/, data/ground-truth-incidente/

Mismo formato que los de orden (turns user/agent, `expect`, notas) + GT:
`{ scenario_id, incidente_id, ambiente: "tranquilo", expected_form (§2),
user_utterances[], seeded_errors[], provoked_interruptions[] }`.
- `i1-dictado-feliz`: dictado completo, confirmaciones a la primera.
- `i2-servicio-confundido`: operador dice "el servidor web de producción" →
  captura inicial SRV-WEB-STG (as_heard) → read-back de desambiguación rescata.
- `i3-correccion-hora`: "a las nueve veinte" capturado 9:20→"no, era 9:40" +
  1 interrupción provocada ("espera—").

## 7. Métricas por campo (extiende metrics/, additive)

- `resumen`, `que_paso`: similitud ≥0.8 (igual que problema/solución).
- `servicios_afectados`: set P/R/F1 sobre (id) exactos — igual que piezas.
- `timeline`: match si hora exacta Y evento sim ≥0.6; P/R/F1.
- `action_items`: recall por cubrimiento (ítem GT con sim ≥0.6 en algún predicho).
- `severidad`: exacta.
Loop de confirmación / WER / barge-in / latencia: SIN CAMBIOS (mismo artefacto).

## 8. Smoke + CI

`web/js/smoke-incidente.mjs` (headless, 3 guiones → artefactos → invariante de
ficha vs GT) + `npm run smoke:mock` ejecuta AMBOS smokes (orden E incidente).
`data/validate-incidente.js` + `npm run selftest` lo incluye.
`scripts/realgate.mjs --domain incident` apunta a guiones-incidente (wav base
.data/tts-incidente/, SIN mezclas de ruido).
