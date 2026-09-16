/**
 * dialog.js (incidente) — utilidades de texto ES para los actos de diálogo del
 * operador post-visita. ESM, sin dependencias, DOM-free (browser + Node 22).
 *
 * Es el equivalente incidente de los helpers de web/js/dialog-act.js que no son
 * reutilizables tal cual: horas del timeline (habladas y digitales), severidad,
 * detección de mención de servicio y read-back de horas. La normalización y las
 * confirmaciones SÍ se reutilizan de dialog-act.js (compartido, intocado).
 */
import { normalizeText, tokenSet, stripAccents } from '../../dialog-act.js';

/* ------------------------------------------------------------------ */
/* Horas                                                               */
/* ------------------------------------------------------------------ */

/** Palabra → dígito para horas/minutos (0–59, suficiente para el timeline). */
const NUM_WORD = {
  cero: 0, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiuna: 21, veintiuno: 21, veintidos: 22,
  veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30,
  treintaiuna: 31, treintaicinco: 35, cuarenta: 40, cuarentaicinco: 45,
  cincuenta: 50, cincuentaicinco: 55,
};

/** Dígito → palabra para el read-back (0–59). */
const DIGIT_WORD = [
  'cero', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho',
  'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis',
  'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuna', 'veintidós',
  'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete',
  'veintiocho', 'veintinueve', 'treinta', 'treinta y una', 'treinta y dos',
  'treinta y tres', 'treinta y cuatro', 'treinta y cinco', 'treinta y seis',
  'treinta y siete', 'treinta y ocho', 'treinta y nueve', 'cuarenta',
  'cuarenta y una', 'cuarenta y dos', 'cuarenta y tres', 'cuarenta y cuatro',
  'cuarenta y cinco', 'cuarenta y seis', 'cuarenta y siete', 'cuarenta y ocho',
  'cuarenta y nueve', 'cincuenta', 'cincuenta y una', 'cincuenta y dos',
  'cincuenta y tres', 'cincuenta y cuatro', 'cincuenta y cinco',
  'cincuenta y seis', 'cincuenta y siete', 'cincuenta y ocho',
  'cincuenta y nueve',
];

/** ¿Hora válida del contrato §5? "9:20" y "09:20" sí; "9:5" o "abc" no. */
export function esHoraValida(hora) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora ?? '').trim());
  if (!m) return false;
  const h = +m[1];
  const min = +m[2];
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

/** "9:20" → "09:20" (forma canónica del timeline, siempre HH:MM). */
export function canonHora(hora) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora ?? '').trim());
  if (!m) return null;
  return `${String(+m[1]).padStart(2, '0')}:${m[2]}`;
}

/** "09:20" → 'NUEVE VEINTE' (para el read-back en voz alta). */
export function speakHora(hora) {
  const c = canonHora(hora);
  if (!c) return String(hora ?? '');
  const [h, min] = c.split(':').map(Number);
  const horaSpeech = h === 0 ? 'DOCE' : DIGIT_WORD[h] ?? String(h);
  const horaSpeechUp = horaSpeech.toUpperCase();
  if (min === 0) return `${horaSpeechUp} EN PUNTO`;
  if (min === 15) return `${horaSpeechUp} Y CUARTO`;
  if (min === 30) return `${horaSpeechUp} Y MEDIA`;
  return `${horaSpeechUp} ${(DIGIT_WORD[min] ?? String(min)).toUpperCase()}`;
}

/**
 * Extrae TODAS las horas mencionadas en el texto, en orden de aparición.
 * Acepta la forma digital ("09:20", "9:20") y la hablada ya normalizada por
 * normalizeText ("a las nueve veinte" → "a las 9 20"; "nueve y media" →
 * "9 30"; "once cero cinco" → "11 0 5" → 11:05). Solo cuenta si el contexto
 * delata hora: preposición + la/las ("a las", "sobre las", "como a las",
 * "casi las") o verbo horario con o sin artículo ("era (las) nueve cuarenta").
 * @returns {Array<{hora: string, idx: number}>} hora canónica "HH:MM"
 */
export function parseHoras(text) {
  const t = digitizeHourWords(normalizeText(text));
  const out = [];
  const push = (h, min, idx) => {
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      out.push({ hora: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`, idx });
    }
  };
  // 1) forma digital "9:20"
  const digital = /\b(\d{1,2}):(\d{2})\b/g;
  let m;
  while ((m = digital.exec(t)) !== null) push(+m[1], +m[2], m.index);
  // 2) forma hablada normalizada: "a las 9 20", "era 9 40", "como a las 11 0 5"
  const spoken = /\b(?:a|de|desde|hasta|sobre|como|casi|para|pasaban|pasaron|eran|era|serian)\s+(?:(?:la|las)\s+)?(\d{1,2})(?:\s+(?:y|con)\s+|\s+)(?:(\d{1,2})\s+(\d{1,2})\b|(\d{2})\b|(\d)\b|(media|cuarto)\b)/g;
  while ((m = spoken.exec(t)) !== null) {
    const h = +m[1];
    let min = null;
    if (m[2] != null && m[3] != null) min = +m[2] * 10 + +m[3]; // "11 0 5" → 05
    else if (m[4] != null) min = +m[4];
    else if (m[5] != null) min = null; // "a las 9" sola: sin minutos no hay hora útil
    else if (m[6] === 'media') min = 30;
    else if (m[6] === 'cuarto') min = 15;
    if (min == null) continue;
    push(h, min, m.index);
  }
  return out.sort((a, b) => a.idx - b.idx);
}

/**
 * Palabra-número → dígito para horas (0–50, incluidas las que normalizeText
 * deja como palabra al fallar el span — p. ej. con coma pegada: "cinco,").
 * También fusiona los minutos compuestos que quedan partidos ("9 40 y 5" →
 * "9 45"; NUNCA "10 y 5", que es hora y minutos sueltos).
 */
const HORA_NUM_WORD = {
  cero: 0, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiuna: 21, veintiuno: 21, veintidos: 22,
  veintitres: 23, veinticuatro: 24, treinta: 30, cuarenta: 40, cincuenta: 50,
};
function digitizeHourWords(t) {
  const s = String(t ?? '').split(' ')
    .map((w) => {
      const core = w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
      return Object.prototype.hasOwnProperty.call(HORA_NUM_WORD, core)
        ? w.replace(core, String(HORA_NUM_WORD[core]))
        : w;
    })
    .join(' ');
  return s.replace(/(?<=\d\s)([1-5]0)\s+y\s+([1-9])\b/g, (_m, decenas, unidades) => String(Number(decenas) + Number(unidades)));
}

/* ------------------------------------------------------------------ */
/* Severidad                                                           */
/* ------------------------------------------------------------------ */

/**
 * Severidad declarada en el texto → 'baja'|'media'|'alta'|'critica' | null.
 * Acepta "severidad alta", "gravedad crítica", "ponle media", "es alta",
 * "Ponle alta" o la palabra suelta ABIRIENDO el turno ("Media... porque ya
 * quedó"). alto→alta, crítica→critica, grave→critica; siempre ANCLADO a un
 * detonante para no confundir con "el rack alto".
 */
export function parseSeveridad(text) {
  const t = normalizeText(text);
  const nivel = { baja: 'baja', media: 'media', alta: 'alta', alto: 'alta', critica: 'critica', critico: 'critica', grave: 'critica' };
  let m = /\b(?:severidad|gravedad|urgencia|prioridad|nivel)\s+(?:es\s+|de\s+|:?\s*)(muy\s+)?(baja|media|alta|alto|critica|critico|grave)\b/.exec(t);
  if (m) return nivel[m[2]];
  m = /\b(?:ponle|pon|ponla|marcale|apuntale|declara|es|era|quedo|marco|definio|le llamaron|le ponen)\s+(?:una\s+|un\s+|de\s+)?(baja|media|alta|alto|critica|critico|grave)\b/.exec(t);
  if (m) return nivel[m[1]];
  m = /^\s*(baja|media|alta|critica|critico|grave)\b/.exec(t); // abre el turno
  if (m) return nivel[m[1]];
  return null;
}

/* ------------------------------------------------------------------ */
/* Búsqueda tolerante de servicios (nombre + alias + id)               */
/* ------------------------------------------------------------------ */

const W_ID = 3;
const W_NOMBRE = 2;
const W_ALIAS = 2;
const BONUS_SUBSTRING = 3;
export const MIN_SCORE = 2;

/**
 * Puntúa todos los servicios contra una consulta hablada (mismo algoritmo que
 * buscar_pieza del dominio orden: solapamiento de tokens normalizados sobre
 * nombre + alias + id, con bonus si un campo completo va dentro de la
 * consulta). Orden estable: empate → orden de catálogo.
 * @returns {Array<{servicio, idx, score}>} solo score > 0, descendente
 */
export function scoreServicios(consulta, servicios = []) {
  const q = String(consulta ?? '');
  const qTokens = tokenSet(q);
  const qNorm = normalizeText(q);
  const scored = [];
  servicios.forEach((s, idx) => {
    let score = 0;
    const matched = new Set();
    const fields = [[String(s.id ?? ''), W_ID], [String(s.nombre ?? ''), W_NOMBRE],
      ...(s.alias ?? []).map((a) => [String(a), W_ALIAS])];
    for (const [field, weight] of fields) {
      const fNorm = normalizeText(field);
      if (fNorm && fNorm.length >= 3 && qNorm.includes(fNorm)) score += BONUS_SUBSTRING;
      const fTokens = tokenSet(field);
      for (const qt of qTokens) {
        if (matched.has(qt)) continue;
        if (fTokens.has(qt)) { score += weight; matched.add(qt); }
      }
    }
    if (score > 0) scored.push({ servicio: s, idx, score });
  });
  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  return scored;
}

/**
 * ¿El texto menciona un servicio/equipo del catálogo? Solo match FUERTE
 * (score ≥ 4 por tokens de nombre/alias/id): las palabras sueltas del giro
 * ("switch", "red", "sistema") aparecen de pasada en el dictado y no bastan.
 */
export function detectServicioMention(text, servicios = []) {
  const scored = scoreServicios(text, servicios);
  if (scored.length && scored[0].score >= 4) {
    return { mentioned: true, via: 'catalogo', best: { id: scored[0].servicio.id, nombre: scored[0].servicio.nombre } };
  }
  return { mentioned: false, via: null, best: null };
}

/* ------------------------------------------------------------------ */
/* Action items / resumen                                              */
/* ------------------------------------------------------------------ */

/** Extrae un pendiente textual: "hay que …", "queda pendiente …", "agéndale …". */
export function extractActionItem(text) {
  const m = String(text ?? '').match(
    /(?:hay que|queda pendiente|qued[aó] pendiente|ag[eé]ndale|agendale|ap[úu]ntate|anota que hay que|hay que dejar|despu[eé]s hay que|tocar[aá]|falta por|se tiene que|tenemos que|me toca)\s+(.+)$/is,
  );
  if (!m) return null;
  let item = m[1].replace(/\s*[.,;]*(?:eso es todo|es todo|ya est[áa]|listo|m[áa]nda\w*|env[ií]a\w*)[\s\S]*$/i, '');
  item = item.replace(/[.,;]\s*$/, '').trim();
  if (item.length < 4) return null;
  return item.charAt(0).toUpperCase() + item.slice(1);
}

/** Extrae el resumen dicho por el operador: "en resumen …", "resumiendo …". */
export function extractResumen(text) {
  const m = String(text ?? '').match(/(?:en resumen|resumiendo|para resumir|en una linea|en corto|pa'? resumir)\s*[:,]?\s+(.+)$/is);
  if (!m) return null;
  let r = m[1].replace(/\s*[.,;]*(?:eso es todo|es todo|ya est[áa]|listo|m[áa]nda\w*|env[ií]a\w*)[\s\S]*$/i, '');
  r = r.replace(/[.,;]\s*$/, '').trim();
  if (r.length < 8) return null;
  return r.charAt(0).toUpperCase() + r.slice(1);
}

/** Nombre de servicio listo para leerse en voz alta (tal cual del catálogo). */
export function speakServicioNombre(nombre) {
  return String(nombre ?? '').replace(/\s+/g, ' ').trim();
}
