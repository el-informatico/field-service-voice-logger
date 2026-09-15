// bargein.js — doc §8.5: barge_in events carry latency_ms (interrupt→agent silence).
// Respected if latency_ms ≤ 500. Stolen otherwise (agent kept talking / cut late).

export function bargein(events) {
  const evs = (events ?? []).filter((e) => e.type === 'barge_in' && typeof e.latency_ms === 'number');
  const respected = evs.filter((e) => e.latency_ms <= 500);
  return {
    n_provoked: evs.length,
    n_respected: respected.length,
    n_stolen: evs.length - respected.length,
    pct_respected: evs.length ? respected.length / evs.length : null,
  };
}
