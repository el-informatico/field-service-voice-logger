# Sample session artifacts — real API runs (N=10 evidence + post-audit R6a)

Three of the ten real sessions behind the README §Metrics table, plus one
post-audit session, committed verbatim from the measurement rig's local output
directory (`.data/gate/`, which stays untracked — audio-free JSON only,
`audio_retained: false` in every artifact). Picked to back the claims a judge
is most likely to probe:

| Artifact | Session | Why it's here |
|---|---|---|
| `artifact-i3-correccion-hora-tranquilo-R3a.json` | `gate_R3a_mu3gpdbt` | The barge-in measurement: designed interrupt at the hour-correction turn, reply cut 9,034 ms after speech start (`interrupt_response: true`) — the honest 0/3 row. |
| `artifact-i2-servicio-confundido-tranquilo-R5b.json` | `gate_R5b_mu48vq6n` | The honest failure: v4 session hit the 300 s driver watchdog, lost its final (severity-correction) turn, and ends `en_proceso` — documented, not hidden. |
| `artifact-i4-mixto-tranquilo-R5d.json` | `gate_R5d_mu496kdf` | The seeded capture-error rescue: rack A8 captured, disambiguation read-back naming both catalog services, A3 confirmed — precision row 12 TP / 0 FP in dialogue form. |
| `artifact-i1-dictado-feliz-tranquilo-R6a.json` | `gate_R6a_mubqxfph` | The completed send, post-audit: the N=10 "0/10 reached `enviar_reporte`" was a driver close-out race (the final reply, ~1.5 s to open, died with `session.end`), fixed in `scripts/realgate.mjs`. Same script i1, same prompt v4, fixed rig: 23 tool calls ending in `enviar_reporte` → `final_form.estado: "enviada"`; services 100/100 and severity exact vs ground truth; timeline 3/4 hour-exact (the 8:50 call landed inside `que_paso` instead of as an event). Not part of the N=10 table — the rig changed after the audit. |

Schema: `schema_version`, `session_id`, `scenario_id` (seeded script),
`mode: real`, `turn_detection`, `noise_condition: quiet`, `events` (tool
calls, read-backs, barge-ins with timings), `transcript`, `final_form`.
Produced by `scripts/realgate.mjs`; the N=10 set aggregated by
`scripts/n10-table.mjs`. The other seven N=10 artifacts are byte-identical in
shape and stay local (the whole set regenerates with the rig + an API key;
see STATUS.md METRICS-N10); R6a is the single post-audit run.
