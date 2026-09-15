// wer.js — word error rate via Levenshtein alignment on word lists.
// wer(ref[], hyp[]) → { wer, sub, ins, del, hits, n_ref }
// corpusWer(pairs) → micro-averaged { wer, sub, ins, del, hits, n_ref, n_pairs }

function align(ref, hyp) {
  const R = ref.length, H = hyp.length;
  // dp[i][j] = min cost aligning ref[:i] with hyp[:j]
  const dp = Array.from({ length: R + 1 }, () => new Uint32Array(H + 1));
  for (let i = 1; i <= R; i++) dp[i][0] = i;
  for (let j = 1; j <= H; j++) dp[0][j] = j;
  for (let i = 1; i <= R; i++) {
    for (let j = 1; j <= H; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j - 1] + cost, // match / substitution
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
      );
    }
  }
  // backtrack for counts
  let i = R, j = H, sub = 0, ins = 0, del = 0, hits = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      if (dp[i][j] === dp[i - 1][j - 1] + cost) {
        if (cost === 0) hits++; else sub++;
        i--; j--;
        continue;
      }
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { del++; i--; continue; }
    ins++; j--;
  }
  return { sub, ins, del, hits };
}

/** WER for one reference/hypothesis word-list pair. */
export function wer(ref, hyp) {
  const { sub, ins, del, hits } = align(ref, hyp);
  const n_ref = ref.length;
  return { wer: n_ref === 0 ? (hyp.length === 0 ? 0 : 1) : (sub + ins + del) / n_ref, sub, ins, del, hits, n_ref };
}

/** Micro-average over [{ref:[], hyp:[]}, ...]. */
export function corpusWer(pairs) {
  let sub = 0, ins = 0, del = 0, hits = 0, n_ref = 0, n_pairs = 0;
  for (const p of pairs) {
    const r = wer(p.ref, p.hyp);
    sub += r.sub; ins += r.ins; del += r.del; hits += r.hits; n_ref += r.n_ref;
    n_pairs++;
  }
  return { wer: n_ref === 0 ? 0 : (sub + ins + del) / n_ref, sub, ins, del, hits, n_ref, n_pairs };
}
