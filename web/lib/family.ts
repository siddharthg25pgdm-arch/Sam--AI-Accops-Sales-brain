/** Document families: every version, re-save and edition of one document, under one key.
 *
 *  The library holds the same document many times over: v1/v2/V5, "Big"/"Small"/"compressed",
 *  "Final"/"Draft"/"(1)", bulk-rename date prefixes ("2021-01-01-", "2026-06-11-"), a Confidential and
 *  a Sharable edition, an English and a Japanese one. A rep should see ONE of them - the newest, in the
 *  edition the ask needs - and never spend an answer slot on an older copy.
 *
 *  familyKey() is the filename with everything that marks a version, a date, a re-save or an edition
 *  taken out. What stays is what makes a document different: product, customer, city, audience, length
 *  ("15min" vs "45min"). "CIO Event Bangalore" and "CIO Event Chennai" stay two families; so do
 *  "HySecure datasheet" and "HyID datasheet".
 *
 *  THE SAME RULES LIVE IN SQL: sam_family_key() / sam_family_edition() / sam_family_version() in
 *  docs/supabase-sam-asset-families.sql, so every tool on Supabase gets the same families. Change one,
 *  change both, and re-run the case list in family.check.mjs against the SQL (the file says how). */

const MONTH = "jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december";
const DD = "(?:0[1-9]|[12][0-9]|3[01])", MM = "(?:0[1-9]|1[0-2])";
const DOC_EXT = /\.(pdf|pptx?|docx?|xlsx?|txt|csv|zip)$/;
const IMG_EXT = /\.(png|jpe?g|gif|svg|webp)$/;
const VID_EXT = /\.(mp4|mov|avi|wmv|webm)$/;

/** Rewrites applied in order to the lowercased name. Each is one regex, so the SQL mirror is one
 *  regexp_replace per line. ponytail: a fixed list tuned on the 876 real filenames (30 Sep 2026); a new
 *  naming habit that slips through is a split, never a merge, and the report shows it. */
const DATES: RegExp[] = [
  /v?\d{4}-\d{2}-\d{2}/g,                                              // 2021-01-01-, v2026-05-16-
  /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])\b/g,                              // 2022-08
  /\b\d{1,2}[-./]\d{1,2}[-./]\d{2,4}\b/g,                              // 16-06-2020, 23.07.25
  new RegExp(`^(?:${MM}\\d{2}|${MM}${DD}|\\d{2}${MM}${DD}|20\\d{2}${MM}${DD})(?=[^a-z0-9]|$)`, "g"), // leading 0424-, 1009_, 251029-, 20250426
  new RegExp(`(?<![0-9])(?:${DD}${MM}(?:20)?\\d{2}|(?:20)?\\d{2}${MM}${DD})(?![0-9])`, "g"),         // 05082022, 080726, 18082023
  new RegExp(`(?:(?<![0-9.])\\d{1,2}(?:st|nd|rd|th)?[\\s_-]*)?\\b(?:${MONTH})(?:[\\s_-]*'?\\d{2}(?:\\d{2})?)?(?![a-z])`, "g"), // 25 Aug 2026, Sep25, Nov_2019, 3rd June
  /\b\d{1,2}(?:st|nd|rd|th)\b/g,                                       // 21st
  /'\d{2}\b/g,                                                         // '26
  /\b(?:19|20)\d{2}\b/g,                                               // 2026
];
/** Re-save and variant words: not what the document is. "(1)" is a Windows duplicate; "(14)" is a
 *  numbered background image, so only one digit counts. */
const NOISE = /\b(?:final|draft|copy|compressed|big|small|updated|latest|new|old|outdated|submitted|file|version|with videos)\b|\(\d\)/g;
const VERSION = /\bv(?:er(?:sion)?)?\s*[-.]?\s*(\d+(?:\.\d+)*)(?![a-z0-9])|\b(\d+\.\d+)\b/;

export type Edition = "" | "sharable" | "japanese" | "japan" | "mea" | "japan sharable" | "japanese sharable" | "mea sharable";
export type ParsedName = {
  key: string;
  /** "" is the default edition (internal/confidential, English, global). Region and language are
   *  siblings, not versions: a MEA deck is not an old global deck. */
  edition: string;
  /** Parsed version numbers, [] when none: v2 -> [2], "V1.0" -> [1, 0], "Version 3.1" -> [3, 1]. */
  version: number[];
  /** Filed as outdated by a human ("z__Outdated__", "Outdated-..."): ranks below every other member. */
  outdated: boolean;
};

export function parseName(filename: string): ParsedName {
  let s = filename.toLowerCase().trim();
  // A logo as PNG and as JPG are two files a designer picks between, not two versions.
  const media = s.match(IMG_EXT)?.[0] ?? (VID_EXT.test(s) ? ".video" : "");
  for (let i = 0; i < 2; i++) s = s.replace(DOC_EXT, "").replace(IMG_EXT, "").replace(VID_EXT, "");
  s = s.replace(/(?<=\d)(pptx|pdf|docx)$/, "");                        // "Version 3.1pptx"
  const outdated = /outdated/.test(s);
  s = s.replace(/[_+&,!@#()[\]{}]/g, m => (m === "(" || m === ")" ? m : " ")).replace(/\s+/g, " ");
  for (const re of DATES) s = s.replace(re, " ");
  const vm = s.match(VERSION);
  const version = vm ? (vm[1] ?? vm[2]).split(".").map(Number) : [];
  s = s.replace(new RegExp(VERSION.source, "g"), " ");
  const tags = new Set<string>();
  s = s.replace(/\b(?:public|sharable|shareable)\b/g, () => (tags.add("sharable"), " "))
    .replace(/\b(?:japanese|jp)\b/g, () => (tags.add("japanese"), " "))
    .replace(/\b(?:for)?japan\b/g, () => (tags.add("japan"), " "))
    .replace(/\bmea\b/g, () => (tags.add("mea"), " "))
    .replace(/\b(?:confidential|internal|eng|english)\b/g, " ");
  if (tags.has("japanese")) tags.delete("japan");
  s = s.replace(NOISE, " ").replace(/\baccops\b/g, " ").replace(/\bz\b/g, " ");
  const key = s.replace(/[^a-z0-9]/g, "") || filename.toLowerCase().replace(/[^a-z0-9]/g, "");
  return { key: key + media, edition: [...tags].sort().join(" "), version, outdated };
}

export const familyKey = (filename: string) => parseName(filename).key;

/** What family ranking needs to know about one document. */
export type Member = {
  /** The filename (or title, for a document with no file). */
  name: string;
  /** Publication year read from the document body (a card), else null. Never a filename guess. */
  publishYear: number | null;
  modified: string | null;
  carded: boolean;
  eligible: boolean;
  /** The filename a hand-set superseded_by points at, without extension, else null. */
  supersededBy: string | null;
};
export type FamilyInfo = {
  key: string; edition: string; version: number[];
  /** Members in the family, this one included. */
  size: number;
  /** 1 = newest in its edition. */
  rank: number;
  /** Newest in its edition: the only members an answer may show. */
  head: boolean;
  /** The one that leads the family by default (the default edition's head, eligible first). */
  canonical: boolean;
  /** Members that are older versions (not the head of any edition). */
  older: number;
  /** Replaced by a newer member through a hand-set superseded_by. */
  superseded: boolean;
};

const stemOf = (s: string) => s.toLowerCase().replace(/\.(pdf|pptx?|docx?|xlsx?)$/, "").replace(/[^a-z0-9]/g, "");

/** True when `a` is newer than `b`: a hand-set superseded_by and "outdated" sink; then eligible; then
 *  publication year when both documents state one; then version when both files carry one; then
 *  SharePoint's modified date; then a carded one; then the name (code-point order, as SQL's "C").
 *  Pairwise and deliberately partial, so members are ranked by how many others are newer - a
 *  definition SQL computes identically (sam_asset_families). */
type Ranked = Member & { superseded: boolean; outdated: boolean; version: number[] };
export function isNewer(a: Ranked, b: Ranked): boolean {
  if (a.superseded !== b.superseded) return b.superseded;
  if (a.outdated !== b.outdated) return b.outdated;
  if (a.eligible !== b.eligible) return a.eligible;
  if (a.publishYear != null && b.publishYear != null && a.publishYear !== b.publishYear) return a.publishYear > b.publishYear;
  // Only when both files carry one: "Nutanix-DotNext-Event.pptx" (the 63-slide working deck, saved
  // June 2024) is not older than "..._SUBMITTED FILE-v2" (May 2024) for lacking a "v".
  const v = a.version.length && b.version.length ? compareVersion(a.version, b.version) : 0;
  if (v) return v > 0;
  const am = a.modified ? Date.parse(a.modified) : -Infinity, bm = b.modified ? Date.parse(b.modified) : -Infinity;
  if (am !== bm) return am > bm;
  if (a.carded !== b.carded) return a.carded;
  return a.name < b.name;
}
/** `xs` newest first: fewest members of `among` newer than it, then name. */
function byNewest<X extends Ranked>(xs: X[], among: X[] = xs): X[] {
  const beaten = new Map(xs.map(x => [x, among.filter(o => o !== x && isNewer(o, x)).length]));
  return [...xs].sort((a, b) => beaten.get(a)! - beaten.get(b)! || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Families over `items`, one FamilyInfo per item.
 *
 *  A hand-set superseded_by always wins: the superseded document joins its successor's family (they
 *  may be named nothing alike - "ZTNA for Government" -> "Solutions for Govt") and ranks below it -
 *  but only when the successor is actually here; otherwise nothing is hidden and the trust note says
 *  a newer edition exists. Up to three hops (A -> B -> C puts A and B in C's family), as successorOf()
 *  in cards.ts. `overrides` (filename stem -> family key) is the human escape hatch for a false merge
 *  or split (sam_asset_family_overrides). */
export function families<T>(items: T[], view: (t: T) => Member, overrides: Map<string, string> = new Map()): Map<T, FamilyInfo> {
  const ms = items.map(t => {
    const m = view(t), p = parseName(m.name), stem = stemOf(m.name);
    return { t, ...m, ...p, stem, own: overrides.get(stem) ?? p.key, key: "", superseded: false };
  });
  const byStem = new Map(ms.map(m => [m.stem, m]));
  for (const m of ms) {
    let end = m;
    for (let hop = 0; hop < 3 && end.supersededBy; hop++) {
      const next = byStem.get(stemOf(end.supersededBy));
      if (!next || next === m || next === end) break;
      end = next;
    }
    m.superseded = end !== m;
    m.key = end.own;
  }
  const groups = new Map<string, typeof ms>();
  for (const m of ms) groups.set(m.key, [...(groups.get(m.key) ?? []), m]);
  const out = new Map<T, FamilyInfo>();
  for (const [key, g] of groups) {
    const heads: typeof ms = [];
    const rank = new Map<(typeof ms)[number], number>();
    for (const ed of new Set(g.map(m => m.edition))) {
      const e = byNewest(g.filter(m => m.edition === ed));
      e.forEach((m, i) => rank.set(m, i + 1));
      if (!e[0].superseded) heads.push(e[0]);
    }
    // Every edition's head superseded (a chain whose end sits in this family under another edition):
    // keep the best one so a family never vanishes.
    if (!heads.length) heads.push(byNewest(g)[0]);
    // The lead: eligible first, then the default edition, then sharable, then the newest.
    const order = byNewest(heads, g), pref = (m: (typeof ms)[number]) => (m.eligible ? 0 : 4) + (m.edition === "" ? 0 : m.edition === "sharable" ? 1 : 2);
    const lead = [...order].sort((a, b) => pref(a) - pref(b) || order.indexOf(a) - order.indexOf(b))[0];
    for (const m of g) out.set(m.t, {
      key, edition: m.edition, version: m.version, size: g.length, rank: rank.get(m)!, head: heads.includes(m),
      canonical: m === lead, older: g.length - heads.length, superseded: m.superseded,
    });
  }
  return out;
}

/** Edition tags an ask calls for. Sending prefers the sharable edition; a Japan ask the Japanese one;
 *  a Middle East ask the MEA one. Everything else takes the family's canonical. */
export function editionScore(edition: string, want: { sending: boolean; japan: boolean; mea: boolean }): number {
  const tags = new Set(edition.split(" ").filter(Boolean));
  let s = 0;
  if (want.japan) s += tags.has("japanese") ? 2 : tags.has("japan") ? 1.5 : 0;
  else if (tags.has("japanese") || tags.has("japan")) s -= 1;
  if (want.mea) s += tags.has("mea") ? 2 : 0;
  else if (tags.has("mea")) s -= 1;
  if (want.sending && tags.has("sharable")) s += 1;
  return s;
}

/** -1 / 0 / 1, numerically and as Postgres compares int[]: [3] > [2, 5], [1, 10] > [1, 9], [2, 0] > [2]. */
export function compareVersion(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1, y = b[i] ?? -1;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
