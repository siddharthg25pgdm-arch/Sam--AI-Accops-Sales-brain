// One in-order upload queue per channel. Network errors, 5xx, 429 and 401 retry with backoff, so a dropped
// connection delays the transcript instead of losing it; 4xx that can never succeed are dropped.
const PERMANENT = new Set([400, 403, 404, 409, 410, 413, 415, 422]);
const MAX_QUEUE = 200; // ponytail: memory only (~100 MB worst case per channel); persist to disk if reps lose whole calls offline

export function createUploader({ send, onResult, onStatus = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const q = { rep: [], customer: [] }, busy = { rep: false, customer: false }, fails = { rep: 0, customer: 0 };
  let auth = false, dropped = 0;
  const pending = () => q.rep.length + q.customer.length;
  const report = () => onStatus({ pending: pending(), failing: fails.rep + fails.customer > 0, auth, dropped });

  async function pump(ch) {
    if (busy[ch]) return;
    busy[ch] = true;
    while (q[ch].length) {
      const item = q[ch][0];
      let r;
      try { r = await send(item); } catch { r = { ok: false, status: 0 }; }
      if (r.ok || PERMANENT.has(r.status)) {
        q[ch].shift(); fails[ch] = 0;
        if (r.ok) { auth = false; onResult(r.data, item); } else dropped++;
        report(); continue;
      }
      auth = r.status === 401;
      fails[ch]++; report();
      await sleep(Math.min(30000, 1000 * 2 ** (fails[ch] - 1)));
    }
    busy[ch] = false; report();
  }

  return {
    push(item) {
      const a = q[item.channel];
      a.push(item);
      if (a.length > MAX_QUEUE) { a.splice(1, 1); dropped++; } // index 0 may be in flight
      report(); pump(item.channel);
    },
    pending,
    /** Resolves with the number still pending once both queues are empty or timeoutMs passes. */
    async drain(timeoutMs) {
      const end = Date.now() + timeoutMs;
      while (pending() && Date.now() < end) await new Promise(r => setTimeout(r, 100));
      return pending();
    },
  };
}
