#!/usr/bin/env node
// Validador de data/ para el dominio INCIDENTE — ESM, cero dependencias.
// Exit 1 en cualquier problema. Uso: node data/validate-incidente.js
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
    errors.push(`Could not read/parse ${rel}: ${e.message}`);
    return null;
  }
};

const HORA_RE = /^\d{1,2}:\d{2}$/;
const EXPECT_RE = /^(tool:[a-z_]+(\s*\|[a-z_:\s]*)?|readback|none)$/;
const CREADA_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-\d{2}:\d{2}$/;
const SEVERIDADES = ["low", "medium", "high", "critical"];
const horaValida = (h) =>
  typeof h === "string" && HORA_RE.test(h) &&
  Number(h.split(":")[0]) <= 23 && Number(h.split(":")[1]) <= 59;

// ---------- incidentes.json ----------
const incidentes = readJson("incidentes.json");
const incidenteIds = new Set();
if (incidentes) {
  ok(Array.isArray(incidentes) && incidentes.length === 8, `incidentes.json: expected 8 incidents, found ${incidentes?.length}`);
  const esperados = Array.from({ length: 8 }, (_, i) => `IC-${2001 + i}`);
  const ids = incidentes.map((i) => i.id);
  ok(esperados.every((id) => ids.includes(id)), `incidentes.json: missing IDs IC-2001..IC-2008 (have ${ids.join(",")})`);
  const camposI = ["id", "cliente", "sitio", "reporte_inicial", "tecnico", "categoria", "estado", "creada"];
  let ti = 0, fac = 0;
  const tecnicos = new Set();
  for (const inc of incidentes) {
    incidenteIds.add(inc.id);
    for (const c of camposI) ok(typeof inc[c] === "string" && inc[c].length > 0, `incident ${inc.id}: field '${c}' missing or empty`);
    ok(inc.equipo === undefined || (typeof inc.equipo === "string" && inc.equipo.length > 0), `incident ${inc.id}: equipo must be a non-empty string if present`);
    ok(["TI", "facilities"].includes(inc.categoria), `incident ${inc.id}: invalid categoria '${inc.categoria}' (TI|facilities)`);
    ok(inc.estado === "open", `incident ${inc.id}: estado must be 'open' in the seed, found '${inc.estado}'`);
    ok(CREADA_RE.test(inc.creada ?? ""), `incident ${inc.id}: creada is not ISO with offset ('${inc.creada}')`);
    if (inc.categoria === "TI") ti++; else fac++;
    tecnicos.add(inc.tecnico);
  }
  ok(ti === 4 && fac === 4, `incidentes.json: expected 4 TI + 4 facilities, found ${ti}/${fac}`);
  ok(tecnicos.size === 8, `incidentes.json: expected 8 distinct technicians, found ${tecnicos.size}`);
}

// ---------- servicios.json ----------
const servicios = readJson("servicios.json");
const srvIds = new Set();
if (servicios) {
  ok(servicios.length === 15, `servicios.json: expected 15 services, found ${servicios.length}`);
  const camposS = ["id", "nombre", "alias", "tipo", "confundible_con"];
  const aliasDuenio = new Map();
  for (const s of servicios) {
    ok(!srvIds.has(s.id), `servicios.json: duplicate id '${s.id}'`);
    srvIds.add(s.id);
    for (const c of camposS) ok(c in s, `service ${s.id}: missing field '${c}'`);
    ok(Array.isArray(s.alias) && s.alias.length >= 2 && s.alias.length <= 4, `service ${s.id}: alias must have 2-4 entries (has ${s.alias?.length})`);
    ok(s.alias.every((a) => typeof a === "string" && a.length > 0 && a === a.toLowerCase()), `service ${s.id}: alias must be lowercase strings`);
    ok(s.confundible_con === null || (Array.isArray(s.confundible_con) && s.confundible_con.length > 0),
      `service ${s.id}: confundible_con must be null or a non-empty array`);
    for (const a of s.alias) {
      ok(!aliasDuenio.has(a), `servicios.json: alias '${a}' repeated between ${aliasDuenio.get(a)} and ${s.id}`);
      aliasDuenio.set(a, s.id);
    }
  }
  for (const s of servicios) {
    if (Array.isArray(s.confundible_con)) {
      for (const ref of s.confundible_con) {
        ok(srvIds.has(ref), `service ${s.id}: confundible_con references nonexistent id '${ref}'`);
        const otro = servicios.find((x) => x.id === ref);
        ok(otro?.id !== s.id, `service ${s.id}: cannot be confusable with itself`);
        ok(Array.isArray(otro?.confundible_con) && otro.confundible_con.includes(s.id),
          `service ${s.id}: confusability not symmetric with '${ref}'`);
      }
    }
  }
  const paresRequeridos = [
    ["SRV-WEB-PROD", "SRV-WEB-STG"], ["SRV-RACK-A3", "SRV-RACK-A8"],
    ["SRV-BOMBA-PRIMARIA", "SRV-BOMBA-SECUNDARIA"], ["SRV-CORREO-PROD", "SRV-CORREO-BACKUP"],
  ];
  for (const [a, b] of paresRequeridos) {
    ok(srvIds.has(a) && srvIds.has(b), `servicios.json: missing required confusable pair ${a}↔${b}`);
    const sa = servicios.find((x) => x.id === a), sb = servicios.find((x) => x.id === b);
    ok(sa?.confundible_con?.includes(b) && sb?.confundible_con?.includes(a),
      `servicios.json: pair ${a}↔${b} must be mutually confusable`);
  }
}

// ---------- guiones + ground-truth (dominio incidente) ----------
const escenarios = ["i1-dictado-feliz", "i2-servicio-confundido", "i3-correccion-hora", "i4-mixto"];
const userTurnosRango = {
  "i1-dictado-feliz": [10, 12],
  "i2-servicio-confundido": [9, 11],
  "i3-correccion-hora": [9, 11],
  "i4-mixto": [9, 11],
};
const erroresPorEscenario = {
  "i1-dictado-feliz": 0,
  "i2-servicio-confundido": 2,
  "i3-correccion-hora": 1,
  "i4-mixto": 1,
};

for (const sid of escenarios) {
  const g = readJson(`guiones-incidente/${sid}.json`);
  const gt = readJson(`ground-truth-incidente/gt-${sid}.json`);
  if (!g || !gt) continue;

  ok(g.scenario_id === sid, `guiones-incidente/${sid}.json: scenario_id should be '${sid}'`);
  ok(gt.scenario_id === sid, `ground-truth-incidente/gt-${sid}.json: scenario_id should be '${sid}'`);
  ok(g.ambiente === "tranquilo" && gt.ambiente === "tranquilo", `gt-${sid}: ambiente must be 'tranquilo' in script and GT`);
  ok(incidenteIds.has(g.incidente_id), `guiones-incidente/${sid}.json: incidente_id '${g.incidente_id}' does not exist in incidentes.json`);
  ok(g.incidente_id === gt.incidente_id, `gt-${sid}: incidente_id differs between script and GT`);
  ok(Array.isArray(g.turns) && g.turns.length > 0, `guiones-incidente/${sid}.json: turns empty`);

  let nPrev = 0, userTurns = [], rolesAlternan = true;
  const agentNs = new Set();
  for (const t of g.turns) {
    ok(t.n === nPrev + 1, `guiones-incidente/${sid}.json: turn numbering broken at n=${t.n}`);
    nPrev = t.n;
    if (t.role === "user") {
      ok(typeof t.text === "string" && t.text.length > 0, `guiones-incidente/${sid}.json t${t.n}: user missing text`);
      ok(t.expect === undefined || EXPECT_RE.test(t.expect), `guiones-incidente/${sid}.json t${t.n}: invalid expect '${t.expect}'`);
      if ("as_heard" in t) {
        ok(typeof t.as_heard === "string" && t.as_heard.length > 0, `guiones-incidente/${sid}.json t${t.n}: as_heard empty`);
        ok(t.as_heard !== t.text, `guiones-incidente/${sid}.json t${t.n}: as_heard identical to text does not model an error`);
      }
      if ("interrupt" in t) ok(t.interrupt === true, `guiones-incidente/${sid}.json t${t.n}: interrupt must be true when declared`);
      userTurns.push(t);
    } else if (t.role === "agent") {
      ok(typeof t.hint === "string" && t.hint.length > 0, `guiones-incidente/${sid}.json t${t.n}: agent missing hint`);
      agentNs.add(t.n);
      if (Array.isArray(t.add_servicios)) {
        for (const p of t.add_servicios) ok(srvIds.has(p.id), `guiones-incidente/${sid}.json t${t.n}: add_servicios references nonexistent id '${p.id}'`);
      }
      if (Array.isArray(t.correct_to)) {
        for (const p of t.correct_to) ok(srvIds.has(p.id), `guiones-incidente/${sid}.json t${t.n}: correct_to references nonexistent id '${p.id}'`);
      } else if (t.correct_to && typeof t.correct_to === "object") {
        ok(horaValida(t.correct_to.hora), `guiones-incidente/${sid}.json t${t.n}: invalid correct_to.hora '${t.correct_to.hora}'`);
      }
      if (t.add_evento) {
        ok(horaValida(t.add_evento.hora), `guiones-incidente/${sid}.json t${t.n}: invalid add_evento.hora '${t.add_evento.hora}'`);
        ok(typeof t.add_evento.evento === "string" && t.add_evento.evento.length > 0, `guiones-incidente/${sid}.json t${t.n}: add_evento.evento empty`);
      }
    } else {
      ok(false, `guiones-incidente/${sid}.json t${t.n}: invalid role '${t.role}'`);
    }
    if (rolesAlternan && t.n > 1) {
      const prev = g.turns[t.n - 2];
      if (prev && prev.role === t.role) rolesAlternan = false;
    }
  }
  ok(rolesAlternan, `guiones-incidente/${sid}.json: turns must alternate user/agent`);

  const [minU, maxU] = userTurnosRango[sid];
  ok(userTurns.length >= minU && userTurns.length <= maxU,
    `guiones-incidente/${sid}.json: expected ${minU}-${maxU} user turns, found ${userTurns.length}`);

  // GT: user_utterances debe calzar 1:1 (n y texto) con los turnos user del guion
  const u = gt.user_utterances;
  ok(Array.isArray(u) && u.length === userTurns.length, `gt-${sid}: user_utterances (${u?.length ?? 0}) != user turns in script (${userTurns.length})`);
  for (let i = 0; i < Math.max(u?.length ?? 0, userTurns.length); i++) {
    const gtU = u?.[i], gU = userTurns[i];
    ok(!!gtU && !!gU && gtU.n === gU.n && gtU.text === gU.text,
      `gt-${sid}: user_utterances[${i}] does not match user turn n=${gU?.n} in script`);
  }

  // expected_form (contrato §2)
  const f = gt.expected_form;
  ok(f && ["incidente_id", "resumen", "que_paso", "timeline", "servicios_afectados", "action_items", "severidad", "estado"].every((k) => k in f),
    `gt-${sid}: expected_form incomplete`);
  if (f) {
    ok(f.incidente_id === g.incidente_id, `gt-${sid}: expected_form.incidente_id '${f.incidente_id}' != incident in script`);
    ok(typeof f.resumen === "string" && f.resumen.length > 0, `gt-${sid}: resumen empty`);
    ok(typeof f.que_paso === "string" && f.que_paso.length > 0, `gt-${sid}: que_paso empty`);
    ok(Array.isArray(f.timeline) && f.timeline.length > 0, `gt-${sid}: timeline empty`);
    for (const ev of f.timeline) {
      ok(horaValida(ev.hora), `gt-${sid}: timeline invalid hora '${ev?.hora}' (expected ^\\d{1,2}:\\d{2}$)`);
      ok(typeof ev.evento === "string" && ev.evento.length > 0, `gt-${sid}: timeline empty evento for hora '${ev?.hora}'`);
    }
    ok(Array.isArray(f.servicios_afectados) && f.servicios_afectados.length > 0, `gt-${sid}: servicios_afectados empty`);
    for (const s of f.servicios_afectados) {
      ok(srvIds.has(s.id), `gt-${sid}: servicios_afectados references nonexistent id '${s.id}'`);
      ok(s.confirmado === undefined || typeof s.confirmado === "boolean", `gt-${sid}: confirmado must be boolean`);
    }
    ok(Array.isArray(f.action_items) && f.action_items.length > 0 &&
      f.action_items.every((a) => typeof a === "string" && a.length > 0), `gt-${sid}: action_items empty or with empty entries`);
    ok(SEVERIDADES.includes(f.severidad), `gt-${sid}: invalid severidad '${f.severidad}' (${SEVERIDADES.join("|")})`);
    ok(f.estado === "sent", `gt-${sid}: estado must be 'sent' at close, found '${f.estado}'`);
  }

  // seeded_errors: forma y referencias según escenario
  const se = gt.seeded_errors;
  ok(Array.isArray(se) && se.length === erroresPorEscenario[sid],
    `gt-${sid}: expected ${erroresPorEscenario[sid]} seeded_errors, found ${se?.length ?? 0}`);
  if (Array.isArray(se)) {
    for (const e of se) {
      ok(typeof e.rescued_by_confirmation === "boolean" && e.rescued_by_confirmation,
        `gt-${sid}: seeded_error (${e.field}) must be rescued by confirmation`);
      if (e.field === "servicio") {
        ok(srvIds.has(e.captured?.id) && srvIds.has(e.truth?.id), `gt-${sid}: service seeded_error references nonexistent id`);
        ok(e.captured?.id !== e.truth?.id, `gt-${sid}: service seeded_error with captured == truth is not an error`);
      } else if (e.field === "severidad") {
        ok(SEVERIDADES.includes(e.captured) && SEVERIDADES.includes(e.truth), `gt-${sid}: severidad seeded_error outside enum`);
        ok(e.captured !== e.truth, `gt-${sid}: severidad seeded_error with captured == truth is not an error`);
      } else if (e.field === "hora") {
        ok(horaValida(e.captured) && horaValida(e.truth), `gt-${sid}: hora seeded_error with invalid format`);
        ok(e.captured !== e.truth, `gt-${sid}: hora seeded_error with captured == truth is not an error`);
      } else {
        ok(false, `gt-${sid}: seeded_error with unknown field '${e.field}'`);
      }
    }
    if (sid === "i2-servicio-confundido") {
      ok(se.some((e) => e.field === "servicio" && e.captured?.id === "SRV-WEB-STG" && e.truth?.id === "SRV-WEB-PROD"),
        `gt-${sid}: missing seeded error WEB-STG→WEB-PROD`);
      ok(se.some((e) => e.field === "severidad" && e.captured === "medium" && e.truth === "high"),
        `gt-${sid}: missing severidad seeded error medium→high`);
    }
    if (sid === "i3-correccion-hora") {
      ok(se.some((e) => e.field === "hora" && e.captured === "09:20" && e.truth === "09:40"),
        `gt-${sid}: missing hora seeded error 09:20→09:40`);
    }
    if (sid === "i4-mixto") {
      ok(se.some((e) => e.field === "servicio" && e.captured?.id === "SRV-RACK-A8" && e.truth?.id === "SRV-RACK-A3"),
        `gt-${sid}: missing seeded error RACK-A8→RACK-A3`);
    }
  }

  // provoked_interruptions: calzan con los turnos interrupt:true del guion
  const pi = gt.provoked_interruptions;
  const interruptsGuion = userTurns.filter((t) => t.interrupt === true);
  if (sid === "i3-correccion-hora") {
    ok(Array.isArray(pi) && pi.length === 1, `gt-${sid}: expected exactly 1 provoked_interruption, found ${pi?.length ?? 0}`);
    ok(interruptsGuion.length === 1, `guiones-incidente/${sid}.json: expected exactly 1 turn with interrupt:true, found ${interruptsGuion.length}`);
    ok(interruptsGuion.every((t) => /(espera|wait)—/i.test(t.text)), `guiones-incidente/${sid}.json: the interruption must start with 'espera—' or 'wait—'`);
  } else {
    ok(Array.isArray(pi) && pi.length === 0, `gt-${sid}: only i3 has provoked_interruptions`);
    ok(interruptsGuion.length === 0, `guiones-incidente/${sid}.json: there must be no turns with interrupt:true`);
  }
  if (Array.isArray(pi)) {
    ok(pi.length === interruptsGuion.length, `gt-${sid}: provoked_interruptions (${pi.length}) != interrupt:true turns in script (${interruptsGuion.length})`);
    for (const p of pi) {
      ok(agentNs.has(p.during_turn) && p.expected === "respected",
        `gt-${sid}: interruption during_turn=${p.during_turn} does not point to a valid agent turn`);
      const t = g.turns.find((x) => x.n === p.during_turn + 1);
      ok(t?.role === "user" && t.interrupt === true,
        `gt-${sid}: interruption during_turn=${p.during_turn} must correspond to the interrupt user turn at n=${p.during_turn + 1}`);
    }
  }
}

// ---------- resultado ----------
if (errors.length) {
  console.error(`FAIL (${errors.length}):`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("OK — data/ incident domain intact: 8 incidents, 15 services (4 confusable pairs), 4 scripts, 4 ground truths, referential integrity, user_utterances and seeded errors verified");
