/**
 * guion-directives.js (incidente) — extrae de un turno AGENT del guion las
 * directivas que rigen la respuesta del mock: los valores EXACTOS que la
 * ficha debe capturar (ids, horas, textos de eventos/pendientes, severidad).
 * ESM, sin dependencias, DOM-free.
 *
 * Fuentes (en ambas lenguas que usan los guiones):
 *  a) Campos estructurados del turno: add_evento {hora,evento} (objeto o
 *     arreglo), add_servicios [{id}], correct_to (objeto {hora} o {id}, o
 *     arreglo de {id}).
 *  b) El `hint` en prosa con llamadas entre paréntesis y citas:
 *     get_incidente(IC-2003) · set_que_paso · buscar_servicio('consulta') ·
 *     agregar_servicio_afectado(SRV-X) · agregar_evento_timeline(hora '09:20',
 *     evento '…') y ('10:20', '…') · set_severidad(alta) ·
 *     agregar_action_item('…') y ('…') · enviar_reporte() ·
 *     resumen citado tras "lee el resumen:" / "propone el resumen:".
 *
 * El resultado SIEMPRE tiene todas las llaves (arreglos vacíos / null) para
 * que el mock lo consuma sin guardas.
 */

const EMPTY = () => ({
  hasAgentTurn: false,
  getIncidente: null,
  setQuePaso: false,
  eventos: [],
  buscar: null,
  addServicios: [],
  correctServicio: null,
  correctHora: null,
  setSeveridad: null,
  actionItems: [],
  enviar: false,
  resumen: null,
});

/**
 * @param {object} agentTurn turno role:'agent' del guion (con hint y campos
 *   estructurados opcionales)
 * @returns {object} directivas normalizadas (ver EMPTY)
 */
export function parseAgentDirectives(agentTurn) {
  const d = EMPTY();
  if (!agentTurn || agentTurn.role !== 'agent') return d;
  d.hasAgentTurn = true;
  const hint = String(agentTurn.hint ?? '');

  /* ---------------------- campos estructurados ---------------------- */
  const addEvento = agentTurn.add_evento ?? agentTurn.add_eventos ?? null;
  if (addEvento) {
    for (const ev of Array.isArray(addEvento) ? addEvento : [addEvento]) {
      if (ev?.hora) d.eventos.push({ hora: ev.hora, evento: String(ev.evento ?? '') });
    }
  }
  const addServicios = agentTurn.add_servicios ?? agentTurn.add_servicio ?? null;
  if (addServicios) {
    for (const s of Array.isArray(addServicios) ? addServicios : [addServicios]) {
      if (s?.id) d.addServicios.push(s.id);
    }
  }
  const ct = agentTurn.correct_to ?? null;
  if (ct) {
    const arr = Array.isArray(ct) ? ct : [ct];
    for (const c of arr) {
      if (c?.hora) d.correctHora = c.hora;
      else if (c?.id) d.correctServicio = c.id;
    }
  }

  /* ----------------------------- hint ------------------------------- */
  let m = /get_incidente\s*\(\s*(IC-[\d]+)?\s*\)/.exec(hint);
  if (m) d.getIncidente = m[1] ?? d.getIncidente;
  if (/set_que_paso/.test(hint)) d.setQuePaso = true;

  // eventos: forma nombrada y forma corta "y ('10:20', '…')"
  const evRe = /agregar_evento_timeline\s*\(\s*(?:hora\s*)?'(\d{1,2}:\d{2})'\s*,\s*(?:evento\s*)?'([^']+)'\s*\)/g;
  while ((m = evRe.exec(hint)) !== null) d.eventos.push({ hora: m[1], evento: m[2] });
  const evCorta = /\by\s*\(\s*'(\d{1,2}:\d{2})'\s*,\s*'([^']+)'\s*\)/g;
  while ((m = evCorta.exec(hint)) !== null) d.eventos.push({ hora: m[1], evento: m[2] });

  m = /buscar_servicio\s*\(\s*'([^']+)'\s*\)/.exec(hint);
  if (m) d.buscar = m[1];

  const addRe = /agregar_servicio_afectado\s*\(\s*(SRV-[A-Z0-9-]+)\s*\)/g;
  while ((m = addRe.exec(hint)) !== null) d.addServicios.push(m[1]);

  m = /set_severidad\s*\(\s*(baja|media|alta|critica)\s*\)/.exec(hint);
  if (m) d.setSeveridad = m[1];

  // action items: forma nombrada + formas cortas "y ('…')"
  const aiRe = /agregar_action_item\s*\(\s*'([^']+)'\s*\)/g;
  while ((m = aiRe.exec(hint)) !== null) d.actionItems.push(m[1]);
  const aiCorto = /\by\s*\(\s*'([^'\d][^']{5,})'\s*\)/g;
  while ((m = aiCorto.exec(hint)) !== null) d.actionItems.push(m[1]);

  if (/enviar_reporte\s*\(/.test(hint)) d.enviar = true;

  // resumen citado (se excluye la lectura hablada "Te resumo: …" cortada)
  m = /(?:resumen|resumo)[^:'\n]{0,60}:\s*'([^']{15,})'/.exec(hint);
  if (m) {
    const texto = m[1].replace(/^te resumo\s*:?\s*/i, '').trim();
    if (texto.length >= 10) d.resumen = texto;
  }

  // dedup preservando orden
  d.eventos = dedupBy(d.eventos, (e) => e.hora);
  d.addServicios = [...new Set(d.addServicios)];
  d.actionItems = [...new Set(d.actionItems)];
  return d;
}

function dedupBy(arr, key) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}
