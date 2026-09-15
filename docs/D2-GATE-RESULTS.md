# D2 GATE — Resultados reales (2026-09-15, sesiones contra el Voice Agent API)

Driver: `scripts/realgate.mjs` (WS real, token temporal, wavs TTS del guion a
ritmo real, DEMAND a SNR fijado post-mezcla; interrupciones provocadas según
guion s3). Evaluador: `scripts/gate-eval.mjs`. Criterios pre-registrados en
`docs/D2-GATE.md`: C1 turnos ≥90% · C2 falsos cierres ≤1/sesión @10dB ·
C3 barge-in respetado ≥2/3 · C4 WER limpio ≤0.10.

## Tabla de sesiones (N=16 reales, ~$4.2 de crédito)

| Label | Guion | Condición | vad | C1 | C2 | C3 | WER(matched) | tools |
|---|---|---|---|---|---|---|---|---|
| T0a4 | s1 | clean | 0.4 | 0.90 | 0 | — | **0.080** ✓ | 4 |
| T0a3 | s1 | clean | 0.4 | 1.00* | 0 | — | (1.172 crono; emparejamiento) | 7 |
| T1a | s1 | DKITCHEN 10dB | 0.4 | 0.90 ✓ | 0 ✓ | — | **0.088** ✓ | 4 |
| T1b | s1 | SPSQUARE 10dB | 0.4 | 0.80 ✗ | 0 ✓ | — | 0.101 ✗ | 6 |
| T1c | s1 | OOFFICE 10dB | 0.4 | 0.80 ✗ | 0 ✓ | — | 0.251 ✗ | 0 |
| T2 | s1 | OOFFICE 10dB | **0.5** | 0.90 ✓ | 0 ✓ | — | **0.092** ✓ | 0 |
| T3 | s1 | OOFFICE 10dB | 0.3 | 0.80 ✗ | 0 ✓ | — | 0.097 ✗ | 6 |
| T6 | s1 | OOFFICE 10dB | 0.5 max_acc | 0.90 ✓ | 0 ✓ | — | 0.172 ✗ | 4 |
| C1a | s2 | OOFFICE 10dB | 0.5 | 0.89 ✗ | **2 ✗** | — | 0.229 ✗ | 2 |
| C1b | s2 | OOFFICE 10dB | 0.5 | 0.89 ✗ | **2 ✗** | — | 0.165 ✗ | 2 |
| T7 | s2 | OOFFICE 10dB +near-field | 0.5 | 0.89 ✗ | **2 ✗** | — | 0.234 ✗ | 2 |
| CDk-s2 | s2 | DKITCHEN 10dB | 0.5 | **1.00 ✓** | **2 ✗** | — | 0.205 ✗ | 2 |
| C3a | s3 | OOFFICE 10dB | 0.5 | 0.89 ✗ | **3 ✗** | 1/3 reg. ✗ | 0.189 ✗ | 1 |
| CDk-s3 | s3 | DKITCHEN 10dB | 0.5 | 0.89 ✗ | **4 ✗** | 0/3 reg. ✗ | 0.203 ✗ | 0 |

(*) pairing cronológico sensible a splits; ver nota.

## Lectura

- **Transporte LIMPIO converge**: C1 0.90, C2 0, WER 0.080 — el agente real
  entrevista, llama tools (hasta 7/sesión), confirma por read-back y llena la
  ficha GT-exacta en limpio (T0a3: ambas piezas correctas).
- **Ruido MECÁNICO a 10dB aguanta en s1** (DKITCHEN: 0.90/0/0.088) pero se
  rompe en guiones de turnos largos (s2/s3): el VAD CIERRA el turno a mitad
  (falsos cierres 2-4 por sesión — autopsia: splits de turnos largos en las
  pausas, no disparos fantasma).
- **Babble multi-hablante (OOFFICE) es el peor caso**: WER 0.17-0.25 y colapso
  del diálogo. `voice_focus: near-field` NO lo mitigó (T7 ≡ C1b).
- **Barge-in provocado no converge**: 1/3 y 0/3 interrupciones registradas —
  bajo ruido el agente responde menos y las interrupciones no aterrizan.
- La obediencia de tools del LLM cae con ruido (7→0-2 calls/sesión).

## VEREDICTO: **GATE FALLA → PLAN B (Voice Incident Reporter)**

C2 falla en TODAS las confirmatorias a 10dB (2-4 > 1) y C3 no alcanza 2/3.
Los criterios eran pre-registrados; no se mueven post-hoc. Per brief D2:
"No seguir invirtiendo en esta ruta". El pivote CONSERVA ~70% (WS plumbing,
tools, engine, artefacto, métricas, export) y DISEÑA FUERA el modo de fallo:
notas de incidente cortas dictadas post-visita en ambiente tranquilo —
el diferencial (read-back + accuracy medida) sobrevive.
