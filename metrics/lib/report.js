// report.js — combine per-session metrics into (a) a report.json-shaped object
// and (b) a markdown table (Value | N | Condition) ready to paste into README.
//
// Aggregation: micro-average WER (pool sub/ins/del over pairs), pooled latency
// samples, summed confusion/confirmation counts, macro extraction accuracy is
// recomputed from summed correct/evaluated fields (micro over fields).

import { corpusWer } from './wer.js';
import { percentile } from './latency.js';

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
const ms = (x) => (x == null ? '—' : `${Math.round(x)} ms`);
const num = (x) => (x == null ? '—' : String(x));

function pooledLatency(samples) {
  const s = samples.map((x) => x.lat_ms).sort((a, b) => a - b);
  return {
    n: s.length,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    min: s.length ? s[0] : null,
    max: s.length ? s[s.length - 1] : null,
  };
}

export function buildReport(sessions) {
  // sessions: [{artifact, gt, metrics:{latency, accuracy, confirmation, bargein, wer}}]
  const perSession = sessions.map(({ artifact, gt, metrics }) => ({
    session_id: artifact.session_id,
    scenario_id: artifact.scenario_id,
    mode: artifact.mode ?? null,
    noise_condition: artifact.noise_condition ?? null,
    n_events: (artifact.events ?? []).length,
    latency: metrics.latency,
    accuracy: metrics.accuracy,
    confirmation: metrics.confirmation,
    bargein: metrics.bargein,
    wer: metrics.wer,
  }));

  const werPairs = sessions.flatMap(({ metrics }) => metrics.wer?.pairs ?? []);
  const corpus = corpusWer(werPairs.map(({ ref, hyp }) => ({ ref, hyp })));

  const tool = pooledLatency(sessions.flatMap(({ metrics }) => metrics.latency.tool.samples));
  const agent = pooledLatency(sessions.flatMap(({ metrics }) => metrics.latency.agent.samples));

  let correctFields = 0, evaluatedFields = 0;
  let tp = 0, fp = 0, fn = 0, exactSets = 0, sessionsWithPiezasGt = 0;
  const fieldCorrect = { problema: [0, 0], diagnostico: [0, 0], solucion: [0, 0], tiempo_minutos: [0, 0] };
  for (const { metrics } of sessions) {
    const a = metrics.accuracy;
    correctFields += a.correct_fields; evaluatedFields += a.evaluated_fields;
    for (const f of Object.keys(fieldCorrect)) {
      if (a.fields[f]) { fieldCorrect[f][0] += a.fields[f].correct ? 1 : 0; fieldCorrect[f][1]++; }
    }
    const p = a.fields.piezas;
    if (p) {
      tp += p.tp; fp += p.fp; fn += p.fn;
      sessionsWithPiezasGt++;
      if (p.exact_set) exactSets++;
    }
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision == null && recall == null ? null : precision == null || recall == null || precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const conf = sessions.reduce(
    (acc, { metrics }) => {
      acc.n_requests += metrics.confirmation.n_requests;
      acc.n_corrections += metrics.confirmation.n_corrections;
      acc.n_false_alarms += metrics.confirmation.n_false_alarms;
      acc.n_seeded += metrics.confirmation.n_seeded_errors;
      acc.n_rescued += metrics.confirmation.rescued.length;
      return acc;
    },
    { n_requests: 0, n_corrections: 0, n_false_alarms: 0, n_seeded: 0, n_rescued: 0 },
  );

  const barg = sessions.reduce(
    (acc, { metrics }) => {
      acc.n_provoked += metrics.bargein.n_provoked;
      acc.n_respected += metrics.bargein.n_respected;
      acc.n_stolen += metrics.bargein.n_stolen;
      return acc;
    },
    { n_provoked: 0, n_respected: 0, n_stolen: 0 },
  );

  return {
    schema_version: 1,
    generated_by: 'metrics/lib/report.js',
    n_sessions: sessions.length,
    sessions: perSession,
    aggregate: {
      wer: corpus,
      latency: { tool, agent },
      extraction: {
        overall: evaluatedFields ? correctFields / evaluatedFields : null,
        correct_fields: correctFields,
        evaluated_fields: evaluatedFields,
        per_field: Object.fromEntries(
          Object.entries(fieldCorrect).map(([f, [c, n]]) => [f, { correct: c, n, pct: n ? c / n : null }]),
        ),
        piezas: {
          tp, fp, fn,
          precision, recall,
          f1,
          exact_set_pct: sessionsWithPiezasGt ? exactSets / sessionsWithPiezasGt : null,
          n_sessions_with_piezas_gt: sessionsWithPiezasGt,
        },
      },
      confirmation: {
        ...conf,
        precision: conf.n_requests ? conf.n_corrections / conf.n_requests : null,
        recall: conf.n_seeded ? conf.n_rescued / conf.n_seeded : null,
      },
      bargein: { ...barg, pct_respected: barg.n_provoked ? barg.n_respected / barg.n_provoked : null },
    },
  };
}

export function markdownTable(report) {
  const a = report.aggregate;
  const cond = (list) => [...new Set(list.filter(Boolean))].join(', ') || '—';
  const modes = cond(report.sessions.map((s) => s.mode));
  const noises = cond(report.sessions.map((s) => s.noise_condition));
  const rows = [
    ['Latency user_turn_end → tool_call, p50 / p95', `${ms(a.latency.tool.p50)} / ${ms(a.latency.tool.p95)}`, num(a.latency.tool.n), `turns with a tool call; modes: ${modes}`],
    ['Latency user_turn_end → agent_turn_start, p50 / p95', `${ms(a.latency.agent.p50)} / ${ms(a.latency.agent.p95)}`, num(a.latency.agent.n), `answered turns; modes: ${modes}`],
    ['Extraction accuracy (all fields)', pct(a.extraction.overall), num(a.extraction.evaluated_fields), 'fields evaluated vs ground truth'],
  ];
  for (const [f, label] of [['problema', 'problema'], ['diagnostico', 'diagnóstico'], ['solucion', 'solución'], ['tiempo_minutos', 'tiempo_minutos (±5 min)']]) {
    const pf = a.extraction.per_field[f];
    const extra = f === 'tiempo_minutos' ? ' ±5 min' : ' sim ≥ 0.8';
    rows.push([`  of which: ${label}`, pct(pf?.pct), num(pf?.n), `field-level${extra}`]);
  }
  const pz = a.extraction.piezas;
  rows.push(
    ['Piezas precision / recall / F1', `${pct(pz.precision)} / ${pct(pz.recall)} / ${pct(pz.f1)}`, `${pz.tp} TP / ${pz.fp} FP / ${pz.fn} FN`, 'exact (sku, qty) pairs vs GT'],
    ['Orders with exact piezas set', pct(pz.exact_set_pct), num(pz.n_sessions_with_piezas_gt), 'orders where GT includes piezas'],
    ['Confirmation-loop recall (seeded errors rescued)', pct(a.confirmation.recall), num(a.confirmation.n_seeded), 'seeded capture errors'],
    ['Confirmation-loop precision (read-backs → correction)', pct(a.confirmation.precision), num(a.confirmation.n_requests), `read-backs (${a.confirmation.n_false_alarms} false alarms)`],
    ['WER (user turns, scripted scenarios)', a.wer.wer.toFixed(3), num(a.wer.n_ref), `user words; noise: ${noises}`],
    ['Barge-ins respected (agent silenced ≤ 500 ms)', pct(a.bargein.pct_respected), num(a.bargein.n_provoked), `provoked interruptions (${a.bargein.n_stolen} stolen)`],
  );
  const header = '| Metric | Value | N | Condition |';
  const sep = '|---|---:|---:|---|';
  const body = rows.map(([m, v, n, c]) => `| ${m} | ${v} | ${n} | ${c} |`);
  return [`## Metrics — ${report.n_sessions} session(s)`, '', header, sep, ...body, ''].join('\n');
}
