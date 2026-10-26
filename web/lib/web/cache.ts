/** Plan 2.4 tier 2: the shared answer cache, key = q_hash (already includes the page group). A's RPCs enforce the
 *  24 h expiry, knowledge_version and the public-asset freshness; only model/fallback outcomes are stored. */
import { Answer } from "@/lib/blocks";
import { redact } from "@/lib/redact";
import type { CacheGet, CachePut } from "./contracts";
import { rpc } from "./db";

export const cacheGet: CacheGet = async q_hash => {
  try {
    const a = Answer.safeParse(await rpc<unknown>("sam_web_cache_get", { q_hash }));
    return a.success ? a.data : null; // null, or a row that no longer parses = a miss
  } catch (e) {
    console.warn(`web cache get: ${redact(e)}`);
    return null;
  }
};

export const cachePut: CachePut = async (q_hash, page_group, answer, source) => {
  await rpc<null>("sam_web_cache_put", { q_hash, page_group, answer, source });
};
