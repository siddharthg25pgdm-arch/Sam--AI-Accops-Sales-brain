// Plan 2.4. prototype/build_intent_index.py must apply the same rules (golden file, plan 3.2).
import { createHash } from "node:crypto";

export function normalise(q: string): string {
  const s = q.normalize("NFKC").toLowerCase()
    .replace(/\s+/gu, " ")                       // whitespace controls (\t \n \r) become spaces first
    .replace(/[\p{Cc}\p{Cf}]/gu, "")             // then other control + zero-width/format characters vanish
    // ponytail: smart quotes are punctuation, so they need no separate map: everything but letters, marks, digits -> space
    .replace(/[^\p{L}\p{M}\p{N} ]/gu, " ")
    .replace(/ +/g, " ").trim();
  return Array.from(s).slice(0, 500).join("").trim(); // code points, not UTF-16 units, to match Python slicing
}

export const qHash = (q: string, page_group: string) =>
  createHash("sha256").update(`${normalise(q)}|${page_group}`).digest("hex");
