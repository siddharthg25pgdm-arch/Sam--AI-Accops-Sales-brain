/** Filling (plan 3.5): every visitor-visible field comes from an approved record or a fixed string here.
 *  The model's picks only choose WHICH record and WHICH block type; unknown refs and wrong types are dropped. */
import type { Block, Chip } from "@/lib/blocks";
import type { Candidate } from "./contracts";
import type { Qa, QaRef, Settings } from "./db";

/** The only prose not taken from a record (plan 3.4). Siddharth may edit these strings. */
export const LEAD = {
  partial: "Not exactly that, but this is the closest we've published:",
  none: "I don't have that on our public pages yet. The team can answer it directly.",
  limited: "You've asked a lot in a short time. Pick a question below or talk to the team.",
  repeat: "Looks like this one needs a person. The team can answer it directly.",
} as const;

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** "accops.com/hysecure" + the URL, or nothing for a value that is not an http(s) URL. */
export function source(url: string | null | undefined) {
  try {
    const u = new URL(String(url));
    if (!/^https?:$/.test(u.protocol)) return undefined;
    return { label: cut(`${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`, 60), url: u.href };
  } catch { return undefined; }
}

/** Only an http(s) URL is kept; anything else (javascript:, junk) becomes "" and falls to group `general`, never reflected. */
export const cleanPage = (p: unknown) => {
  const s = String(p ?? "").slice(0, 500);
  return /^https?:\/\//i.test(s) && URL.canParse(s) && !/\s/.test(s) ? s : "";
};

/** A candidate's qa ref -> the pair id (refs may be namespaced "qa:<id>"). */
export const qaId = (ref: string) => ref.replace(/^qa:/, "");

/** A pair's blocks: its verbatim answer as Text, and/or its approved visual. `only` limits to one block type. */
export function qaBlocks(qa: Qa, only?: string): Block[] {
  const src = source(qa.sources?.[0]), out: Block[] = [];
  if (!only || only === "text") out.push({ type: "text", body: qa.answer, ...(src ? { source: src } : {}) });
  const v = qa.visual, d = qa.visual_data;
  // ponytail: the calculator stays off until Siddharth approves public, sourced figures (plan 7.5)
  if (v && v !== "text" && d && (!only || only === v) && (v !== "calculator" || d.figures_approved === true)) {
    const { figures_approved: _f, ...props } = d;
    out.push({ ...props, type: v, ...(src && v !== "picker" && v !== "cta" ? { source: src } : {}) } as Block);
  }
  return out;
}

export const cta = (s: Settings, qa?: Qa | null): Block => ({ type: "cta", label: cut(qa?.cta || s.cta_label || "Talk to an expert", 28),
  action: "talk_to_sales", url: (qa?.cta_url || s.cta_url || "https://www.accops.com/schedule-a-free-demo").slice(0, 300) });

export const chips = (rows: QaRef[], skip: string[] = []): Chip[] =>
  rows.filter(r => r.id && r.id.length <= 80 && !skip.includes(r.id)).slice(0, 3).map(r => ({ id: r.id, label: cut(r.question, 60) }));

/** The model's picks -> blocks: drop refs outside the candidates, types the candidate does not offer, duplicates;
 *  at most 4 blocks and one table. */
export function fill(picks: { type: string; ref: string }[], cands: Candidate[], pairs: Map<string, Qa>): Block[] {
  const byRef = new Map(cands.map(c => [c.ref, c])), seen = new Set<string>(), out: Block[] = [];
  for (const p of picks) {
    const c = byRef.get(p.ref);
    if (!c || !c.types.includes(p.type) || seen.has(`${p.ref}|${p.type}`) || out.length >= 4) continue;
    if (p.type === "compare_table" && out.some(b => b.type === "compare_table")) continue;
    seen.add(`${p.ref}|${p.type}`);
    if (c.kind === "qa") { const qa = pairs.get(qaId(c.ref)); if (qa) out.push(...qaBlocks(qa, p.type)); continue; }
    if (p.type === "text" && c.kind === "fact") { // a page fact: its verbatim public quote + the page
      const src = source(c.url);
      out.push({ type: "text", body: c.text.slice(0, 600), ...(src ? { source: src } : {}) });
    } else if (p.type === "doc_card" && (c.kind === "asset" || c.kind === "page") && source(c.url)) {
      out.push({ type: "doc_card", title: cut(c.title, 120), kind: c.kind === "asset" ? "Document" : "Page",
        summary: cut(c.text, 220), url: source(c.url)!.url, action: c.kind === "asset" && /\.pdf($|\?)/i.test(c.url!) ? "download" : "read" });
    }
  }
  return out.slice(0, 4);
}
