/** Echo de-duplication. When the rep uses speakers instead of a headset, the laptop mic (the "rep" channel)
 *  also hears the customer, so the customer's words arrive twice: once on the customer channel, once,
 *  usually clipped, on the rep's. A rep utterance that closely matches a customer one near it in time is
 *  that echo, and the customer's copy is the one kept.
 *  ponytail: word overlap, not audio; a rep who repeats the customer's sentence back word for word within
 *  4 s is dropped too. Acoustic echo cancellation in the desktop app is the upgrade if that bites. */
export const ECHO_WINDOW_MS = 4000;
const MIN_TOKENS = 3;
const JACCARD = 0.6;

export type Timed = { t_ms: number; duration_ms?: number | null; text: string };

export const tokens = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** The rep's text is the customer's heard again: either is too short to judge (< 3 tokens) -> false;
 *  the rep's tokens appear as one run inside the customer's -> true; else token Jaccard >= 0.6. */
export function sameWords(rep: string, customer: string): boolean {
  const r = tokens(rep), c = tokens(customer);
  if (r.length < MIN_TOKENS || c.length < MIN_TOKENS) return false;
  if (` ${c.join(" ")} `.includes(` ${r.join(" ")} `)) return true;
  const a = new Set(r), b = new Set(c);
  let both = 0;
  for (const t of a) if (b.has(t)) both++;
  return both / (a.size + b.size - both) >= JACCARD;
}

/** Gap between two utterances in ms, 0 when they overlap (duration unknown = an instant). */
export function gapMs(x: Timed, y: Timed): number {
  const xEnd = x.t_ms + (x.duration_ms ?? 0), yEnd = y.t_ms + (y.duration_ms ?? 0);
  return Math.max(0, x.t_ms - yEnd, y.t_ms - xEnd);
}

/** A rep utterance and a customer one that are the same speech: within ±4 s of each other and sameWords. */
export function isEcho(rep: Timed, customer: Timed): boolean {
  return gapMs(rep, customer) <= ECHO_WINDOW_MS && sameWords(rep.text, customer.text);
}
