#!/usr/bin/env node
/**
 * smoke-mock.mjs — pipeline completo end-to-end SIN API key ni audio (CI).
 *
 * 1. Corre las 3 sesiones mock deterministas (web/js/smoke-example.mjs)
 *    → artefactos §6 en .data/smoke/artifact-<scenario>.json
 * 2. Corre el harness de métricas sobre esos artefactos contra el ground
 *    truth sembrado → tabla markdown + .data/smoke/report.json
 *
 * Sale 1 si cualquier paso falla o si la accuracy de fichas no es 100%
 * (las sesiones mock deben calzar EXACTO con el GT: es la prueba de que el
 * pipeline tools→ficha→artefacto→métricas está íntegro).
 *
 * Uso: npm run smoke:mock
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\nsmoke-mock: FALLÓ: ${cmd} ${args.join(' ')} (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
};

// 1) sesiones mock deterministas
run('node', ['web/js/smoke-example.mjs']);

// 2) métricas contra ground truth
const artifacts = ['s1-happy-path', 's2-pieza-mal-oida', 's3-barge-in']
  .map((s) => join('.data', 'smoke', `artifact-${s}.json`));
const missing = artifacts.filter((a) => !existsSync(join(ROOT, a)));
if (missing.length) {
  console.error(`smoke-mock: artefactos no generados: ${missing.join(', ')}`);
  process.exit(1);
}
const gts = ['s1-happy-path', 's2-pieza-mal-oida', 's3-barge-in']
  .map((s) => join('data', 'ground-truth', `gt-${s}.json`));
run('node', ['metrics/cli.js', ...artifacts, '--gt', ...gts, '--out', join('.data', 'smoke', 'report.json')]);

// 3) invariante del pipeline mock: la ficha final debe calzar 100% con el GT
let formsOk = true;
for (const a of artifacts) {
  const art = JSON.parse(readFileSync(join(ROOT, a), 'utf8'));
  const gt = JSON.parse(readFileSync(join(ROOT, 'data', 'ground-truth', `gt-${art.scenario_id}.json`), 'utf8'));
  const pred = new Set(art.final_form.piezas.map((p) => `${p.sku}x${p.qty}`));
  const truth = new Set(gt.expected_form.piezas.map((p) => `${p.sku}x${p.qty}`));
  const same = pred.size === truth.size && [...truth].every((x) => pred.has(x));
  console.log(`  ficha ${art.scenario_id}: ${same ? 'OK' : 'DIFIERE'} (${[...pred].join(', ')}) vs GT (${[...truth].join(', ')})`);
  if (!same) formsOk = false;
}
if (!formsOk) {
  console.error('smoke-mock: una ficha mock no calza con el ground truth — revisar pipeline.');
  process.exit(1);
}
console.log('\nSMOKE-MOCK OK — pipeline tools→ficha→artefacto→métricas íntegro en modo mock.');
