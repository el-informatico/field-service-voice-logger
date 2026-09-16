#!/usr/bin/env node
// cli.js — metrics harness CLI.
//   node metrics/cli.js <artifact.json...> --gt <gt.json...> [--out <report.json>] [--json]
//   node metrics/cli.js --selftest
// Zero deps, ESM, Node >= 22. Deterministic; reads/writes local JSON only.

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadSessions } from './lib/loader.js';
import { latency, percentile } from './lib/latency.js';
import { accuracy } from './lib/accuracy.js';
import { compareIncident } from './lib/incident-accuracy.js';
import { confirmation } from './lib/confirmation.js';
import { bargein } from './lib/bargein.js';
import { corpusWer } from './lib/wer.js';
import { normalize, similarity } from './lib/textnorm.js';
import { buildReport, markdownTable } from './lib/report.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const FIXTURES_INCIDENTE = join(HERE, 'fixtures-incidente');

function parseArgs(argv) {
  const args = { artifacts: [], gt: [], out: join(HERE, 'report.json') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--gt') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) { i++; args.gt.push(...argv[i].split(',').filter(Boolean)); }
      if (args.gt.length === 0) throw new Error('--gt requires at least one path');
      continue;
    }
    if (a === '--out') { i++; if (!argv[i]) throw new Error('--out requires a path'); args.out = argv[i]; continue; }
    if (a === '--json') { args.json = true; continue; }
    if (a === '--selftest') { args.selftest = true; continue; }
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    args.artifacts.push(...a.split(',').filter(Boolean));
  }
  return args;
}

const USAGE = `Usage:
  node metrics/cli.js <artifact.json...> --gt <gt.json...> [--out <report.json>] [--json]
  node metrics/cli.js --selftest`;

/** Build WER pairs: GT reference user turns vs artifact transcript (role=user).
 *  Accepts GT shapes: reference_user_turns: [string] | user_turns: [string] |
 *  user_utterances: [{n, text}] (`n` = guion turn number — INFORMATIONAL only:
 *  in guiones it is the GLOBAL turn index (user/agent interleaved), NOT the
 *  user-turn index, so pairing is always CHRONOLOGICAL BY ORDER). */
function werPairs(artifact, gt) {
  if (!gt) return { pairs: [], n_reference_turns: 0, n_hypothesis_turns: 0, unmatched: 0 };
  const raw = gt.reference_user_turns ?? gt.user_turns ?? gt.user_utterances ?? [];
  const hyps = (artifact.transcript ?? []).filter((t) => t.role === 'user').map((t) => t.text);
  const norm = (s) => normalize(s).split(' ').filter(Boolean);
  const refs = raw.map((r) => norm(typeof r === 'object' ? (r.text ?? '') : r));
  const n = Math.min(refs.length, hyps.length);
  const pairs = [];
  for (let i = 0; i < n; i++) pairs.push({ ref: refs[i], hyp: norm(hyps[i]) });
  return { pairs, n_reference_turns: refs.length, n_hypothesis_turns: hyps.length, unmatched: Math.abs(refs.length - hyps.length) };
}

export function computeSession({ artifact, gt }) {
  // Domain routing (Plan B, contract §7): an incidente session (final_form with
  // incidente_id, or GT expected_form with servicios_afectados) uses the
  // incident comparators; orden sessions keep the original ones. Everything
  // else (latency/confirmation/wer/bargein) is domain-agnostic.
  const isIncidente = artifact.final_form?.incidente_id != null || gt?.expected_form?.servicios_afectados != null;
  return {
    latency: latency(artifact.events),
    accuracy: isIncidente
      ? compareIncident(artifact.final_form, gt?.expected_form ?? {})
      : accuracy(artifact.final_form, gt?.expected_form ?? {}),
    confirmation: confirmation(artifact.events, gt?.seeded_errors ?? [], gt?.expected_form ?? {}),
    bargein: bargein(artifact.events),
    wer: werPairs(artifact, gt),
  };
}

export function run(artifactPaths, gtPaths) {
  const sessions = loadSessions(artifactPaths, gtPaths);
  if (sessions.some((s) => !s.gt)) {
    const missing = sessions.filter((s) => !s.gt).map((s) => `${s.artifact.scenario_id} (${s.artifact.session_id})`);
    throw new Error(`No ground truth found for scenario_id: ${missing.join(', ')}. Pass the matching GT file with --gt <path>.`);
  }
  const withMetrics = sessions.map((s) => ({ ...s, metrics: computeSession(s) }));
  return { report: buildReport(withMetrics), sessions: withMetrics };
}

// ---------------------------------------------------------------- selftest --
const near = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-6 : Object.is(a, b));
const fails = [];
function eq(actual, expected, label) {
  if (!near(actual, expected)) fails.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function selftest() {
  fails.length = 0;
  // --- unit sanity ---
  eq(normalize('Café, VALVULA de  3/4!'), 'cafe valvula de 3 4', 'normalize');
  eq(similarity('válvula de bola 3/4', 'valvula bola 3/4'), 1.0, 'similarity identical after norm');
  eq(similarity('rojo verde', 'rojo verde azul'), 2 / 3, 'similarity subset');
  eq(percentile([10], 50), 10, 'percentile singleton');
  eq(percentile([10, 20], 95), 10 + 0.95 * 10, 'percentile two');
  const w1 = corpusWer([{ ref: ['a', 'b', 'c', 'd'], hyp: ['a', 'x', 'c', 'd', 'e'] }]);
  eq(w1.wer, 0.5, 'wer value'); eq(w1.sub, 1, 'wer sub'); eq(w1.ins, 1, 'wer ins'); eq(w1.hits, 3, 'wer hits');

  // --- incident comparators, unit sanity (contract §7 edge paths) ---
  const ic1 = compareIncident(
    { resumen: 'hola mundo', severidad: 'Alta', timeline: [{ hora: '9:20', evento: 'x y' }], servicios_afectados: [{ id: 'A' }], action_items: ['mundo hola'] },
    { resumen: 'hola mundo', severidad: 'alta', timeline: [{ hora: '09:20', evento: 'x y' }], servicios_afectados: [{ id: 'A' }, { id: 'B' }], action_items: ['hola mundo'] },
  );
  eq(ic1.fields.resumen.similarity, 1.0, 'incident resumen sim');
  eq(ic1.fields.severidad.correct, true, 'incident severidad case-insensitive exacta');
  eq(ic1.fields.timeline.tp, 0, 'incident timeline hora no exacta');
  eq(ic1.fields.timeline.fp, 1, 'incident timeline fp por hora');
  eq(ic1.fields.servicios_afectados.recall, 0.5, 'incident servicios recall');
  eq(ic1.fields.action_items.correct, true, 'incident action items cubiertos');
  eq(ic1.overall, 0.6, 'incident overall 3 de 5');
  const ic2 = compareIncident({ timeline: [{ hora: '10:00', evento: 'alfa beta' }] }, { timeline: [{ hora: '10:00', evento: 'alfa beta gamma delta' }] });
  eq(ic2.fields.timeline.tp, 0, 'incident timeline evento sim < 0.6');
  eq(ic2.fields.timeline.fn, 1, 'incident timeline fn por evento');

  // --- fixtures vs hand-computed oracle ---
  const expected = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8'));
  const sessions = loadSessions(
    [join(FIXTURES, 'fixture-a.json'), join(FIXTURES, 'fixture-b.json')],
    [join(FIXTURES, 'gt-a.json'), join(FIXTURES, 'gt-b.json')],
  );
  eq(sessions.length, 2, 'sessions loaded');
  eq(sessions.every((s) => s.gt != null), true, 'gt paired');

  const withMetrics = sessions.map((s) => ({ ...s, metrics: computeSession(s) }));
  for (const { artifact, metrics } of withMetrics) {
    const exp = expected[artifact.scenario_id];
    const L = metrics.latency;
    eq(L.tool.summary.n, exp.latency.tool.n, `${artifact.scenario_id} tool n`);
    eq(L.tool.summary.p50, exp.latency.tool.p50, `${artifact.scenario_id} tool p50`);
    eq(L.tool.summary.p95, exp.latency.tool.p95, `${artifact.scenario_id} tool p95`);
    eq(L.tool.summary.min, exp.latency.tool.min, `${artifact.scenario_id} tool min`);
    eq(L.tool.summary.max, exp.latency.tool.max, `${artifact.scenario_id} tool max`);
    eq(L.agent.summary.n, exp.latency.agent.n, `${artifact.scenario_id} agent n`);
    eq(L.agent.summary.p50, exp.latency.agent.p50, `${artifact.scenario_id} agent p50`);
    eq(L.agent.summary.p95, exp.latency.agent.p95, `${artifact.scenario_id} agent p95`);
    eq(L.agent.summary.min, exp.latency.agent.min, `${artifact.scenario_id} agent min`);
    eq(L.agent.summary.max, exp.latency.agent.max, `${artifact.scenario_id} agent max`);
    eq(L.skipped_tool, exp.latency.skipped_tool, `${artifact.scenario_id} skipped_tool`);
    eq(L.skipped_agent, exp.latency.skipped_agent, `${artifact.scenario_id} skipped_agent`);

    const A = metrics.accuracy;
    eq(A.domain ?? null, null, `${artifact.scenario_id} orden routing intact`);
    eq(A.overall, exp.accuracy.overall, `${artifact.scenario_id} acc overall`);
    eq(A.correct_fields, exp.accuracy.correct_fields, `${artifact.scenario_id} acc correct`);
    eq(A.evaluated_fields, exp.accuracy.evaluated_fields, `${artifact.scenario_id} acc evaluated`);
    for (const f of ['problema', 'diagnostico', 'solucion']) {
      eq(A.fields[f].similarity, exp.accuracy[f].similarity, `${artifact.scenario_id} ${f} sim`);
      eq(A.fields[f].correct, exp.accuracy[f].correct, `${artifact.scenario_id} ${f} correct`);
    }
    const P = A.fields.piezas;
    for (const k of ['tp', 'fp', 'fn', 'precision', 'recall', 'f1', 'exact_set', 'correct']) {
      eq(P[k], exp.accuracy.piezas[k], `${artifact.scenario_id} piezas ${k}`);
    }
    eq(A.fields.tiempo_minutos.correct, exp.accuracy.tiempo_minutos.correct, `${artifact.scenario_id} tiempo correct`);

    const C = metrics.confirmation;
    eq(C.n_requests, exp.confirmation.n_requests, `${artifact.scenario_id} conf n_requests`);
    eq(C.n_corrections, exp.confirmation.n_corrections, `${artifact.scenario_id} conf corrections`);
    eq(C.n_false_alarms, exp.confirmation.n_false_alarms, `${artifact.scenario_id} conf false alarms`);
    eq(C.precision, exp.confirmation.precision, `${artifact.scenario_id} conf precision`);
    eq(C.recall, exp.confirmation.recall, `${artifact.scenario_id} conf recall`);
    eq(C.rescued.length, exp.confirmation.n_rescued, `${artifact.scenario_id} conf rescued`);

    const B = metrics.bargein;
    eq(B.n_provoked, exp.bargein.n_provoked, `${artifact.scenario_id} bargein provoked`);
    eq(B.n_respected, exp.bargein.n_respected, `${artifact.scenario_id} bargein respected`);
    eq(B.n_stolen, exp.bargein.n_stolen, `${artifact.scenario_id} bargein stolen`);
    eq(B.pct_respected, exp.bargein.pct_respected, `${artifact.scenario_id} bargein pct`);

    const W = corpusWer(metrics.wer.pairs);
    eq(W.wer, exp.wer.wer, `${artifact.scenario_id} wer`);
    eq(W.sub, exp.wer.sub, `${artifact.scenario_id} wer sub`);
    eq(W.ins, exp.wer.ins, `${artifact.scenario_id} wer ins`);
    eq(W.del, exp.wer.del, `${artifact.scenario_id} wer del`);
    eq(W.hits, exp.wer.hits, `${artifact.scenario_id} wer hits`);
    eq(W.n_ref, exp.wer.n_ref, `${artifact.scenario_id} wer n_ref`);
  }

  // --- aggregate vs oracle ---
  const rep = buildReport(withMetrics).aggregate;
  const ea = expected.aggregate;
  eq(rep.latency.tool.n, ea.latency.tool.n, 'agg tool n');
  eq(rep.latency.tool.p50, ea.latency.tool.p50, 'agg tool p50');
  eq(rep.latency.tool.p95, ea.latency.tool.p95, 'agg tool p95');
  eq(rep.latency.agent.n, ea.latency.agent.n, 'agg agent n');
  eq(rep.latency.agent.p50, ea.latency.agent.p50, 'agg agent p50');
  eq(rep.latency.agent.p95, ea.latency.agent.p95, 'agg agent p95');
  eq(rep.wer.wer, ea.wer.wer, 'agg wer');
  eq(rep.wer.n_ref, ea.wer.n_ref, 'agg wer n_ref');
  eq(rep.extraction.overall, ea.extraction.overall, 'agg extraction overall');
  eq(rep.extraction.correct_fields, ea.extraction.correct_fields, 'agg extraction correct');
  eq(rep.extraction.evaluated_fields, ea.extraction.evaluated_fields, 'agg extraction evaluated');
  for (const f of Object.keys(ea.extraction.per_field)) {
    eq(rep.extraction.per_field[f].correct, ea.extraction.per_field[f].correct, `agg per_field ${f}`);
    eq(rep.extraction.per_field[f].n, ea.extraction.per_field[f].n, `agg per_field ${f} n`);
  }
  const pz = rep.extraction.piezas;
  for (const k of ['tp', 'fp', 'fn', 'precision', 'recall', 'f1', 'exact_set_pct']) {
    eq(pz[k], ea.extraction.piezas[k], `agg piezas ${k}`);
  }
  eq(rep.confirmation.precision, ea.confirmation.precision, 'agg conf precision');
  eq(rep.confirmation.recall, ea.confirmation.recall, 'agg conf recall');
  eq(rep.confirmation.n_false_alarms, ea.confirmation.n_false_alarms, 'agg conf false alarms');
  eq(rep.bargein.pct_respected, ea.bargein.pct_respected, 'agg bargein pct');

  // --- incidente fixtures vs hand-computed oracle (Plan B, contract §7) ---
  const expectedI = JSON.parse(readFileSync(join(FIXTURES_INCIDENTE, 'expected.json'), 'utf8'));
  const sessionsI = loadSessions(
    [join(FIXTURES_INCIDENTE, 'fixture-i1.json'), join(FIXTURES_INCIDENTE, 'fixture-i2.json')],
    [join(FIXTURES_INCIDENTE, 'gt-i1.json'), join(FIXTURES_INCIDENTE, 'gt-i2.json')],
  );
  eq(sessionsI.length, 2, 'incidente sessions loaded');
  eq(sessionsI.every((s) => s.gt != null), true, 'incidente gt paired');

  const withMetricsI = sessionsI.map((s) => ({ ...s, metrics: computeSession(s) }));
  for (const { artifact, metrics } of withMetricsI) {
    const exp = expectedI[artifact.scenario_id];
    const sid = artifact.scenario_id;
    const L = metrics.latency;
    eq(L.tool.summary.n, exp.latency.tool.n, `${sid} tool n`);
    eq(L.tool.summary.p50, exp.latency.tool.p50, `${sid} tool p50`);
    eq(L.tool.summary.p95, exp.latency.tool.p95, `${sid} tool p95`);
    eq(L.tool.summary.min, exp.latency.tool.min, `${sid} tool min`);
    eq(L.tool.summary.max, exp.latency.tool.max, `${sid} tool max`);
    eq(L.agent.summary.n, exp.latency.agent.n, `${sid} agent n`);
    eq(L.agent.summary.p50, exp.latency.agent.p50, `${sid} agent p50`);
    eq(L.agent.summary.p95, exp.latency.agent.p95, `${sid} agent p95`);
    eq(L.agent.summary.min, exp.latency.agent.min, `${sid} agent min`);
    eq(L.agent.summary.max, exp.latency.agent.max, `${sid} agent max`);
    eq(L.skipped_tool, exp.latency.skipped_tool, `${sid} skipped_tool`);
    eq(L.skipped_agent, exp.latency.skipped_agent, `${sid} skipped_agent`);

    const A = metrics.accuracy;
    eq(A.domain, 'incidente', `${sid} routed to incident comparators`);
    eq(A.overall, exp.accuracy.overall, `${sid} acc overall`);
    eq(A.correct_fields, exp.accuracy.correct_fields, `${sid} acc correct`);
    eq(A.evaluated_fields, exp.accuracy.evaluated_fields, `${sid} acc evaluated`);
    for (const f of ['resumen', 'que_paso']) {
      eq(A.fields[f].similarity, exp.accuracy[f].similarity, `${sid} ${f} sim`);
      eq(A.fields[f].correct, exp.accuracy[f].correct, `${sid} ${f} correct`);
    }
    const S = A.fields.servicios_afectados;
    for (const k of ['tp', 'fp', 'fn', 'precision', 'recall', 'f1', 'exact_set', 'correct']) {
      eq(S[k], exp.accuracy.servicios_afectados[k], `${sid} servicios ${k}`);
    }
    const T = A.fields.timeline;
    for (const k of ['tp', 'fp', 'fn', 'precision', 'recall', 'f1', 'exact_set', 'correct']) {
      eq(T[k], exp.accuracy.timeline[k], `${sid} timeline ${k}`);
    }
    eq(T.matches.length, exp.accuracy.timeline.matches.length, `${sid} timeline matches n`);
    T.matches.forEach((m, i) => {
      eq(m.hora, exp.accuracy.timeline.matches[i].hora, `${sid} timeline match ${i} hora`);
      eq(m.evento_similarity, exp.accuracy.timeline.matches[i].evento_similarity, `${sid} timeline match ${i} sim`);
    });
    const AI = A.fields.action_items;
    for (const k of ['covered', 'n_gt', 'n_pred', 'recall', 'correct']) {
      eq(AI[k], exp.accuracy.action_items[k], `${sid} action_items ${k}`);
    }
    eq(A.fields.severidad.pred, exp.accuracy.severidad.pred, `${sid} severidad pred`);
    eq(A.fields.severidad.gt, exp.accuracy.severidad.gt, `${sid} severidad gt`);
    eq(A.fields.severidad.correct, exp.accuracy.severidad.correct, `${sid} severidad correct`);

    const C = metrics.confirmation;
    eq(C.n_requests, exp.confirmation.n_requests, `${sid} conf n_requests`);
    eq(C.n_corrections, exp.confirmation.n_corrections, `${sid} conf corrections`);
    eq(C.n_false_alarms, exp.confirmation.n_false_alarms, `${sid} conf false alarms`);
    eq(C.precision, exp.confirmation.precision, `${sid} conf precision`);
    eq(C.recall, exp.confirmation.recall, `${sid} conf recall`);
    eq(C.rescued.length, exp.confirmation.n_rescued, `${sid} conf rescued`);

    const B = metrics.bargein;
    eq(B.n_provoked, exp.bargein.n_provoked, `${sid} bargein provoked`);
    eq(B.n_respected, exp.bargein.n_respected, `${sid} bargein respected`);
    eq(B.n_stolen, exp.bargein.n_stolen, `${sid} bargein stolen`);
    eq(B.pct_respected, exp.bargein.pct_respected, `${sid} bargein pct`);

    const W = corpusWer(metrics.wer.pairs);
    eq(W.wer, exp.wer.wer, `${sid} wer`);
    eq(W.sub, exp.wer.sub, `${sid} wer sub`);
    eq(W.ins, exp.wer.ins, `${sid} wer ins`);
    eq(W.del, exp.wer.del, `${sid} wer del`);
    eq(W.hits, exp.wer.hits, `${sid} wer hits`);
    eq(W.n_ref, exp.wer.n_ref, `${sid} wer n_ref`);
  }

  // --- incidente aggregate vs oracle ---
  const repI = buildReport(withMetricsI).aggregate;
  const eai = expectedI.aggregate;
  eq(repI.latency.tool.n, eai.latency.tool.n, 'agg incidente tool n');
  eq(repI.latency.tool.p50, eai.latency.tool.p50, 'agg incidente tool p50');
  eq(repI.latency.tool.p95, eai.latency.tool.p95, 'agg incidente tool p95');
  eq(repI.latency.agent.n, eai.latency.agent.n, 'agg incidente agent n');
  eq(repI.latency.agent.p50, eai.latency.agent.p50, 'agg incidente agent p50');
  eq(repI.latency.agent.p95, eai.latency.agent.p95, 'agg incidente agent p95');
  eq(repI.wer.wer, eai.wer.wer, 'agg incidente wer');
  eq(repI.wer.n_ref, eai.wer.n_ref, 'agg incidente wer n_ref');
  eq(repI.extraction.overall, eai.extraction.overall, 'agg incidente extraction overall');
  eq(repI.extraction.correct_fields, eai.extraction.correct_fields, 'agg incidente extraction correct');
  eq(repI.extraction.evaluated_fields, eai.extraction.evaluated_fields, 'agg incidente extraction evaluated');
  for (const f of Object.keys(eai.extraction.per_field)) {
    eq(repI.extraction.per_field[f].correct, eai.extraction.per_field[f].correct, `agg incidente per_field ${f}`);
    eq(repI.extraction.per_field[f].n, eai.extraction.per_field[f].n, `agg incidente per_field ${f} n`);
  }
  const srvAgg = repI.extraction.servicios_afectados;
  for (const k of ['tp', 'fp', 'fn', 'precision', 'recall', 'f1', 'exact_set_pct', 'n_sessions_with_gt']) {
    eq(srvAgg[k], eai.extraction.servicios_afectados[k], `agg incidente servicios ${k}`);
  }
  const tlAgg = repI.extraction.timeline;
  for (const k of ['tp', 'fp', 'fn', 'precision', 'recall', 'f1', 'exact_set_pct', 'n_sessions_with_gt']) {
    eq(tlAgg[k], eai.extraction.timeline[k], `agg incidente timeline ${k}`);
  }
  const aiAgg = repI.extraction.action_items;
  for (const k of ['covered', 'n_gt', 'recall', 'n_sessions_with_gt']) {
    eq(aiAgg[k], eai.extraction.action_items[k], `agg incidente action_items ${k}`);
  }
  eq(repI.confirmation.precision, eai.confirmation.precision, 'agg incidente conf precision');
  eq(repI.confirmation.recall, eai.confirmation.recall, 'agg incidente conf recall');
  eq(repI.confirmation.n_false_alarms, eai.confirmation.n_false_alarms, 'agg incidente conf false alarms');
  eq(repI.bargein.pct_respected, eai.bargein.pct_respected, 'agg incidente bargein pct');

  return fails;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) { console.error(USAGE); process.exit(2); }
  const args = parseArgs(argv);
  if (args.help) { console.log(USAGE); return; }
  if (args.selftest) {
    const failures = selftest();
    if (failures.length) {
      console.error(`SELFTEST FAILED (${failures.length} assertion(s)):\n- ${failures.join('\n- ')}`);
      process.exit(1);
    }
    console.log('SELFTEST OK — all fixture metrics match the hand-computed oracle (fixtures/expected.json + fixtures-incidente/expected.json)');
    return;
  }
  if (args.artifacts.length === 0) { console.error(`No artifact files given.\n${USAGE}`); process.exit(2); }
  const { report } = run(args.artifacts, args.gt);
  writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
  console.log(args.json ? JSON.stringify(report, null, 2) : markdownTable(report));
  console.error(`report written to ${args.out}`);
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
