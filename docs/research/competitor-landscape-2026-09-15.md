# Competitor landscape — AssemblyAI Voice Agent Hackathon (lablab.ai)

- **Fecha de auditoría:** 2026-09-15 (primera auditoría formal registrada; no existe auditoría previa en este repo con la que comparar).
- **Estado del hackathon al auditar:** "Live · Submissions open". 3.053 participantes, 831 equipos, **61 submissions** (+6 el día de hoy), 45 drafts en progreso. Fechas: Sep 1–30, 2026; $10.000 en premios.
  - Fuente: https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/live

## Método y herramientas (qué funcionó y qué no)

| Método | Resultado |
|---|---|
| `mcp__fetch__fetch` sobre páginas de apps | FALLA — devuelve solo el shell JS ("© 2026 NativelyAI Inc. … 3.64.0"). Sirvió únicamente para el texto introductorio de la página principal del hackathon. |
| `mcp__ddg-search__fetch_content` (backend por defecto) | **FUNCIONÓ** — método principal. Extrajo el texto completo de las páginas de apps (`/ai-hackathons/assemblyai-voice-agent-hackathon/<team>/<app>` y `/submissions/<id>`) y el dashboard `/live` (incluye top-10 por votos). |
| `mcp__ddg-search__fetch_content` con `backend:"curl"` | NO DISPONIBLE — el servidor MCP no tiene `curl_cffi` instalado. |
| `mcp__ddg-search__fetch_content` con `parse_mode:"main"` | No añadió nada (probado en AutoCopilot; la página se renderiza solo client-side). |
| `mcp__ddg-search__search` | FUNCIONÓ (con detección de bots intermitente en algunas frases). OJO: los snippets de DDG a veces vienen **contaminados** — un snippet de "home-service intake" apareció bajo la URL de Radio Universe, cuya página real es una radio IA. No confiar en snippets solos. |

**No verificable con estas herramientas:**
- La lista completa de las 61 submissions (el "Load more" de `/live` requiere JS/API; solo el top-10 por votos está server-rendered). Se identificaron ~34 títulos vía búsquedas + sidebar "Explore more".
- Los hrefs reales de Github/Presentation/Demo de cada app (el texto aplanado no conserva URLs).
- El texto completo de la página de AutoCopilot (ver abajo).

**Links usados:**
- Gallery/live: https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/live y https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon
- Relay: https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/relay/relay-voice-operations-for-field-work
- QuoteReady: https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/quoteready/quoteready
- Otros (ver sección 3, cada uno con su URL).

---

## 1. Relay (colisión directa)

**Página:** https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/relay/relay-voice-operations-for-field-work
**Creada:** 2026-09-02, equipo "Relay". Herramienta listada: Vercel. Tags: "Agent Builder track - The INTERNET OF AGENTS", "Productivity". Links: Github, Presentation, Demo (hrefs no extraíbles).

### Qué construyeron (sus palabras)

- **Pitch:** "Relay turns one spoken field report into verified operational work." Contexto: "Field technicians often work around moving equipment, safety hazards, protective gear, and time pressure. Their hands and eyes are needed on the job, yet reporting a single incident can require navigating several disconnected systems. Most voice tools only transcribe what was said or complete one simple action."
- **Flujo:** un técnico describe un incidente ("a cooling control failure on asset H21"); "Relay uses an AssemblyAI Voice Agent session to understand the incident, inspect the asset history, check parts inventory, create a work order, and notify the appropriate supervisor."
- **Diferenciador declarado ("Relay Recovery"):** "When a connected operation fails, Relay does not hide the error or pretend the workflow succeeded. It changes the execution plan." En el demo, el fusible no está en inventario local → busca en "Central Stores", arma transferencia, crea work order que espera la transferencia, notifica a "Priya Shah". "The failed local inventory step remains visible alongside the verified recovery route."
- **Posicionamiento explícito contra nuestro carril:** "Relay is not a voice form filler. It is a voice operations agent that executes work, handles exceptions, and proves every outcome. Speak once. Keep moving."
- **Stack:** "Next.js, React, TypeScript, a live AssemblyAI Voice Agent WebSocket, typed server operations, and optional Supabase persistence. A single orchestration tool coordinates asset history, inventory, transfers, work orders, and supervisor notifications."

### Checklist

| Pregunta | Veredicto | Evidencia |
|---|---|---|
| ¿Loop de confirmación hablada con read-back de datos capturados ("did you say 3/4 valve?") | **NO VISIBLE** | La página nunca describe que el agente lea en voz alta los valores capturados para confirmarlos. El "verified"/"proves every outcome" se refiere a resultados de ejecución del workflow (inventario, transferencias), no a read-back de datos. Fuente: página de Relay (URL arriba). |
| ¿Ficha/work order en vivo con trazas auditables / timeline | **NO VISIBLE (parcial: traza de ejecución)** | Crean el work order vía herramienta de orquestación y mantienen visible el paso fallido ("The failed local inventory step remains visible alongside the verified recovery route") — eso es una traza de pasos de ejecución, no una ficha que se llena en vivo con trazas por campo ni timeline de documentación. |
| ¿Accuracy de extracción medida y publicada | **NO** | Cero métricas en la página. Ningún número (ni %, ni dataset, ni nº de tests). |
| ¿Export (PDF/CSV) | **NO VISIBLE** | Ninguna mención a exportación; el work order vive dentro del sistema. |
| ¿Pruebas con ruido/latencia | **NO** | El ruido de campo aparece solo como motivación ("moving equipment, safety hazards"), no como test. Ninguna prueba de latencia mencionada. |

### Qué NO cubren (espacio que dejan libre)

- Read-back hablado de los datos capturados antes de comprometer el registro.
- Métricas de exactitud de extracción (no publican ninguna).
- Export a formatos de entrega (PDF/CSV).
- Pruebas bajo ruido industrial / latencia.
- UX de form-filling con auditoría por campo — explícitamente renunciado: "Relay is not a voice form filler."

---

## 2. QuoteReady

**Página:** https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/quoteready/quoteready
**Creada:** 2026-09-08, equipo "QuoteReady". Herramienta listada: Codex. Tags: "Voice Assistant". Links: Github, Presentation, Demo.

### Qué construyeron (sus palabras)

- **Pitch:** intake telefónico de 5 datos para presupuestos de servicio: "A service professional cannot assess a vague quote request without asking what work is needed, which equipment is involved, where the job is, what access is available and when the caller prefers. QuoteReady gathers those five details through an AssemblyAI voice conversation and prepares a draft the caller can inspect."
- **Trazas por respuesta:** "Each answer retains supporting transcript evidence. Unknown answers and refusals stay explicit. A correction invalidates the previous review, and the caller must approve the current version before downloading a JSON request."
- **Alcance acotado (honesto):** "The prototype does not price, book, email or promise a callback." App pública protegida por "private reviewer invitation code and three-minute session limits".
- **Evidencia de test (2026-09-08):** "the public browser completed all five fields using synthesized fictional speech, corrected Friday afternoon to Monday morning and downloaded the reviewed draft. The 64-second recording shows actual AssemblyAI replies, transcripts and app state through the corrected readback; approval/download was verified separately." Y: "All 26 affected local tests passed."
- **Límites declarados:** "Broader real-speaker and interruption evaluation is still future work." / "No customer adoption, revenue or time savings are claimed."
- **Stack:** "JavaScript/Node.js app uses temporary server-issued tokens, WebSocket audio, Web Audio resampling and client-side function tools."

### Checklist

| Pregunta | Veredicto | Evidencia |
|---|---|---|
| ¿Loop de confirmación hablada con read-back? | **SÍ (en su dominio: intake de llamada entrante)** | "…app state through the corrected readback" + "the caller must approve the current version before downloading". El read-back existe y quedó grabado en su demo de 64 s. Es un caller (cliente) aprobando 5 campos de una solicitud de presupuesto — NO un técnico documentando un trabajo. |
| ¿Ficha en vivo con trazas auditables? | **SÍ (draft de 5 campos con evidencia por respuesta; sin "timeline" como tal)** | "Each answer retains supporting transcript evidence. Unknown answers and refusals stay explicit. A correction invalidates the previous review." No describen timeline/historial visual, ni ficha de orden de trabajo. |
| ¿Accuracy de extracción medida y publicada? | **NO** | Publican un test funcional narrativo (5 campos, 1 corrección, 64 s, "26 local tests passed") pero ninguna métrica de exactitud (sin %, sin dataset, sin tamaño de muestra). Evaluación con hablantes reales: "still future work". |
| ¿Export? | **PARCIAL** | Solo JSON ("downloading a JSON request"). Sin PDF ni CSV. |
| ¿Pruebas con ruido/latencia? | **NO** | Test con "synthesized fictional speech"; sin ruido ni latencia. |

**Nota:** QuoteReady es el vecino conceptual más cercano al wedge en *forma* (read-back + evidencia + aprobación), pero en *dominio* es intake de llamadas entrantes de clientes para presupuestos — no logging de técnico en campo ni orden de trabajo.

---

## 3. Otras submissions relevantes (colisión/adyacencia)

### Colisión potencial en campo/servicio

- **AutoCopilot** (team phantom-grid) — https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/phantom-grid/autocopilot
  Snippet indexado: "mission-critical Voice AI diagnostic copilot engineered for industrial commercial fleet operators and technicians. When heavy-duty haulers and logistics vehicles face unexpected engine or powertrain malfunctions on highways, inspecting 500-page paper service manuals or manually entering Diagnostic Trouble Codes (DTCs) while operating is hazardous and impractical."
  **NO VERIFICABLE más allá del snippet**: la página devuelve shell vacío con los tres métodos de fetch (default, parse_mode main, raw). Dominio = diagnóstico para técnicos de flota (¿copilot de consulta, no logger documental?). Read-back/audit/export/métricas: no verificable.
- **KiaOra Dispatch** (team shinydatatech) — #3 por votos (50). Solo visible en el top-10 de /live: https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/live . El nombre sugiere dispatch (posible adyacencia field-service). **No se encontró su página ni descripción — no verificable.**
- **Siberia Voice Agent** (Frantal Company) — #2 por votos (90). Mismo origen (/live). **No verificable.**

### Adyacentes en "confirmación hablada" / "verificación"

- **AegisOR** (2026-09-13, team AegisTeam) — https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/testteam/aegisor
  Plataforma de compliance de quirófano. OJO: "the system actively monitors surgical team communication to identify verbal orders, **verifying closed-loop read-backs and confirmations**" y "All compliance data, time-stamps, and safety metrics are compiled into an **export-ready audit trail** compatible with electronic health record systems". Es decir: read-back verificado + traza de auditoría exportable — pero como monitor ambiental del equipo quirúrgico, no como formador de fichas por voz. "Pinpoint acoustic accuracy" es lenguaje de marketing sin números. Sin métricas publicadas, sin pruebas de ruido.
- **Voice Action Gate** (2026-09-03) — https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/voice-action-gate/voice-action-gate
  Banca. "an irreversible action … can only execute when the transcript evidence is strong enough to mint a one-time confirmation credential"; argumento: "Accuracy is an asymptote: it never reaches a point where executing an irreversible action on a guess is acceptable." Gate por testigos en el transcript a nivel de palabra. Sin form/orden de trabajo, sin métricas publicadas. Concepto transferible: es el argumento teórico a favor de NUESTRO read-back.
- **FarmVoice** (2026-09-07, 3 votos) — https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/farmvoice-ai/farmvoice-ai-voice-agent
  Invernaderos. Flujo "Understand → Assess → Prioritize → **Confirm** → Act → **Verify** → Report"; "medium- and high-impact actions require farmer confirmation"; "checks the actual farm state before reporting success". Confirmación hablada de ACCIONES sobre equipos, no de datos capturados ni documentación. Sin métricas, sin export.
- **AuraCommand** (2026-09-08) — https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/auracommand/auracommand-autonomous-voice-ops-agent
  DevOps/SRE: "bi-directional voice loops, where **execution confirmations are synthesized into vocal feedback** via text-to-speech, allowing true eyes-free operation" + "real-time Streamlit operations ledger". Confirmación hablada de ejecución + ledger — dominio cloud ops, no field service.

### Adyacentes en "documentación con evidencia" (patrón EvidenTurn/QuoteReady)

- **EvidenTurn** (2026-09-13) — https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/evidenturn/evidenturn
  Quejas de consumo. "**links extracted facts to final transcript turns, keeps supported corrections visible**, asks for missing information and **exports Markdown/JSON**". AssemblyAI Realtime STT v3 + word timings; motor determinista sin LLM. Honestidad notable: "HarborHome Repairs was misheard as Harbour Rome Repairs. We preserved that error and its low-confidence words; the case stayed Draft without confirmation." Sin read-back hablado (correcciones "typed"), sin métricas de accuracy, sin ruido.
- **Voicemed-AI-Agent / "Aria"** (2026-09-02, team RN) — https://lablab.ai/submissions/j5loijjfhr0cqe42adavmm3q
  Triaje médico por voz: "a **SOAP note with ICD-10 codes that you can download** at the end", dashboard con "live transcript, a progress tracker", "44 automated tests", score ESI determinista. Documentación médica descargable + transcript en vivo. Sin read-back de datos, sin métricas de exactitud publicadas.
- **Snippet huérfano (no atribuible):** DDG indexó la descripción "A voice intake assistant that turns vague home-service enquiries into reviewable request drafts, with transcript evidence, corrections and clear follow-up gaps. Built with the AssemblyAI Voice Agent API" — apareció bajo la URL de Radio Universe (https://lablab.ai/submissions/pglgv0m96bi9ij5es21f2m4z), pero la página real de esa URL es una radio IA participativa. La descripción pertenece a OTRA submission no identificada del hackathon. **No verificable a qué app pertenece** — posible tercer miembro de la familia "intake con evidencia".

### Top-10 por votos de la comunidad (fuente: /live, 2026-09-15)

| # | Título | Equipo | Votos |
|---|---|---|---|
| 1 | SAUTI AI: Voice-to-Action | KISII UNVERSITY CODE UNION | 110 |
| 2 | Siberia Voice Agent | Frantal Company | 90 |
| 3 | KiaOra Dispatch | shinydatatech | 50 |
| 4 | MockMate — AI Voice Interview Coach | Twin MASTERS | 50 |
| 5 | EchoExaminer: Real-Time AI Voice Mock Examiner | Sahariar-Dev | 40 |
| 6 | FarmVoice - AI Voice Agent | FarmVoice AI | 30 |
| 7 | STICK | Ninjas2 | 0 |
| 8 | Liora | Bloodfang Ronin | 0 |
| 9 | RevenueFlow: WhatsApp voice receptionist | RevenueFlow | 2 |
| 10 | Brand Studio Agent — Build Your Brand by Voice | VibeMarketing Studio | 1 |

SAUTI AI (#1) verificado: https://lablab.ai/submissions/wuy4gg5ku6s8pnxb32up5lh7 (2026-09-04) — reporte comunitario por voz ("broken water pipe outside Kisii University") → "structured incident report" con nº de referencia a dashboard. Cívico, no field service; sin read-back, sin métricas, sin export declarados.

### Resto de submissions identificadas (título — URL — una línea)

- VoiceDesk AI — https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/assembly-voice/voicedesk-ai — helpdesk por voz con avatar y screen-share (snippet).
- VoiceBridge AI — https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/uganda-cranes/voicebridgeai — control de dashboard web por voz para usuarios con discapacidad visual/motora (snippet).
- LineOne — https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/juice-lineone/lineone — prototipo de voz enfocado en UX directa (snippet).
- Voice Language Partner — https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/talksolo/voice-language-partner — práctica de idiomas conversacional (snippet).
- Interview Lab — https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/interview-lab/interview-lab — coach de entrevistas habladas (snippet).
- Voice-Controlled Robot Arm — https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/vibes/voice-controlled-robot-arm — asistente de instrumentos quirúrgicos por voz (snippet).
- VoiceSort: language-conditioned bimanual SO-101 — (sidebar /live y apps) — brazos robóticos por comando de voz (MMHV).
- AI Bimanual Table Assistant — (sidebar) — manipulación bimanual por lenguaje natural (AIForge Labs).
- SpokeUI: Point, Speak, Ship UI Changes — (sidebar, KPSX Studio) — editar UI web hablando.
- Voice Order Support Agent — interrupt it any time — (sidebar) — estado de pedidos con memoria de interrupciones.
- ARIA: Real-Time Voice AI Assistant — https://lablab.ai/submissions/us8glaiyal91pwiyuo9ijbmx — asistente browser sobre Voice Agent API (snippet).
- VoxSales AI Voice Agent — https://lablab.ai/submissions/oz865bkxbhix8fw6ce1pr0zl — ventas con CRM en vivo, bilingüe (snippet).
- KT — The AI Tutor You Talk To — https://lablab.ai/submissions/k2pow6raxh6ygv15w3zyk35j — tutor hablado (snippet).
- Radio Universe: Radio You Can Talk To — https://lablab.ai/submissions/pglgv0m96bi9ij5es21f2m4z — radio IA participativa (verificado: NO es intake home-service).
- "Hackathon project" (team Evention) — (sidebar) — placeholder/spam.
- MockMate / EchoExaminer / STICK / RevenueFlow / Brand Studio Agent / Liora — top-10 arriba (Liora snippet: inventario físico del hogar por voz).

**Total identificado: ~34 de 61.** Las ~27 restantes no son enumerables con estas herramientas (JS "Load more" + API inaccesible). Equipos con idea publicada pero sin submission visible: Voice of the Machine, AIgnite, NINA, TalkLabs, Voxel, Voice Studio, ASH (compliance listener), Sauti Duka KE (voice OS para dukas kenianas), SawtAI.

---

## 4. Veredicto para el re-wedge

**El wedge "documentary-quality logger: spoken confirmation loop + auditable live form + measured & published extraction accuracy" EN EL DOMINIO FIELD-SERVICE/WORK-ORDER sigue LIBRE (UNCLAIMED) en lo visible hoy 2026-09-15 — pero solo como combinación; los elementos individuales ya tienen dueños parciales en dominios vecinos.**

Por elemento:

1. **Spoken confirmation loop con read-back de datos:** el patrón existe y está poblado — QuoteReady (read-back + aprobación del caller, presupuesto), AegisOR ("verifying closed-loop read-backs", quirófano), FarmVoice (Confirm→Verify en equipos de invernadero), AuraCommand (confirmación vocal de ejecución, DevOps), Voice Action Gate (gate por evidencia de transcript, banca). **Nadie** lo aplica a un técnico documentando una reparación con read-back de valores capturados. Relay, el único field-service real verificado, se posiciona explícitamente EN CONTRA: "Relay is not a voice form filler" — nos deja el carril documental por declaración propia.
2. **Ficha en vivo con trazas auditables:** QuoteReady y EvidenTurn ya hacen "evidence-linked draft con correcciones visibles" en presupuesto/quejas de consumo; AegisOR hace audit trail timestamped exportable en quirófano. En field service/work order: nadie visible.
3. **Accuracy de extracción medida y publicada: CERO submissions la publican.** Es el elemento más libre de todo el hackathon. Lo más cercano: QuoteReady (test funcional narrativo, "Broader real-speaker and interruption evaluation is still future work"), EvidenTurn (divulgación honesta de UN error de reconocimiento, sin métrica), Voicemed ("44 automated tests", sin exactitud). Nadie publica % accuracy / dataset / matriz de confusión / robustez a ruido.
4. **Extras libres:** export PDF/CSV (nadie; solo JSON [QuoteReady], MD/JSON [EvidenTurn], descarga de SOAP note [Voicemed]) y pruebas de ruido/latencia (nadie).

**Riesgos/advertencias:**
- La galería se mueve rápido: +6 submissions HOY; EvidenTurn y AegisOR (los dos "evidence/audit" más sofisticados) entraron el 2026-09-13. El patrón "intake con evidencia + correcciones + export" ya tiene al menos 2-3 implementadores (y un snippet huérfano de "home-service enquiry intake" no atribuible) — la forma se está commoditizando; nuestra defensa debe ser el DOMINIO (field service/work order + ruido industrial) y la MÉTRICA publicada, no la forma.
- AutoCopilot (técnicos de flota) y KiaOra Dispatch ("dispatch") no pudieron verificarse — revisar de nuevo antes del pitch final; si AutoCopilot resulta documentar reparaciones, la colisión sube.
- Cambios vs "última auditoría 2026-09-15": esta ES la primera auditoría (no hay benchmark previo en el repo). Baseline queda fijado aquí: 61 submissions, Relay sin read-back/métricas/export, QuoteReady con read-back en intake de presupuestos, nadie con accuracy publicada.
