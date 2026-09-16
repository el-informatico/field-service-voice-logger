#!/usr/bin/env node
/**
 * smoke-incidente.mjs — smoke test HEADLESS del dominio INCIDENTE (sin
 * browser, sin API key, CI-able). Espejo de smoke-example.mjs (orden).
 *
 * Carga data/ (incidentes + servicios + guiones-incidente + ground-truth),
 * corre una sesión completa por guion con el canal mock determinista del
 * dominio incidente (speed=Infinity) y escribe el artefacto §6 de cada sesión
 * en .data/smoke-incidente/. Al final imprime resumen (turnos, tool calls,
 * read-backs, barge-ins) y verifica la INVARIANTE de ficha vs ground-truth:
 * servicios (ids exactos, todos confirmados), severidad, timeline (horas
 * exactas + evento sim ≥ 0.6), action items (recall 100% a sim ≥ 0.6) y
 * estado=enviada. Exit 1 en cualquier desviación.
 *
 * Uso:   node web/js/smoke-incidente.mjs
 * Sales: .data/smoke-incidente/artifact-<scenario_id>.json
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '..');
const ROOT = resolve(WEB, '..');
const DATA = join(ROOT, 'data');

const { createIncidentStore } = await import(new URL('./domain/incident/store.js', import.meta.url).href);
const { createIncidentToolRunner } = await import(new URL('./domain/incident/tool-runner.js', import.meta.url).href);
const { createSessionEngine } = await import(new URL('./session-engine.js', import.meta.url).href);
const { createIncidentMockAgentChannel } = await import(new URL('./domain/incident/mock-agent.js', import.meta.url).href);
const { prepareIncidentGuion } = await import(new URL('./domain/incident/guion-sim.js', import.meta.url).href);
const {
  buildIncidentToolDefinitions, INCIDENT_TOOL_NAMES,
} = await import(new URL('./domain/incident/tools.js', import.meta.url).href);
// misma similitud Jaccard del harness de métricas (fuente única, sin divergencia)
const { similarity } = await import(new URL('../../metrics/lib/textnorm.js', import.meta.url).href);

const SIM_EVENTO = 0.6;   // contrato §7: evento del timeline sim ≥ 0.6
const SIM_ITEM = 0.6;     // contrato §7: recall de action items a sim ≥ 0.6

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

async function main() {
  const incidentes = await readJson(join(DATA, 'incidentes.json'));
  const servicios = await readJson(join(DATA, 'servicios.json'));
  let guionFiles = [];
  try {
    guionFiles = (await readdir(join(DATA, 'guiones-incidente'))).filter((f) => f.endsWith('.json')).sort();
  } catch {
    console.error('ERROR: no existe data/guiones-incidente/ — corre el bloque de datos del dominio incidente.');
    process.exit(1);
  }
  if (!incidentes?.length || !servicios?.length) {
    console.error('ERROR: data/incidentes.json o data/servicios.json vacíos/ausentes.');
    process.exit(1);
  }

  const outDir = join(ROOT, '.data', 'smoke-incidente');
  await mkdir(outDir, { recursive: true });

  // sanity: definiciones de tools con enum del catálogo de servicios
  const ids = servicios.map((s) => s.id);
  const defs = buildIncidentToolDefinitions(ids);
  const names = defs.map((d) => d.name).sort();
  const expected = [...INCIDENT_TOOL_NAMES].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    console.error('ERROR: buildIncidentToolDefinitions no coincide con INCIDENT_TOOL_NAMES:', names);
    process.exit(1);
  }
  const enumIds = defs.find((d) => d.name === 'agregar_servicio_afectado')
    ?.parameters?.properties?.id?.enum;
  if (enumIds?.length !== servicios.length) {
    console.error('ERROR: enum de id no cubre el catálogo de servicios');
    process.exit(1);
  }
  console.log(`tools OK: ${names.join(', ')} (enum servicios: ${enumIds.length})`);

  let failures = 0;
  for (const file of guionFiles) {
    const guion = await readJson(join(DATA, 'guiones-incidente', file));
    let gt = null;
    try { gt = await readJson(join(DATA, 'ground-truth-incidente', `gt-${guion.scenario_id}.json`)); } catch { /* sin GT */ }
    const label = guion.scenario_id ?? file;
    try {
      const artifact = await runSession({ incidentes, servicios, guion, gt });
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

async function runSession({ incidentes, servicios, guion, gt }) {
  const prepared = prepareIncidentGuion(guion, gt, servicios);
  const channel = createIncidentMockAgentChannel({
    incidentes, servicios, guion: prepared, speed: Infinity,
  });
  const store = createIncidentStore({ incidenteId: guion.incidente_id, now: () => channel.clock.now() });
  const runner = createIncidentToolRunner({ incidentes, servicios, store, clock: channel.clock });
  const session_id = `sess_smokeinc_${(guion.scenario_id ?? 'x').replace(/[^a-z0-9]+/gi, '_')}`;
  const engine = createSessionEngine({
    channel, toolRunner: runner, store,
    meta: {
      session_id, scenario_id: guion.scenario_id ?? null, mode: 'mock',
      order_id: guion.incidente_id, noise_condition: guion.ambiente ?? 'tranquilo',
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
  const f = artifact.final_form;
  const problems = [];

  if (artifact.schema_version !== 1) problems.push('schema_version != 1');
  if (!ev.length) problems.push('events vacío');
  if (toolCalls.length !== toolResults.length) problems.push('tool_call sin tool_result');
  if (f.estado !== 'enviada') problems.push('estado != enviada');
  if (!f.servicios_afectados.every((s) => s.confirmado)) problems.push('servicios sin confirmar');
  if (artifact.audio_retained !== false) problems.push('audio_retained != false');
  if (!f.que_paso) problems.push('que_paso vacío');
  if (!f.resumen) problems.push('resumen vacío');

  const sims = { resumen: null, que_paso: null };
  if (gt?.expected_form) {
    const exp = gt.expected_form;
    if (f.incidente_id !== exp.incidente_id) problems.push(`incidente_id ${f.incidente_id} ≠ GT ${exp.incidente_id}`);
    // servicios: set exacto de (id) + todos confirmados (contrato §7)
    const predIds = new Set(f.servicios_afectados.map((s) => s.id));
    const expIds = new Set(exp.servicios_afectados.map((s) => s.id));
    const sameServicios = predIds.size === expIds.size && [...expIds].every((x) => predIds.has(x));
    if (!sameServicios) {
      problems.push(`servicios ≠ GT: [${[...predIds]}] vs [${[...expIds]}]`);
    }
    // severidad exacta
    if (f.severidad !== exp.severidad) problems.push(`severidad ${f.severidad} ≠ GT ${exp.severidad}`);
    // timeline: misma multiset de horas + evento sim ≥ 0.6 (contrato §7)
    const predHoras = f.timeline.map((e) => e.hora).sort().join(',');
    const expHoras = exp.timeline.map((e) => e.hora).sort().join(',');
    if (predHoras !== expHoras) problems.push(`horas ≠ GT: [${predHoras}] vs [${expHoras}]`);
    else {
      for (const e of exp.timeline) {
        const pred = f.timeline.find((x) => x.hora === e.hora);
        const sim = similarity(pred?.evento ?? '', e.evento);
        if (sim < SIM_EVENTO) problems.push(`evento de ${e.hora} sim ${sim.toFixed(2)} < ${SIM_EVENTO}`);
      }
    }
    // action items: recall 100% (cada ítem GT cubierto por algún predicho, sim ≥ 0.6)
    const recallFails = exp.action_items.filter(
      (it) => !f.action_items.some((p) => similarity(p, it) >= SIM_ITEM),
    );
    if (recallFails.length) problems.push(`action_items sin cobertura GT: ${recallFails.map((x) => `"${x}"`).join('; ')}`);
    // texto largo: reportado, no gateado (paráfrasis GT vs literal del operador)
    sims.resumen = similarity(f.resumen ?? '', exp.resumen ?? '');
    sims.que_paso = similarity(f.que_paso ?? '', exp.que_paso ?? '');
  }

  const line = `✓ ${artifact.scenario_id}: turnos user=${userTurns.length} agente=${agentTurns.length}` +
    ` | tools=${toolCalls.length} | read-backs=${confirmsReq.length} (ok=${confirmsOk.length}, corrección=${confirmsNo.length})` +
    ` | barge-ins=${bargeIns.length}` +
    ` | ficha: ${f.servicios_afectados.map((s) => `${s.id}${s.confirmado ? '✓' : '?'}`).join(' · ')}` +
    ` | sev=${f.severidad ?? '?'} | timeline=${f.timeline.length} ev | items=${f.action_items.length}` +
    (sims.que_paso != null ? ` | sim que_paso=${sims.que_paso.toFixed(2)} resumen=${sims.resumen.toFixed(2)}` : '') +
    ` | eventos=${ev.length}`;
  return { line, problems };
}

main().catch((err) => { console.error(err); process.exit(1); });
