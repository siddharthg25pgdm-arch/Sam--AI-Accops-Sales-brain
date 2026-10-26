// STUB from Stream B so the branch builds before Stream F/G merge. Fail safe (never admits the model).
// The owning stream's file replaces this one: take theirs on merge, or drop this commit when rebasing.
import type { CacheGet, CachePut } from "./contracts";
export const cacheGet: CacheGet = async () => null;
export const cachePut: CachePut = async () => {};
