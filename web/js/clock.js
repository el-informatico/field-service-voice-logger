/**
 * clock.js — relojes inyectables para el engine de sesión.
 * ESM, sin dependencias, DOM-free (corre en browser y Node 22).
 *
 * El artefacto de sesión (architecture.md §6) usa `t_ms` = ms monótonos desde
 * `session_start`. El engine nunca llama a Date.now()/performance.now()
 * directamente: recibe uno de estos dos relojes.
 *
 * - realClock(): performance.now()-based. Para sesiones reales (browser).
 * - simClock(): reloj simulado que el mock-agent adelanta según su schedule
 *   determinista → los t_ms del artefacto son idénticos entre corridas,
 *   independiente de la velocidad de ejecución (instant vs realtime).
 */

/** Reloj real: ms desde la creación del reloj, monótono. */
export function realClock() {
  const t0 = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
  return {
    kind: 'real',
    now() { return ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0; },
  };
}

/**
 * Reloj simulado. `set` lo adelanta (nunca hacia atrás), `advance` lo incrementa.
 * El mock-agent lo usa como fuente de verdad del tiempo de sesión.
 */
export function simClock(startMs = 0) {
  let t = startMs;
  return {
    kind: 'sim',
    now() { return t; },
    /** Adelanta al tiempo absoluto `ms` (ignora valores hacia atrás). */
    set(ms) { if (ms > t) t = ms; return t; },
    advance(ms) { t += ms; return t; },
  };
}
