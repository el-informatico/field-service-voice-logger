/**
 * dialog-act.js — utilidades de texto ES (actos de diálogo del técnico).
 * ESM, sin dependencias, DOM-free (browser + Node 22).
 *
 * Lo usan tool-runner (normalización/búsqueda), mock-agent (detección de
 * confirmaciones, cantidades, tiempos, envío) y ws-agent (clasificación de
 * confirmaciones del canal real). Todo determinista y puro.
 */

/* ------------------------------------------------------------------ */
/* Normalización                                                       */
/* ------------------------------------------------------------------ */

export function stripAccents(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Frases habladas → forma canónica de catálogo. Se aplican ANTES de la
 * conversión número-palabra→dígito (por eso 'tres cuartos'→'3/4' gana a
 * 'tres'→'3'). Claves ya sin acentos.
 *
 * 'tres punto ocho' → '3/8' es deliberado: así es como el ASR (error sembrado
 * del guion s2) mal-oye "tres octavos" — decimal en vez de fracción.
 */
const PHRASE_MAP = [
  ['tres punto ocho', '3/8'],
  ['tres cuartos de pulgada', '3/4'],
  ['tres octavos de pulgada', '3/8'],
  ['cinco octavos de pulgada', '5/8'],
  ['un cuarto de pulgada', '1/4'],
  ['media pulgada', '1/2'],
  ['medio pulgada', '1/2'],
  ['tres cuartos', '3/4'],
  ['tres octavos', '3/8'],
  ['cinco octavos', '5/8'],
  ['cuarenta y cinco mas cinco', '45+5'],
  ['treinta y cinco mas cinco', '35+5'],
  ['veinticuatro volts', '24v'],
  ['veinticuatro voltios', '24v'],
  ['veinticuatro vac', '24v'],
  ['una hora', '60 minutos'],
];

/* Números en palabra → dígitos (0–999, suficiente para dimensiones/qty/tiempos). */
const NUM_UNITS = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22,
  veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const NUM_TENS = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70,
  ochenta: 80, noventa: 90,
};
const NUM_HUNDREDS = {
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400,
  quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800,
novecientos: 900 };

function isNumWord(w) {
  return w in NUM_UNITS || w in NUM_TENS || w in NUM_HUNDREDS || w === 'y';
}

/** Convierte una secuencia de palabras-número en su valor, o null. */
function wordsToNumber(words) {
  let total = 0; let current = 0; let saw = false; let expectUnitAfterY = false;
  for (const w of words) {
    if (w === 'y') {
      if (!saw) return null;
      expectUnitAfterY = true;
      continue;
    }
    if (w in NUM_HUNDREDS) {
      if (saw) return null;
      total += NUM_HUNDREDS[w]; saw = true; expectUnitAfterY = false;
    } else if (w in NUM_TENS) {
      if (current) return null;
      current += NUM_TENS[w]; saw = true; expectUnitAfterY = false;
    } else if (w in NUM_UNITS) {
      if (expectUnitAfterY) { current += NUM_UNITS[w]; expectUnitAfterY = false; }
      else {
        if (current || saw) return null;
        current = NUM_UNITS[w]; saw = true;
      }
    } else return null;
  }
  if (expectUnitAfterY) return null;
  return total + current;
}

/**
 * Normaliza texto hablado a tokens comparables contra catálogo/alias:
 * minúsculas, sin acentos, frases→dimensiones, números→dígitos, ' X mas Y '→X+Y,
 * puntuación→espacios (se conservan / + . dentro de tokens tipo 3/4, 45+5, 12.5).
 */
export function normalizeText(s) {
  let t = stripAccents(s).toLowerCase();
  for (const [from, to] of PHRASE_MAP) {
    t = t.split(from).join(` ${to} `);
  }
  // palabras-número contiguas → dígitos
  const rough = t.split(/[^a-z0-9+/.,]+/).filter(Boolean);
  const out = [];
  let i = 0;
  while (i < rough.length) {
    const w = rough[i];
    if (isNumWord(w)) {
      let j = i; const span = [];
      while (j < rough.length && isNumWord(rough[j])) { span.push(rough[j]); j++; }
      // "treinta y cinco" válida; "cinco y cinco" (mas) la maneja el span→null y cae palabra por palabra
      const n = wordsToNumber(span);
      if (n !== null) { out.push(String(n)); i = j; continue; }
    }
    out.push(w); i++;
  }
  // ' mas ' entre números → '+'  ("45 mas 5" → "45+5")
  let joined = out.join(' ');
  joined = joined.replace(/(\d+)\s+mas\s+(\d+)/g, '$1+$2');
  // puntuación sobrante → espacio (conserva / + . DENTRO de tokens: 3/4, 45+5, 12.5)
  joined = joined
    .replace(/[;,;:!?¡¿()"'“”‘’—–\n\r]+/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/(?<!\d)\./g, ' ');
  return joined.replace(/\s+/g, ' ').trim();
}

const STOPWORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'al', 'del', 'en', 'y', 'o', 'u', 'a',
  'que', 'por', 'para', 'con', 'como', 'es', 'son', 'se', 'su', 'sus', 'ya',
  'va', 'pos', 'pues', 'este', 'esta', 'esto', 'eso', 'esa', 'aqui', 'hay',
  'muy', 'pero', 'bien', 'bueno', 'buenos', 'buenas', 'nada', 'menos', 'mas',
  'me', 'te', 'le', 'les', 'lo', 'mi', 'tu', 'fondo', 'mientras', 'tambien',
  'entonces', 'verdad', 'dime', 'oye', 'mira', 'ok',
]);

/** Tokens normalizados (de-pluralizados, sin stopwords) como Set. */
export function tokenSet(text) {
  const toks = normalizeText(text).split(' ').filter(Boolean);
  const out = new Set();
  for (const t of toks) {
    if (!t || STOPWORDS.has(t)) continue;
    let tok = t;
    if (!/^[0-9]/.test(tok) && tok.length >= 4 && tok.endsWith('s')) tok = tok.slice(0, -1);
    out.add(tok);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Detección de actos de diálogo                                       */
/* ------------------------------------------------------------------ */

/** ¿El usuario confirma? → 'yes' | 'no' | null (ambiguo). */
export function detectConfirmation(text) {
  const t = normalizeText(text);
  const yes = /\b(si|correcto|cierto|afirmativo|asi es|eso es|ese mismo|esa misma|esa es|confirmalo|confirmo)\b/.test(t);
  const no = /\b(no|negativo|espera|alto|cambio|equivocad\w*|incorrecto)\b/.test(t);
  if (yes && !no) return 'yes';
  if (no) return 'no'; // 'no' gana: "no, es correcto" es corrección, no confirmación
  return null;
}

/** Orden de envío del reporte ("mánda", "mándalo", "envíalo", "listo, …"). */
export function detectSend(text) {
  const t = normalizeText(text);
  return /\b(manda\w*|envia\w*|listo)\b/.test(t);
}

/** Extrae nota final textual: "ponle que …", "apúntame que …", "anota que …". */
export function extractNotas(text) {
  const m = String(text ?? '').match(/(?:ponle|ap[úu]ntame|apuntale|ap[úu]ntale|anota|an[óo]tame)\s+que\s+(.+)$/is);
  if (!m) return null;
  let nota = m[1].replace(
    /\s*[.,;]*(?:eso es todo|es todo|ya est[áa]\b|listo\b|m[áa]nda\w*)[\s\S]*$/i,
    '',
  );
  nota = nota.replace(/\s*\.{2,}\s*$/, '').replace(/[.,;]\s*$/, '').trim();
  if (nota.length < 3) return null;
  return nota;
}

/** Primera palabra-clave de pieza mencionada en el texto (o null). */
const PART_KEYWORDS = [
  'valvula', 'capacitor', 'capsula', 'contactor', 'relevador', 'breaker',
  'pastilla', 'termomagnetico', 'manguera', 'huacha', 'fusible', 'balero',
  'rodamiento', 'chumacera', 'banda', 'correa', 'termostato', 'presostato',
  'empaque', 'hule', 'cable', 'alambre', 'bornera', 'borna', 'riel',
  'klixon', 'protector termico',
];
export function detectPartMention(text) {
  const t = normalizeText(text);
  let best = null; let bestIdx = Infinity;
  for (const kw of PART_KEYWORDS) {
    const idx = t.indexOf(kw);
    if (idx !== -1 && idx < bestIdx) { best = kw; bestIdx = idx; }
  }
  return best;
}

/**
 * Cantidad mencionada. Explícita = "N piezas/valvulas/metros…" o "Nada más".
 * Fallback determinista: último número suelto 1..10 que no sea dimensión.
 */
const QTY_NOUN = '(?:pieza|pza|valvula|capacitor|capsula|contactor|relevador|breaker|pastilla|termomagnetico|manguera|huacha|fusible|balero|rodamiento|chumacera|banda|correa|termostato|presostato|empaque|hule|cable|alambre|bornera|riel|klixon|jgo|juego|metro)s?';
export function parseQty(text) {
  const t = normalizeText(text);
  let m = t.match(new RegExp(`(\\d+)\\s+${QTY_NOUN}\\b`));
  if (m) return { qty: clampQty(+m[1]), explicit: true };
  m = t.match(/(\d+)\s+nada mas\b/);
  if (m) return { qty: clampQty(+m[1]), explicit: true };
  const plain = t.split(' ').filter(Boolean);
  for (let i = plain.length - 1; i >= 0; i--) {
    const tok = plain[i];
    if (/^\d{1,2}$/.test(tok)) {
      const n = +tok;
      if (n >= 1 && n <= 10) return { qty: n, explicit: false };
    }
  }
  return { qty: 1, explicit: false };
}
function clampQty(n) { return Math.max(1, Math.min(99, Math.round(n))); }

/** Minutos de trabajo declarados ("45 minutos", "una hora"). null si no hay. */
export function parseMinutes(text) {
  const t = normalizeText(text);
  let m = t.match(/(\d+)\s*minuto/);
  if (m) return clampMinutes(+m[1]);
  m = t.match(/(\d+)\s*(?:hr|hora)\b/);
  if (m) return clampMinutes(+m[1] * 60);
  return null;
}
function clampMinutes(n) { return Math.max(1, Math.min(600, Math.round(n))); }

/* ------------------------------------------------------------------ */
/* Habla del agente (read-back)                                        */
/* ------------------------------------------------------------------ */

export const DIMENSION_SPEECH = {
  '3/4': 'TRES CUARTOS', '3/8': 'TRES OCTAVOS', '1/2': 'MEDIA PULGADA',
  '5/8': 'CINCO OCTAVOS', '1/4': 'UN CUARTO',
  '45+5': 'CUARENTA Y CINCO MÁS CINCO', '35+5': 'TREINTA Y CINCO MÁS CINCO',
  '12.5': 'DOCE Y MEDIO',
  '30': 'TREINTA', '40': 'CUARENTA', '20': 'VEINTE', '15': 'QUINCE',
  '12': 'DOCE', '14': 'CATORCE', '24': 'VEINTICUATRO', '25': 'VEINTICINCO',
  '35': 'TREINTA Y CINCO', '45': 'CUARENTA Y CINCO', '50': 'CINCUENTA',
  '60': 'SESENTA',
};

/**
 * Nombre de pieza listo para leerse en voz alta, con la dimensión deletreada
 * en español y en mayúsculas (el detalle crítico del read-back):
 * 'Válvula de bola latón 3/4"' → 'Válvula de bola latón TRES CUARTOS'.
 */
export function speakNombre(nombre) {
  return String(nombre ?? '')
    .replace(/(\d+\+\d+|\d+\/\d+|\d+\.\d+|\b\d+\b)/g, (m) => DIMENSION_SPEECH[m] ?? m)
    .replace(/\s*"\s*$/, '')
    .trim();
}

const NUM_WORD_SPEECH = [
  'cero', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho',
  'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis',
  'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
];
/** "2 pza" → 'dos piezas'. */
export function speakQty(qty, unidad = 'pza') {
  const noun = unidad === 'jgo' ? 'juego' : unidad === 'm' ? 'metro' : 'pieza';
  const n = qty >= 1 && qty <= 20 ? NUM_WORD_SPEECH[qty] : String(qty);
  return `${n} ${noun}${qty > 1 ? 's' : ''}`;
}

/**
 * Tokens que distinguen a `pieza` de su confundible `sibling` (p.ej. '3/4' vs
 * '3/8'). El mock los usa para saber si el técnico ya fue explícito.
 */
export function distinguisherTokens(pieza, sibling) {
  const a = tokenSet([...(pieza.alias ?? []), pieza.nombre, pieza.sku].join(' '));
  const b = tokenSet([...(sibling?.alias ?? []), sibling?.nombre ?? '', sibling?.sku ?? ''].join(' '));
  const out = new Set([...a].filter((t) => !b.has(t)));
  return out;
}

/** ¿El texto menciona explícitamente algún token del set? */
export function mentionsAny(text, tokenSet_) {
  const t = tokenSet(text);
  for (const tok of tokenSet_) if (t.has(tok)) return tok;
  return null;
}
