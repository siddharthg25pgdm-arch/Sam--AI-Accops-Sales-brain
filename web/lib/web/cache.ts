/** Plan 2.4 tier 2: the shared answer cache, key = q_hash (already includes the page group) + the answer engine's
 *  version, so a change in how tier 3 answers never serves the old engine's cached answers (27 Oct: the old engine's
 *  page-card answers). A's RPCs enforce the 24 h expiry, knowledge_version and the public-asset freshness; only
 *  model/fallback outcomes are stored. */
import { createHash } from "node:crypto";
import { Answer } from "@/lib/blocks";
import { redact } from "@/lib/redact";
import type { CacheGet, CachePut } from "./contracts";
import { rpc } from "./db";

export const ENGINE = "text-first-4"; // bump when tier 3 changes what it answers (3: 27 Oct, verified facts never pad; 4: 28 Oct, not too technical)
export const cacheKey = (q_hash: string) => createHash("sha256").update(`${q_hash}|${ENGINE}`).digest("hex");

export const cacheGet: CacheGet = async q_hash => {
  try {
    const a = Answer.safeParse(await rpc<unknown>("sam_web_cache_get", { q_hash: cacheKey(q_hash) }));
    return a.success ? a.data : null; // null, or a row that no longer parses = a miss
  } catch (e) {
    console.warn(`web cache get: ${redact(e)}`);
    return null;
  }
};

export const cachePut: CachePut = async (q_hash, page_group, answer, source) => {
  await rpc<null>("sam_web_cache_put", { q_hash: cacheKey(q_hash), page_group, answer, source });
};
