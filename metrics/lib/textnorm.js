// textnorm.js — text normalization + Jaccard similarity over token sets.
// Pure functions, zero deps. Used by accuracy.js and (optionally) wer.js.

// Spanish + English stopwords. Doc §8: "minúsculas, sin acentos, sin stopwords".
const STOPWORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'e',
  'que', 'en', 'del', 'al', 'a', 'con', 'por', 'para', 'se', 'lo', 'su', 'sus',
  'es', 'fue', 'era', 'con', 'sin', 'sobre', 'entre', 'como', 'mas', 'pero',
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'and', 'or', 'is', 'was', 'it',
]);

/** lowercase, strip diacritics (NFD), strip punctuation, collapse whitespace. */
export function normalize(text) {
  if (text == null) return '';
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining marks → strip diacritics
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // punctuation → space (keeps letters/digits)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Set of normalized tokens (stopwords REMOVED — doc says "sin stopwords"). */
export function tokenSet(text, { stopwords = true } = {}) {
  const toks = normalize(text).split(' ').filter(Boolean);
  return new Set(stopwords ? toks.filter((t) => !STOPWORDS.has(t)) : toks);
}

/** Jaccard similarity over token sets: |A∩B| / |A∪B| ∈ [0,1]. Empty∪empty → 1. */
export function similarity(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
