// latency.js — turn-latency metrics from artifact.events[].
// Doc §6/§8: user_turn_end → next tool_call (same turn) = lat_tool_ms;
//            user_turn_end → next agent_turn_start = lat_agent_ms.
// Percentiles p50/p95 with linear interpolation. Skips unpaired turns and counts them.

export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function summarize(values) {
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    min: s.length ? s[0] : null,
    max: s.length ? s[s.length - 1] : null,
  };
}

/**
 * @param {Array} events artifact.events[]
 * @returns {{tool:{samples,summary}, agent:{samples,summary}, skipped_tool, skipped_agent}}
 *  samples: [{ t_ms, lat_ms }]
 * Duplicate tool_calls in one turn → first wins.
 */
export function latency(events) {
  const toolSamples = [], agentSamples = [];
  let skippedTool = 0, skippedAgent = 0;
  const evs = [...(events ?? [])].sort((a, b) => (a.t_ms ?? 0) - (b.t_ms ?? 0));
  for (let i = 0; i < evs.length; i++) {
    if (evs[i].type !== 'user_turn_end') continue;
    let tool = null, agent = null;
    for (let j = i + 1; j < evs.length; j++) {
      if (evs[j].type === 'user_turn_start') break; // next user turn closes the window
      if (evs[j].type === 'tool_call' && tool === null) tool = evs[j]; // first only
      if (evs[j].type === 'agent_turn_start' && agent === null) agent = evs[j];
    }
    if (tool) toolSamples.push({ t_ms: evs[i].t_ms, lat_ms: tool.t_ms - evs[i].t_ms });
    else skippedTool++;
    if (agent) agentSamples.push({ t_ms: evs[i].t_ms, lat_ms: agent.t_ms - evs[i].t_ms });
    else skippedAgent++;
  }
  return {
    tool: { samples: toolSamples, summary: summarize(toolSamples.map((s) => s.lat_ms)) },
    agent: { samples: agentSamples, summary: summarize(agentSamples.map((s) => s.lat_ms)) },
    skipped_tool: skippedTool,
    skipped_agent: skippedAgent,
  };
}
