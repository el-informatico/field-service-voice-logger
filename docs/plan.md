# Plan D1–D6 — AssemblyAI Voice Agent Hackathon (cierre 30-sep-2026 15:00 UTC)

Fuente: brief interno del 2026-09-15 + memo de evaluación del autor (workspace
local privado, fuera de este repo).
Sprint real: arrancar 24–25 sep. **Hoy (15-sep) es fase pre-sprint** — ver `STATUS.md`.

| Día | Entregable | Notas |
|---|---|---|
| **D1** | Repo Apache-2.0 + Vercel + endpoint de token temporal + WebSocket crudo en navegador + datos sembrados + prompt v1 del entrevistador | Ya adelantado hoy: repo, datos, esqueleto WS+tools, token endpoint (mock), harness. D1 = encender lo real con API key. |
| **D2** | Tools completas + afinar turn-taking + 5 sesiones con guion | Corregido con docs reales (15-sep): `vad_threshold` bajo; `min_silence`/`max_silence` son **adaptativos por defecto** — NO fijarlos a mano salvo experimento (mataría el pacing adaptativo); probar `transcription_mode: "max_accuracy"` para pausas largas; `interrupt_response` ya viene true; ajustar `interruption_delay`. **GATE: si hoy no converge el turn-taking con ruido de fondo → Plan B inmediato** (Voice Incident Reporter, comparte ~70% del código). No seguir invirtiendo en esta ruta. |
| **D3** | UI de sesión (transcripción viva + ficha rellenándose + confirmación hablada + edición ligera) | **Freeze de alcance: nada nuevo después de D3.** |
| **D4** | Harness de métricas corriendo con sesiones reales + export PDF/CSV + prueba con ruido (DEMAND/MUSAN a SNR fijo) | El harness existe desde hoy; D4 = llenarlo con sesiones reales y publicar números. |
| **D5** | Deploy público + pantalla de consentimiento + borrado de audio post-sesión + prueba real en móvil con auriculares con mic | |
| **D6** | Video <5 min EN (20s dolor → 3 min roleplay → ficha+export → 40s arquitectura/business value) + README con métricas y diferenciación vs Relay + **submit con horas de margen** | La ventana manual de 6h exige aprobación previa del organizador. Antes de grabar: re-chequear galería (Relay/QuoteReady/nuevas — ver docs/research/). |

## Recortes explícitos (fuera de alcance)
Integración FSM real (mock + export), app nativa, fotos/OCR, offline, multi-idioma,
login/roles, wake word, analíticas, diarization, retención de audio crudo,
benchmark WER externo.

## Métricas a publicar (= el producto)
Accuracy por tipo de campo vs GT · precision/recall del loop de confirmación ·
latencia fin-de-habla→tool call y →respuesta (p50/p95, N≥30) · WER limpio vs
+ruido · barge-in respetado vs robado. Definiciones exactas: `docs/architecture.md §8`.

## Señales de alarma
- Sesiones que derivan a dictado→resumen (descalifica en espíritu).
- Agente hablando encima del técnico (latencia/barge-in rotos).
- D2 termina sin turn-taking afinado → Plan B YA.
- Citar "Universal-3 Pro" en el video (el nombre actual es Universal-3.5 Pro;
  el Voice Agent API ni publica el modelo subyacente — no citar modelo).
