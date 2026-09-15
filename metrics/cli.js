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
import { confirmation } from './lib/confirmation.js';
import { bargein } from './lib/bargein.js';
import { corpusWer } from './lib/wer.js';
import { normalize, similarity } from './lib/textnorm.js';
import { buildReport, markdownTable } from './lib/report.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');

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
  return {
    latency: latency(artifact.events),
    accuracy: accuracy(artifact.final_form, gt?.expected_form ?? {}),
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
    console.log('SELFTEST OK — all fixture metrics match the hand-computed oracle (fixtures/expected.json)');
    return;
  }
  if (args.artifacts.length === 0) { console.error(`No artifact files given.\n${USAGE}`); process.exit(2); }
  const { report } = run(args.artifacts, args.gt);
  writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
  console.log(args.json ? JSON.stringify(report, null, 2) : markdownTable(report));
  console.error(`report written to ${args.out}`);
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
