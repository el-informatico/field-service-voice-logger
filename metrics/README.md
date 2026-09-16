# Metrics — exact definitions (the boring, reproducible part)

Everything below is computed offline from session artifacts (JSON timelines, no
audio) by `metrics/cli.js`. Zero npm dependencies, deterministic: same inputs →
same numbers. Run `node metrics/cli.js <artifact.json...> --gt <gt.json...>` to
reproduce; `node metrics/cli.js --selftest` checks the harness against
hand-computed fixtures (`metrics/fixtures/expected.json`).

## Inputs
- **Artifact** (per session): `events[]` timeline, `transcript[]`, `final_form`.
- **Ground truth** (per scenario, paired by `scenario_id`): `expected_form`,
  `seeded_errors`, reference user utterances.

## Latency (p50 / p95, ms)
- `lat_tool`: from each `user_turn_end`, time to the next `tool_call` before the
  next `user_turn_start` (first tool call only; turns without one are skipped
  and counted as skipped).
- `lat_agent`: from each `user_turn_end`, time to the next `agent_turn_start`.
- **N** = number of paired turns pooled across sessions. Percentiles use linear
  interpolation between order statistics. Condition column reports mode/noise.

## Extraction accuracy (per field vs ground truth)
- `problema`, `diagnostico`, `solucion`: Jaccard similarity ≥ 0.8 over normalized
  token sets (lowercase, diacritics stripped, punctuation removed, ES/EN
  stopwords dropped). The similarity value is reported alongside correct/incorrect.
- `piezas`: set-level precision / recall / F1 over exact `(sku, qty)` pairs,
  plus `exact_set` (perfect set); we report the % of orders with the exact set.
- `tiempo_minutos`: correct if `|pred − gt| ≤ 5` minutes.
- **Overall** = correct fields ÷ evaluated fields (a field counts as evaluated
  when ground truth provides it). **N** = fields evaluated.

## Confirmation loop (our differentiator)
- **recall** = seeded capture errors rescued ÷ seeded errors. Rescued = a
  `confirm_request` whose read-back matches the seeded WRONG value, followed by
  a correction (`confirm_result` with `confirmed:false` or a corrected value, or
  a `form_update` whose snapshot matches truth for that field).
- **precision** = read-backs that ended in a correction ÷ read-backs total.
  Read-backs where nothing was wrong are **false alarms** (they cost the
  technician's patience, so they lower precision).
- **N** = read-backs (precision) and seeded errors (recall).

## WER (word error rate)
Reference = scripted user turns; hypothesis = `transcript[]` role=user, paired
in order. Word-level Levenshtein: `WER = (S + I + D) / N_ref`. Aggregate is
micro-averaged (errors pooled over all words). **N** = reference words.

## Barge-in
`barge_in` events carry `latency_ms` (user interrupts → agent falls silent).
**Respected** if `latency_ms ≤ 500`, **stolen** otherwise.
**N** = provoked interruptions; value = % respected.

## Aggregation
Across sessions: latency samples are pooled; WER errors are micro-averaged;
confusion counts (TP/FP/FN), confirmation counts and barge-in counts are summed;
extraction accuracy is recomputed from summed correct/evaluated fields.

## Incidente fields (Plan B — docs/incident-contract.md §7)
Sessions whose `final_form` has `incidente_id` (or whose GT `expected_form`
has `servicios_afectados`) are routed through `lib/incident-accuracy.js`
instead of the orden comparators; latency/confirmation/WER/barge-in are
unchanged (same artifact).
- `resumen`, `que_paso`: Jaccard similarity ≥ 0.8 over normalized token sets
  (same treatment as `problema`/`solucion`).
- `servicios_afectados`: set-level precision / recall / F1 over exact service
  ids (confundibles like RACK-A3↔A8 count as FP+FN — same as piezas).
- `timeline`: a predicted event matches a GT event iff `hora` is exact AND
  `evento` similarity ≥ 0.6; P/R/F1 over those matches (greedy in GT order).
- `action_items`: recall by coverage — a GT ítem is covered if any predicted
  ítem has similarity ≥ 0.6; extra predicted ítems do not lower the metric.
- `severidad`: exact match (case-insensitive enum).
- **Overall** = correct fields ÷ evaluated fields, same as orden; a field is
  correct when its §7 criterion passes (`servicios_afectados`/`timeline` need
  the exact set). Fixtures: `metrics/fixtures-incidente/` (checked by
  `--selftest` together with the orden set).

## Honest-notes column (fill before publishing)
| Placeholder | What to record |
|---|---|
| N sessions / turns | sample size behind every number |
| Network condition | wifi / office / shop floor, SNR of noise mix |
| Mode | `mock` numbers must never be published as `real` |
| Known gaps | turns without tool calls, unmatched transcript turns |
