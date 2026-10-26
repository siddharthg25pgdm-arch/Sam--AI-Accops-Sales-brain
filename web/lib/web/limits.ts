/** Plan 2.2 + 2.4: rate limits and repeats, counted in Postgres by sam_web_admit (A's 03 migration):
 *  typed 6 / min and 20 / IST day per visitor, 60 / IST day per IP hash, clicks 300 / day; the repeat_n-th same
 *  q_hash within repeat_window_min -> 'repeat'. The IP hash comes from answer.ts (ctx.ip_hash); never recomputed here. */
import { redact } from "@/lib/redact";
import type { Admit } from "./contracts";
import { rpc } from "./db";

export const admit: Admit = async (ctx, kind, q_hash) => {
  try {
    const r = await rpc<string | null>("sam_web_admit", { visitor: ctx.visitor_id, ip_hash: ctx.ip_hash, kind, q_hash });
    return r === "rate" || r === "repeat" ? r : null;
  } catch (e) {
    console.warn(`web admit: ${redact(e)}`);
    return "rate"; // fail closed: no counter, no answer beyond the fixed limited reply
  }
};
