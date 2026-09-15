# data/ — semilla del Field Service Voice Logger

- `ordenes.json` — 10 órdenes mock (OT-1001..OT-1010): 5 HVAC + 5 eléctrico, pymes mexicanas (panadería, taller, hotel, escuela, planta de plásticos...). Esquema §4 de `docs/architecture.md`.
- `piezas.json` — 25 piezas con alias/jerga (con y sin acentos) para matching tolerante. Esquema §5.
- Pares confundibles deliberados (campo `confundible_con`): válvula 3/4" ↔ 3/8" ↔ 1/2", capacitor 35+5 ↔ 45+5 µF, breaker 20 ↔ 30 A, manguera 1/2" ↔ 5/8", contactor 30 ↔ 40 A, cable cal. 12 ↔ 14. Son el corazón del demo: el read-back hablado ("¿decías la válvula de tres cuartos o de tres octavos?") es lo que atrapa la captura equivocada.
- `guiones/` — 3 guiones (s1 camino feliz, s2 pieza mal oída con error sembrado, s3 barge-in con 3 interrupciones provocadas). Turnos `user` con `expect` (tool/readback/none) y `note` como acotación de escena; turnos `agent` solo con `hint`.
- `ground-truth/gt-<scenario_id>.json` — ficha de referencia por guion: `expected_form` (lo que una sesión perfecta termina), `user_utterances` (referencia WER = turnos user del guion, verbatim), `seeded_errors` (solo s2/s3) y `provoked_interruptions` (s3).
- Mapeo: cada GT comparte `scenario_id`/`order_id`/`noise_condition` con su guion; los SKUs de `expected_form.piezas` y de `seeded_errors` existen en `piezas.json`.
- Validación: `node data/validate.js` — parsea todo, checa integridad referencial (SKUs, order_ids, user_utterances ↔ turnos) y sale 1 si algo falla.
