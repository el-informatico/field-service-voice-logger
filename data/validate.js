#!/usr/bin/env node
// Validador de data/ — ESM, cero dependencias. Exit 1 en cualquier problema.
// Uso: node data/validate.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const errors = [];
const ok = (cond, msg) => { if (!cond) errors.push(msg); };

const readJson = (rel) => {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
  } catch (e) {
    errors.push(`No se pudo leer/parsear ${rel}: ${e.message}`);
    return null;
  }
};

// ---------- ordenes.json ----------
const ordenes = readJson("ordenes.json");
const orderIds = new Set();
if (ordenes) {
  ok(Array.isArray(ordenes) && ordenes.length === 10, `ordenes.json: se esperaban 10 órdenes, hay ${ordenes?.length}`);
  const esperadas = Array.from({ length: 10 }, (_, i) => `OT-${1001 + i}`);
  const ids = ordenes.map((o) => o.id);
  ok(esperadas.every((id) => ids.includes(id)), `ordenes.json: faltan IDs OT-1001..OT-1010 (tengo ${ids.join(",")})`);
  const camposO = ["id", "cliente", "sitio", "equipo", "equipo_id", "problema_reportado", "tecnico", "prioridad", "industria", "estado", "creada"];
  let hvac = 0, elec = 0, tecnicos = new Set();
  for (const o of ordenes) {
    orderIds.add(o.id);
    for (const c of camposO) ok(typeof o[c] === "string" && o[c].length > 0, `ordenes ${o.id}: campo '${c}' ausente o vacío`);
    ok(["HVAC", "electrico"].includes(o.industria), `ordenes ${o.id}: industria inválida '${o.industria}' (HVAC|electrico)`);
    ok(["alta", "media", "baja"].includes(o.prioridad), `ordenes ${o.id}: prioridad inválida '${o.priorida ?? o.prioridad}'`);
    if (o.industria === "HVAC") hvac++; else elec++;
    tecnicos.add(o.tecnico);
  }
  ok(hvac === 5 && elec === 5, `ordenes.json: se esperaban 5 HVAC + 5 electrico, hay ${hvac}/${elec}`);
  ok(tecnicos.size === 10, `ordenes.json: se esperaban 10 técnicos distintos, hay ${tecnicos.size}`);
}

// ---------- piezas.json ----------
const piezas = readJson("piezas.json");
const skus = new Set();
if (piezas) {
  ok(piezas.length === 25, `piezas.json: se esperaban 25 piezas, hay ${piezas.length}`);
  const camposP = ["sku", "nombre", "alias", "tipo", "compatible_con", "unidad", "confundible_con"];
  const paresRequeridos = [
    ["VLV-034-BR", "VLV-038-BR"], ["CAP-ARR-355", "CAP-ARR-455"],
    ["BRK-020-2P", "BRK-030-2P"], ["MAN-012-NE", "MAN-058-NE"], ["VLV-012-BR"],
  ];
  const skuSet = new Set(piezas.map((p) => p.sku));
  for (const p of piezas) {
    skus.add(p.sku);
    for (const c of camposP) ok(c in p, `pieza ${p.sku}: falta el campo '${c}'`);
    ok(Array.isArray(p.alias) && p.alias.length >= 2 && p.alias.length <= 4, `pieza ${p.sku}: alias debe tener 2-4 entradas (tiene ${p.alias?.length})`);
    ok(p.alias.every((a) => typeof a === "string" && a === a.toLowerCase()), `pieza ${p.sku}: alias deben ser strings en minúsculas`);
    ok(p.alias.every((a) => !/[ÁÉÍÓÚÑ]/.test(a)), `pieza ${p.sku}: alias no deben tener mayúsculas acentuadas`);
    ok(p.confundible_con === null || (Array.isArray(p.confundible_con) && p.confundible_con.every((s) => skuSet.has(s))),
      `pieza ${p.sku}: confundible_con referencia SKU inexistente (${JSON.stringify(p.confundible_con)})`);
    ok(Array.isArray(p.compatible_con) && p.compatible_con.length > 0 && p.compatible_con.every((g) => typeof g === "string" && g.endsWith("*")),
      `pieza ${p.sku}: compatible_con debe ser glob(s) terminados en '*'`);
  }
  for (const par of paresRequeridos) {
    for (const s of par) ok(skuSet.has(s), `piezas.json: falta el SKU requerido ${s}`);
  }
  ok(skuSet.has("VLV-034-BR") && skuSet.has("VLV-038-BR"), "piezas.json: falta el par confundible de válvulas 3/4 vs 3/8");
  ok(skuSet.has("VLV-012-BR"), "piezas.json: falta VLV-012-BR (destino de la corrección en s3)");
  // Cobertura de acentos a nivel catálogo: piezas que combinan alias con y sin
  // acento (válvula/valvula, cápsula/capsula, termomagnético/termomagnetico...)
  // y las familias de jerga acentuables deben existir en AMBAS grafías.
  const tieneAcento = (s) => /[áéíóúñ]/.test(s);

  const sinAcentos = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const duales = piezas.filter((p) => p.alias.some(tieneAcento) && p.alias.some((a) => !tieneAcento(a)));
  ok(duales.length >= 8, `piezas.json: se esperaban ≥8 piezas con alias con y sin acento, hay ${duales.length}`);
  const todas = piezas.flatMap((p) => p.alias);
  const famRe = (fam) => new RegExp(`\\b${fam}\\b`);
  for (const fam of ["valvula", "capsula", "termomagnetico", "ceramico"]) {
    ok(todas.some((a) => famRe(fam).test(sinAcentos(a)) && tieneAcento(a)) && todas.some((a) => famRe(fam).test(a) && !tieneAcento(a)),
      `piezas.json: la jerga '${fam}' debe aparecer con y sin acento entre los alias`);
  }

  // ≥2 órdenes con equipo compatible con al menos una válvula
  const globMatch = (pat, id) => new RegExp("^" + pat.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(id);
  const valvulas = piezas.filter((p) => p.tipo === "valvula");
  const compat = ordenes.filter((o) => valvulas.some((v) => v.compatible_con.some((g) => globMatch(g, o.equipo_id))));
  ok(compat.length >= 2, `ordenes.json: se esperaban ≥2 órdenes con equipo compatible con válvulas, hay ${compat.length} (${compat.map((o) => o.id).join(",")})`);
}

// ---------- guiones + ground-truth ----------
const escenarios = ["s1-happy-path", "s2-pieza-mal-oida", "s3-barge-in"];
for (const sid of escenarios) {
  const g = readJson(`guiones/${sid}.json`);
  const gt = readJson(`ground-truth/gt-${sid}.json`);
  if (!g || !gt) continue;

  ok(g.scenario_id === sid, `guiones/${sid}.json: scenario_id debería ser '${sid}'`);
  ok(gt.scenario_id === sid, `ground-truth/gt-${sid}.json: scenario_id debería ser '${sid}'`);
  ok(g.order_id === gt.order_id && orderIds.has(g.order_id), `gt-${sid}: order_id '${g.order_id}' no coincide o no existe en ordenes.json`);
  ok(g.noise_condition === gt.noise_condition, `gt-${sid}: noise_condition difiere entre guion y GT`);
  ok(Array.isArray(g.turns) && g.turns.length > 0, `guiones/${sid}.json: turns vacío`);
  ok(g.noise_condition === "clean", `guiones/${sid}.json: noise_condition debe ser 'clean' en semilla`);

  let nPrev = 0, userTurns = [], rolesAlternan = true;
  for (const t of g.turns) {
    ok(t.n === nPrev + 1, `guiones/${sid}.json: numeración de turnos rota en n=${t.n}`);
    nPrev = t.n;
    if (t.role === "user") {
      ok(typeof t.text === "string" && t.text.length > 0, `guiones/${sid}.json t${t.n}: user sin text`);
      ok(t.expect === undefined || /^(tool:[a-z_]+(\s*\|[a-z_:\s]*)?|readback|none)$/.test(t.expect), `guiones/${sid}.json t${t.n}: expect inválido '${t.expect}'`);
      userTurns.push(t);
    } else if (t.role === "agent") {
      ok(typeof t.hint === "string" && t.hint.length > 0, `guiones/${sid}.json t${t.n}: agent sin hint`);
    } else {
      ok(false, `guiones/${sid}.json t${t.n}: role inválido '${t.role}'`);
    }
    // turnos estrictamente alternados user/agent
    if (rolesAlternan && t.n > 1) {
      const prev = g.turns[t.n - 2];
      if (prev && prev.role === t.role) rolesAlternan = false;
    }
  }
  ok(rolesAlternan, `guiones/${sid}.json: los turnos deben alternar user/agent`);

  const counts = { "s1-happy-path": [10, 14], "s2-pieza-mal-oida": [9, 14], "s3-barge-in": [8, 14] }[sid];
  ok(userTurns.length >= counts[0] && userTurns.length <= counts[1],
    `guiones/${sid}.json: se esperaban ${counts[0]}-${counts[1]} turnos de usuario, hay ${userTurns.length}`);

  // GT: user_utterances debe calzar 1:1 (n y texto) con los turnos user del guion
  const u = gt.user_utterances;
  ok(Array.isArray(u) && u.length === userTurns.length, `gt-${sid}: user_utterances (${u?.length ?? 0}) != turnos user del guion (${userTurns.length})`);
  for (let i = 0; i < Math.max(u?.length ?? 0, userTurns.length); i++) {
    const gtU = u?.[i], gU = userTurns[i];
    ok(!!gtU && !!gU && gtU.n === gU.n && gtU.text === gU.text,
      `gt-${sid}: user_utterances[${i}] no calza con el turno user n=${gU?.n} del guion`);
  }

  // expected_form
  const f = gt.expected_form;
  ok(f && ["problema", "diagnostico", "solucion", "piezas", "tiempo_minutos", "notas"].every((k) => k in f), `gt-${sid}: expected_form incompleto`);
  if (f) {
    ok(Array.isArray(f.piezas) && f.piezas.length > 0, `gt-${sid}: expected_form.piezas vacío`);
    for (const p of f.piezas) {
      ok(skus.has(p.sku), `gt-${sid}: piezas referencia SKU inexistente '${p.sku}'`);
      ok(Number.isInteger(p.qty) && p.qty >= 1, `gt-${sid}: qty inválida para ${p.sku}`);
    }
    ok(Number.isInteger(f.tiempo_minutos) && f.tiempo_minutos > 0, `gt-${sid}: tiempo_minutos inválido`);
  }

  // seeded_errors: solo s2 y s3, y sus SKUs deben existir
  const se = gt.seeded_errors;
  if (sid === "s1-happy-path") {
    ok(Array.isArray(se) && se.length === 0, `gt-${sid}: s1 no debe tener seeded_errors`);
  } else {
    ok(Array.isArray(se) && se.length >= 1, `gt-${sid}: se esperaba al menos 1 seeded_error`);
    for (const e of se) {
      ok(e.captured?.sku && skus.has(e.captured.sku), `gt-${sid}: seeded_error.captured SKU inexistente '${e.captured?.sku}'`);
      ok(e.truth?.sku && skus.has(e.truth.sku), `gt-${sid}: seeded_error.truth SKU inexistente '${e.truth?.sku}'`);
      ok(e.captured?.sku !== e.truth?.sku, `gt-${sid}: seeded_error con captured == truth no es un error`);
      ok(typeof e.rescued_by_confirmation === "boolean", `gt-${sid}: seeded_error.rescued_by_confirmation debe ser boolean`);
    }
  }

  // provoked_interruptions: solo s3 con 3
  const pi = gt.provoked_interruptions;
  if (sid === "s3-barge-in") {
    ok(Array.isArray(pi) && pi.length === 3, `gt-${sid}: se esperaban 3 provoked_interruptions, hay ${pi?.length}`);
    const agenteNs = new Set(g.turns.filter((t) => t.role === "agent").map((t) => t.n));
    for (const p of pi) ok(agenteNs.has(p.during_turn) && p.expected === "respected",
      `gt-${sid}: interrupción durante_turn=${p.during_turn} no apunta a un turno agent válido`);
  } else {
    ok(Array.isArray(pi) && pi.length === 0, `gt-${sid}: solo s3 lleva provoked_interruptions`);
  }
}

// ---------- resultado ----------
if (errors.length) {
  console.error(`FAIL (${errors.length}):`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("OK — data/ íntegra: 10 órdenes, 25 piezas, 3 guiones, 3 GT, integridad referencial y user_utterances verificados");
