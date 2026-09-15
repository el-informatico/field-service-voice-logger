#!/usr/bin/env node
/**
 * smoke-example.mjs — smoke test HEADLESS (sin browser, sin API key, CI-able).
 *
 * Carga data/ (ordenes + piezas + guiones + ground-truth), corre una sesión
 * completa por guion con el canal mock determinista (speed=Infinity) y escribe
 * el artefacto §6 de cada sesión en .data/smoke/. Al final imprime resumen:
 * turnos, tool calls, confirmaciones y barge-ins por sesión.
 *
 * Uso:   node web/js/smoke-example.mjs
 * Sales: .data/smoke/artifact-<scenario_id>.json
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '..');
const ROOT = resolve(WEB, '..');
const DATA = join(ROOT, 'data');

const { createStore } = await import(new URL('./store.js', import.meta.url).href);
const { createToolRunner } = await import(new URL('./tool-runner.js', import.meta.url).href);
const { createSessionEngine } = await import(new URL('./session-engine.js', import.meta.url).href);
const { createMockAgentChannel } = await import(new URL('./mock-agent.js', import.meta.url).href);
const { prepareGuion } = await import(new URL('./guion-sim.js', import.meta.url).href);
const { buildToolDefinitions, TOOL_NAMES } = await import(new URL('./tools.js', import.meta.url).href);

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

async function main() {
  const ordenes = await readJson(join(DATA, 'ordenes.json'));
  const piezas = await readJson(join(DATA, 'piezas.json'));
  let guionFiles = [];
  try {
    guionFiles = (await readdir(join(DATA, 'guiones'))).filter((f) => f.endsWith('.json')).sort();
  } catch {
    console.error('ERROR: no existe data/guiones/ — corre el bloque de datos primero.');
    process.exit(1);
  }
  if (!ordenes?.length || !piezas?.length) {
    console.error('ERROR: data/ordenes.json o data/piezas.json vacíos/ausentes.');
    process.exit(1);
  }

  const outDir = join(ROOT, '.data', 'smoke');
  await mkdir(outDir, { recursive: true });

  // sanity: definiciones de tools con enum del catálogo
  const defs = buildToolDefinitions(piezas.map((p) => p.sku));
  const names = defs.map((d) => d.name).sort();
  const expected = [...TOOL_NAMES].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    console.error('ERROR: buildToolDefinitions no coincide con TOOL_NAMES:', names);
    process.exit(1);
  }
  const enumSkus = defs.find((d) => d.name === 'agregar_pieza_a_reporte')
    ?.parameters?.properties?.sku?.enum;
  if (enumSkus?.length !== piezas.length) {
    console.error('ERROR: enum de sku no cubre el catálogo');
    process.exit(1);
  }
  console.log(`tools OK: ${names.join(', ')} (enum sku: ${enumSkus.length})`);

  let failures = 0;
  for (const file of guionFiles) {
    const guion = await readJson(join(DATA, 'guiones', file));
    let gt = null;
    try { gt = await readJson(join(DATA, 'ground-truth', `gt-${guion.scenario_id}.json`)); } catch { /* sin GT */ }
    const label = guion.scenario_id ?? file;
    try {
      const artifact = await runSession({ ordenes, piezas, guion, gt });
      const outPath = join(outDir, `artifact-${label}.json`);
      await writeFile(outPath, JSON.stringify(artifact, null, 2));
      const { line, problems } = summarize(artifact, gt);
      console.log(line);
      for (const prob of problems) { console.log(`   ⚠ ${prob}`); failures++; }
    } catch (err) {
      failures++;
      console.error(`✗ ${label}: ${err?.stack ?? err}`);
    }
  }
  if (failures) process.exitCode = 1;
}

async function runSession({ ordenes, piezas, guion, gt }) {
  const prepared = prepareGuion(guion, gt);
  const channel = createMockAgentChannel({
    ordenes, piezas, guion: prepared, speed: Infinity,
  });
  const store = createStore({ orderId: guion.order_id, now: () => channel.clock.now() });
  const runner = createToolRunner({ ordenes, piezas, store, clock: channel.clock });
  const session_id = `sess_smoke_${(guion.scenario_id ?? 'x').replace(/[^a-z0-9]+/gi, '_')}`;
  const engine = createSessionEngine({
    channel, toolRunner: runner, store,
    meta: {
      session_id, scenario_id: guion.scenario_id ?? null, mode: 'mock',
      order_id: guion.order_id, noise_condition: guion.noise_condition ?? 'clean',
    },
    clock: channel.clock,
  });
  engine.start();
  await channel.start(); // replay completo (instantáneo) hasta 'ended'
  return engine.end();
}

function summarize(artifact, gt) {
  const ev = artifact.events;
  const userTurns = ev.filter((e) => e.type === 'user_turn_end');
  const agentTurns = ev.filter((e) => e.type === 'agent_turn_end');
  const toolCalls = ev.filter((e) => e.type === 'tool_call');
  const toolResults = ev.filter((e) => e.type === 'tool_result');
  const confirmsReq = ev.filter((e) => e.type === 'confirm_request');
  const confirmsOk = ev.filter((e) => e.type === 'confirm_result' && e.confirmed);
  const confirmsNo = ev.filter((e) => e.type === 'confirm_result' && !e.confirmed);
  const bargeIns = ev.filter((e) => e.type === 'barge_in');
  const problems = [];

  if (artifact.schema_version !== 1) problems.push('schema_version != 1');
  if (!ev.length) problems.push('events vacío');
  if (toolCalls.length !== toolResults.length) problems.push('tool_call sin tool_result');
  if (!artifact.final_form.piezas.every((p) => p.confirmada)) problems.push('piezas sin confirmar');
  if (artifact.final_form.estado !== 'enviada') problems.push('estado != enviada');
  if (artifact.audio_retained !== false) problems.push('audio_retained != false');
  if (gt?.expected_form) {
    const pred = artifact.final_form.piezas.map((p) => `${p.sku}x${p.qty}`).sort().join(',');
    const exp = gt.expected_form.piezas.map((p) => `${p.sku}x${p.qty}`).sort().join(',');
    if (pred !== exp) problems.push(`piezas ≠ GT: [${pred}] vs [${exp}]`);
    const tp = artifact.final_form.tiempo_minutos;
    if (Math.abs((tp ?? -999) - gt.expected_form.tiempo_minutos) > 5) {
      problems.push(`tiempo ${tp} vs GT ${gt.expected_form.tiempo_minutos}`);
    }
  }

  const line = `✓ ${artifact.scenario_id}: turnos user=${userTurns.length} agente=${agentTurns.length}` +
    ` | tools=${toolCalls.length} | read-backs=${confirmsReq.length} (ok=${confirmsOk.length}, corrección=${confirmsNo.length})` +
    ` | barge-ins=${bargeIns.length} | ficha: ${artifact.final_form.piezas.map((p) => `${p.sku} x${p.qty}${p.confirmada ? '✓' : '?'}`).join(' · ')}` +
    ` | tiempo=${artifact.final_form.tiempo_minutos}min | eventos=${ev.length}`;
  return { line, problems };
}

main().catch((err) => { console.error(err); process.exit(1); });
