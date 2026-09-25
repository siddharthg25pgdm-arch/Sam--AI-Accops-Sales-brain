import Anthropic from "@anthropic-ai/sdk";
import { searchAssets, queryTokens, tokenMatcher, facetCounts, VERTICALS, PRODUCTS, yearOf, isStale, trustNote, assetLink, assetLocation, assetKey, typeGroup, productsOf, verticalOf, type SearchHit, type SearchArgs, type Asset } from "./cards";
import { askOpenAICompat, openAICompatConfigured, compatModels } from "./agent-openai";
import { providerFailure, type AskError } from "./events";

export type AskResult = {
  text: string;
  assets: { title: string; asset_type: string; industry: string; why: string; link: string | null; location: string | null; visibility: string; year: string | null; stale: boolean; trust: string | null; path: string | null }[];
  trace: { step: string; detail: string }[];
  /** Which path answered. "local" = retrieval only, no model. Consumers that only care whether a
   *  model was involved should test `runtime !== "local"`, never `=== "claude"`. */
  runtime: "claude" | "openai-compatible" | "local" | "search";
  /** The model that wrote the reply; null when retrieval answered. */
  model: string | null;
  intent: string;
  filters: Record<string, unknown>;
  /** Nothing at all to show: no cards. */
  zero: boolean;
  /** The exact thing asked for is not in the library, though substitutes may be shown. Always true
   *  when zero is. This, not zero, is what logs a content gap and offers "ask marketing to create this". */
  missing: boolean;
  /** What went wrong, if anything. Retrieval still answers when a model fails, so the person sees a
   *  reply either way - this is how the failure stays visible to the dashboard. */
  error: AskError | null;
};

// Tight on purpose: Groq's free tier allows 8,000 tokens a minute, and this prompt is re-sent on
// every round of every question. No library counts - they went stale twice and a stale "we have no
// decks" once suppressed correct answers.
export const SYSTEM = `You are SAM. You help Accops sales reps find collateral. Accops is an Indian cybersecurity and digital
workspace vendor: HySecure (ZTNA), HyID (MFA/SSO), HyWorks (VDI/DaaS), HyLabs, HyDesk (thin clients), Browser Isolation.

- Name ONLY documents search_assets returned, by exact title. Never invent a document, client, number or price.
  A result that meets the need in substance (right industry or product, other type) fits. If none is exactly what was
  asked, start "No exact ..." and still list the 2 closest as "- **exact title** - substitute: why it helps".
  Name none only if every result is unrelated.
- A search in the rep's own words has already run; its results are above. Search again only if none of them fit.
  Set asset_type only when the rep names a type. The server widens a filter that finds nothing and decides internal
  vs external from the rep's wording, so never repeat a search reworded. At most 2 more searches.
- The library has case studies, whitepapers, decks, brochures and datasheets, certificates, and competitive battlecards
  (vs Citrix, VMware Horizon, Omnissa, Zscaler, Cisco AnyConnect and others). A battlecard IS a deck: when a rep asks
  for a deck and a battlecard fits, recommend it as the deck.
- visibility "public" may be sent outside Accops; "internal" must not leave Accops. Say which in each asset's line.
  Say "public" or "published" in the verdict only if the rep is sending something outside Accops.
- trust is a warning to pass on: EXPIRED means do not send it; a newer edition means recommend that one; an age note
  goes in that asset's line.
- Case-study clients are anonymised: use the descriptor unless the result names the client.
- Reply: one verdict sentence, then up to 3 lines "- **exact title** - why it fits this ask". No links. Under 100 words.
  No greeting.`;

/** Searches one question may make. The round after the last one runs with tools switched off, so the
 *  model has to answer from what it found - "The model ran out of steps" was ~1 in 6 production answers. */
export const MAX_SEARCHES = 3;
/** Results per search handed to the model. Three become cards; one spare lets it pick the newer
 *  edition. Was 5 at 300-char briefs, which made the tool payload most of every question's tokens. */
const SEARCH_LIMIT = 4;
export const ASSET_TYPES = ["Case Study", "Whitepaper", "Battlecard", "Deck", "Brochure", "Video"];

const tools: Anthropic.Tool[] = [{
  name: "search_assets",
  description: "Search Accops sales and marketing collateral. Returns ranked assets with why they matched.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What the salesperson needs, in plain words: use case, competitor, regulator, persona." },
      asset_type: { type: "string", enum: [...ASSET_TYPES, ""], description: "Only when the rep names a type. Battlecard = competitive comparisons; Brochure includes datasheets." },
      vertical: { type: "string", enum: [...Object.keys(VERTICALS), ""], description: "Optional industry filter." },
      product: { type: "string", enum: [...PRODUCTS, ""], description: "Optional product filter." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  strict: true,
}];

export function toCard(h: SearchHit) {
  const a = h.asset;
  return { title: a.title, asset_type: a.asset_type, industry: a.industry, why: h.why, link: assetLink(a), location: assetLocation(a),
    visibility: a.public_url ? "public" : "internal", year: yearOf(a), stale: isStale(a),
    // Why a rep should hesitate, in words. Null for most assets; an expiry or a newer edition for
    // the ones where sending the wrong copy actually costs something.
    trust: trustNote(a), path: a.file?.path ?? null };
}
/** What the model sees of each result. Every field here is re-sent on every later round of the
 *  question, so it is the biggest token cost SAM has: short brief, two outcomes, empty fields dropped. */
export function toolPayload(hits: SearchHit[], note: string | null = null) {
  const keep = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length)));
  return JSON.stringify({ ...(note ? { note } : {}), results: hits.map(({ asset: a, why }) => keep({
    title: a.title, type: a.asset_type, industry: a.industry, client: a.client, products: a.products.join(", "),
    use_for: a.use_for.slice(0, 100), brief: (a.brief || a.key_problem || "").slice(0, 160),
    outcomes: a.key_outcomes.slice(0, 2).map(o => o.slice(0, 80)), year: yearOf(a),
    // The model needs the REASON, not just a boolean. "stale: true" cannot distinguish an old but
    // perfectly usable whitepaper from an ISO certificate that expired two years ago, and only one
    // of those must never be sent to procurement. trustNote() also carries the age warning.
    trust: trustNote(a),
    visibility: a.public_url ? "public" : "internal", matched: why })) });
}

// "public sector" is a vertical, not a request to send something outside Accops.
const EXTERNAL = /\b(send|sending|email|mail|share|forward|give|hand)\b[^.?!]{0,40}\b(customer|client|prospect|buyer|cio|ciso|cto|them|outside)\b|\bfor (a|the|my|our) (customer|client|prospect)\b|customer-facing|client-facing|\bpublic\b(?! sector)|\bexternal(ly)?\b|\bsend to\b|\bshare with\b|\bforward\b/;

/** Heuristic slot extraction used by the local fallback, and the ONLY source of `audience` for the
 *  models too. Left to the model, the first search was external almost every time - "which deck has
 *  the Citrix comparison?" made four identical public-only searches and ran out of steps. External
 *  now means the rep said they are sending it outside Accops; "internal" in the ask always wins. */
export function heuristicFilters(q: string) {
  const p = q.toLowerCase();
  const vertical = Object.entries(VERTICALS).find(([, words]) => words.some(w => p.includes(w)))?.[0] ?? "";
  const asset_type = /white ?paper|guide|ebook|pov/.test(p) ? "Whitepaper" : /case stud|proof|reference|customer story|deployment/.test(p) ? "Case Study" : "";
  const product = PRODUCTS.find(x => p.includes(x.toLowerCase())) ?? "";
  const audience: "internal" | "external" = !/\binternal\b|\bmy own\b/.test(p) && EXTERNAL.test(p) ? "external" : "internal";
  return { vertical, asset_type, product, audience };
}

function pick(value: unknown, options: string[]): string | undefined {
  const v = String(value ?? "").trim().toLowerCase(); if (!v) return undefined;
  const exact = options.find(o => o.toLowerCase() === v); if (exact) return exact;
  const partial = options.find(o => o.toLowerCase().includes(v) || v.includes(o.toLowerCase().split(" ")[0])); if (partial) return partial;
  const hit = Object.entries(VERTICALS).find(([, words]) => words.some(w => v.includes(w)))?.[0];
  return hit && options.includes(hit) ? hit : undefined;
}

/** A free-text asset type as the catalogue groups it, through the same typeGroup() the catalogue
 *  uses: "datasheet" is a Brochure, "presentation" a Deck, "comparison" a Battlecard. Anything it
 *  cannot place is no filter at all rather than a wrong one. */
export function assetTypeOf(value: unknown): string | undefined {
  const v = String(value ?? "").toLowerCase().replace(/[\s-]+/g, "");
  if (!v) return undefined;
  if (/compar|versus|^vs/.test(v)) return "Battlecard";
  // Not a catalogue group, but a real registry type (26 files): searchAssets matches it on asset_type.
  if (/video|recording/.test(v)) return "Video";
  const g = typeGroup({ asset_type: v } as Asset);
  return g === "Other" ? undefined : g;
}

/** Asset types the rep's own words ask for. */
const TYPE_WORDS: [string, RegExp][] = [
  ["Case Study", /case ?stud|customer stor|reference/],
  ["Whitepaper", /white ?paper|e-?book|thought leadership|\bpov\b/],
  ["Battlecard", /battle ?card|competitive|comparison|compare|\bvs\.?\b|versus/],
  ["Deck", /\bdecks?\b|presentation|\bslides?\b|\bppt/],
  ["Brochure", /brochure|data ?sheet|leaflet|flyer|one[- ]?pager/],
  ["Video", /\bvideos?\b|\brecordings?\b/],
];
export function typesNamedIn(q: string): string[] {
  const p = q.toLowerCase();
  return TYPE_WORDS.filter(([, re]) => re.test(p)).map(([t]) => t);
}

export type SearchRun ={ hits: SearchHit[]; considered: number; input: SearchArgs; note: string | null; payload: string };

/** One search as a model asked for it, with what the server knows better applied on top. Both model
 *  paths call this, so the rules live once:
 *    - arguments are normalised leniently (open models send "Banking", "datasheet", "5");
 *    - audience comes from the rep's words, never the model (see heuristicFilters);
 *    - asset_type applies only when the rep's words name that type. The model added "Whitepaper" to
 *      datasheet, brochure and certificate asks, and a wrong type filter rarely returns ZERO - it
 *      returns one irrelevant whitepaper, so widening-on-empty never fires. Unfiltered, the ranking
 *      already rewards a type word in the query;
 *    - a filter that finds nothing is dropped here - audience, then asset_type, then product - and
 *      the model is told which, instead of spending its next round re-asking in reworded text. */
export function runSearch(raw: Record<string, unknown>, question: string): SearchRun {
  const wanted = assetTypeOf(raw.asset_type);
  const notes: string[] = [];
  if (wanted && !typesNamedIn(question).includes(wanted)) notes.push(`asset_type ${wanted} ignored because the rep did not ask for that type`);
  let args: SearchArgs = {
    query: String(raw.query ?? "").trim() || question,
    asset_type: wanted && typesNamedIn(question).includes(wanted) ? wanted : undefined,
    vertical: pick(raw.vertical, Object.keys(VERTICALS)),
    product: pick(raw.product, PRODUCTS),
    audience: heuristicFilters(question).audience,
    limit: SEARCH_LIMIT,
  };
  let { results, considered } = searchAssets(args);
  if (!results.length && args.audience === "external") {
    args = { ...args, audience: "internal" }; ({ results, considered } = searchAssets(args));
    notes.push("nothing published matches, so these are internal only");
  }
  for (const k of ["asset_type", "product"] as const) {
    if (results.length || !args[k]) continue;
    notes.push(`nothing matched ${k} ${args[k]}, so that filter was dropped`);
    args = { ...args, [k]: undefined }; ({ results, considered } = searchAssets(args));
  }
  const note = notes.length ? `${notes.join("; ")}.` : null;
  return { hits: results, considered, input: args, note, payload: toolPayload(results, note) };
}

// ---- Grounding: a document may be named to a rep only if a search in this turn returned it. ----
//
// The prompt already said "never invent a document", and production still named "HyID Product
// Overview Deck", "HyID vs Okta Battlecard" and "HyID Technical Whitepaper" after three empty
// searches. So it is enforced on the text here, not requested of the model.

const STOP_T = new Set(["the", "a", "an", "of", "for", "and", "to", "in", "on", "with", "by", "from", "accops", "our", "this", "that", "its", "your"]);
function toks(s: string): string[] {
  return s.toLowerCase().replace(/white paper/g, "whitepaper").replace(/data sheet/g, "datasheet").replace(/battle card/g, "battlecard").replace(/e-book/g, "ebook")
    .split(/[^a-z0-9]+/).map(t => t.replace(/ies$/, "y").replace(/s$/, "")).filter(t => t.length > 1 && !STOP_T.has(t));
}
/** Words that make a span a document name rather than emphasis ("**Internal only**" is not a title). */
const DOC_NOUN = /\b(decks?|battle ?cards?|white ?papers?|brochures?|data ?sheets?|case stud(?:y|ies)|overviews?|guides?|reports?|certificat(?:e|es|ion)|presentations?|comparisons?|e-?books?|briefs?|playbooks?|one-pagers?)\b/i;
/** A capitalised phrase ending in a document type, for titles written into a sentence unmarked. The
 *  noun list is narrower than DOC_NOUN because "Guide" and "Report" are ordinary words in a reason. */
const TITLE_PHRASE = /(?:[A-Z0-9][\w&+.'’-]*[ \t]+){1,7}(?:Deck|Battlecard|Battle Card|Whitepaper|White Paper|Brochure|Datasheet|Data Sheet|Case Study|Presentation|eBook|E-book)s?\b/g;
const LEAD = /^(?:the|a|an|this|that|our|any|no|its|their|these|those)\s+/i;
/** "we have no **SOC 2 report**" is the honest answer, not an invented document. */
const NEGATED = /\b(?:no|not|any|don['’]t|doesn['’]t|isn['’]t|aren['’]t|lacks?|without|never)\s+(?:[\w-]+\s+){0,2}(?:\*\*|__|["“])?$/i;

/** Every span of `text` that reads as a document name: bold or quoted spans with a document noun,
 *  the lead of each list item (a bold lead always - the reply shape asks for "- **title** - why"),
 *  and capitalised "... Deck" / "... Whitepaper" phrases. A span straight after a negation is skipped.
 *  ponytail: a heuristic. An unbolded, unquoted invented title with no document noun gets past it;
 *  if the eval's grounding column shows that happening, move to index references ("[2]"). */
export function namedTitles(text: string): string[] {
  const out = new Set<string>();
  const add = (s: string, always: boolean, before = "") => {
    const bare = s.replace(/\*\*|__/g, "").trim();
    const lead = bare.match(LEAD)?.[0] ?? "";
    const t = bare.slice(lead.length).trim();
    if (t.length < 4 || NEGATED.test(before + lead)) return;
    if (always || DOC_NOUN.test(t)) out.add(t);
  };
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (!item) continue;
    const bold = item[1].match(/^\*\*(.+?)\*\*/);
    add(bold ? bold[1] : item[1].split(/\s[-–—]\s|:\s|\s\(/)[0], Boolean(bold));
  }
  const before = (i: number) => text.slice(Math.max(0, i - 40), i);
  for (const m of text.matchAll(/\*\*(.+?)\*\*|__(.+?)__|["“]([^"”\n]{4,120})["”]/g)) add(m[1] ?? m[2] ?? m[3], false, before(m.index));
  for (const m of text.matchAll(TITLE_PHRASE)) add(m[0], false, before(m.index));
  return [...out];
}

/** True when `name` plausibly refers to `a`: most of its words appear in the title, type or filename.
 *  Lenient on purpose - a model shortens "Accops Powered VDI vs Citrix VDI" to "the Citrix VDI
 *  comparison" - because what it must catch is a name that shares almost nothing with any result. */
export function namesAsset(name: string, a: Asset): boolean {
  const c = toks(name);
  if (!c.length) return true;
  const t = new Set(toks(`${a.title} ${a.asset_type} ${typeGroup(a)} ${a.industry} ${(a.file?.path ?? "").split("/").pop() ?? ""}`));
  return c.filter(x => t.has(x)).length / c.length >= 0.7;
}

/** An answer whose verdict is "we don't have it". Only acted on when it also names no document. */
const DENIAL = /^\W*(no\b|none\b|nothing\b|there (is|are) no\b|we (do not|don['’]t) have\b|sam (does not|doesn['’]t) have\b|the library (does not|doesn['’]t) have\b|i (could not|couldn['’]t) find\b|unfortunately\b)/i;
const GAP_TEXT = "Nothing in the library matches that, and it has been logged as a content gap. Try a broader industry or product, or browse the catalogue.";
// "what does hyworks cost", "pricing for HyWorks" - not "cost savings case study".
// Only a request for ACCOPS pricing: "a customer moving after Broadcom's price hike" is deal context,
// and the old bare-word match answered it with the canned pricing line and no cards.
export const PRICE_ASK = new RegExp([
  String.raw`\bprice ?lists?\b`, String.raw`\bquotations?\b`,
  String.raw`\b(pricing|quotes?)\s+(for|of|on)\b`,
  String.raw`\b(prices?|cost)\s+(for|of)\s+(a |an |the )?(accops|hy|ztna|mfa|vdi|daas|licen|subscription|\d)`,
  String.raw`\bhow much (does|do|is|are|would|will|for)\b`,
  String.raw`\bwhat (does|do|would|will) .{1,40}\bcost\b`,
  String.raw`\b(licen[cs]e|licen[cs]ing|subscription|per[- ]?(user|seat|device))\s+(price|pricing|cost)s?\b`,
  String.raw`\b(accops|our|hy(secure|id|works|labs|desk)|ztna|mfa|vdi|daas)\s+(price|pricing|quote)s?\b`,
  String.raw`^\W*(price|pricing|quote)\b`,
].join("|"), "i");
const NO_PRICING = "Pricing is not in the collateral library, so SAM cannot quote it. Check current pricing with your sales manager. This has been logged as a content gap.";

// ---- Missing, and what may stand in for it ----------------------------------------------------

/** A type the rep named, satisfied by this asset. A battlecard IS a deck (see searchAssets). */
function isType(a: Asset, t: string): boolean {
  if (t === "Video") return /video|demo/i.test(a.asset_type) || /\.(mp4|mov|webm)$/i.test(a.file?.path ?? "");
  const g = typeGroup(a);
  return g === t || (t === "Deck" && g === "Battlecard");
}

/** The asset is ABOUT the product: in its title or its FIRST product tag (the primary one). Cards tag
 *  every product a document mentions - the HySecure Gateway datasheet lists seven, Browser Isolation
 *  among them - so any-tag matching made it "a Browser Isolation brochure". ("rbi" is not an alias:
 *  in this library it is the Reserve Bank of India.) */
const ALIAS: Record<string, string[]> = { "Browser Isolation": ["browser isolation", "vajra", "virtual browser"], ZTNA: ["ztna", "hysecure"], HySecure: ["hysecure", "ztna"],
  MFA: ["mfa", "hyid"], HyID: ["hyid", "mfa"], VDI: ["vdi", "hyworks"], DaaS: ["daas", "hyworks"], HyWorks: ["hyworks", "vdi", "daas"], "Thin Clients": ["thin client", "hydesk"], HyDesk: ["hydesk", "thin client"] };
export function isAbout(a: Asset, product: string): boolean {
  const hay = `${a.title} ${a.products[0] ?? ""}`.toLowerCase();
  return (ALIAS[product] ?? [product.toLowerCase()]).some(w => new RegExp(`(?<![a-z])${w}`).test(hay));
}

/** The rep named a document type and nothing SAM is about to show is one: "remote browser isolation
 *  brochure" answered with an eBook has not delivered a brochure, whatever the prose says. */
export function typeMissing(question: string, hits: SearchHit[]): boolean {
  const types = typesNamedIn(question);
  return types.length > 0 && hits.length > 0 && !hits.some(h => types.some(t => isType(h.asset, t)));
}

/** Words in an ask that say who it is for, not what it is about. */
const GENERIC = new Set(["customer", "client", "prospect", "cio", "ciso", "cto", "buyer", "need", "one", "pager", "document", "doc", "material", "collateral", "sheet", "data", "new", "good", "best", "send", "share", "external", "internal", "public"]);

/** The relevance floor for a substitute. It must be a real document (not a logo, banner or social
 *  image - "Social-Media-Banners.png" is not a stand-in for a whitepaper) and share something with
 *  the ask beyond its type: the product, the industry, or a topic word in its title or use.
 *  ponytail: word overlap, not meaning. Enough to keep junk out; the model still picks the best. */
export function substituteFits(question: string, a: Asset): boolean {
  if (/brand|logo|banner|social|image/i.test(a.asset_type) || /\.(png|jpe?g|gif|svg|webp|ico)$/i.test(a.file?.path ?? "")) return false;
  const f = heuristicFilters(question);
  if (f.product && productsOf(a).includes(f.product)) return true;
  if (f.vertical && verticalOf(a) === f.vertical) return true;
  const words = queryTokens(question).filter(w => !typesNamedIn(w).length && !GENERIC.has(w) && !/^(report|webinar|ebook|slides?)$/.test(w));
  // With a product or industry named, a topic word must be in the TITLE ("City Pharmacy" for a pharma
  // ask filed under retail); "remote" somewhere in a BFSI case study's use_for is not a substitute
  // for a Browser Isolation brochure.
  const hay = `${a.title} ${productsOf(a).join(" ")} ${f.product || f.vertical ? "" : a.use_for}`.toLowerCase();
  return words.some(w => tokenMatcher(w).test(hay));
}

/** Drop the list lines of `text` that name a document not in `keep`. The verdict sentence stays. */
function keepLines(text: string, keep: SearchHit[]): string {
  return text.split("\n").filter(line => {
    if (!/^\s*(?:[-*•]|\d+[.)])\s+/.test(line)) return true;
    const n = namedTitles(line);
    return !n.length || n.some(x => keep.some(h => namesAsset(x, h.asset)));
  }).join("\n").trim();
}

/** The answer SAM gives when it will not use the model's prose: plain, and built only from real cards. */
function plainAnswer(cards: AskResult["assets"], question: string): string {
  if (!cards.length) return GAP_TEXT;
  const lines = ["No exact match I can vouch for. Closest in the library:"];
  if (heuristicFilters(question).audience === "external" && !cards.some(c => c.visibility === "public"))
    lines.push("None of these is published, so ask marketing before sending anything outside Accops.");
  for (const c of cards) if (c.trust) lines.push(`- ${c.title}: ${c.trust}`);
  return lines.join("\n");
}

/** Close out a model answer. Both model paths end here, so the guarantees hold for either:
 *    1. No search returned anything -> a plain gap, whatever the model wrote. An empty search is
 *       exactly when the prose invented documents ("internal brochures contain the cost details").
 *    2. The prose names a document no search returned -> the prose is replaced by plainAnswer().
 *    3. Cards come from EVERY search this turn, not just the last (the prose draws on all of them):
 *       the documents the prose names, in its order, then the best of the rest. Max 3. */
/** The retrieval floor. Plain search on the rep's own words scored 93% hit@3 while the model, left to
 *  write its own queries and filters, scored 64-71%: it rewrote "public sector bank case study" and
 *  "proxmox" into searches that missed what the words alone found. So this search always runs first,
 *  its results go to the model as an already-made tool call, and they join the card pool. The model
 *  can now only add to what plain search finds, not replace it. */
export function seedSearch(question: string): SearchRun | null {
  // Nothing searchable ("hi", "thanks"): an empty query matches the whole library, and a greeting
  // would come back with three random assets under it.
  if (!queryTokens(question).length) return null;
  const f = heuristicFilters(question);
  // A type the rep named is a filter too (runSearch drops it again if it finds nothing).
  const asset_type = f.asset_type || typesNamedIn(question)[0] || "";
  const a = runSearch({ query: question, asset_type, vertical: f.vertical, product: f.product }, question);
  if (!f.vertical && !f.product) return a;
  // Industry and product tags are keyword guesses, and a mis-tagged asset is invisible to a filtered
  // search: City Pharmacy is filed under E-commerce / Retail, so "pharma customer proof" never saw it;
  // HySecure demo videos carry no product tag. So the words alone run too, and fill the list.
  const b = runSearch({ query: question, asset_type }, question);
  const seen = new Set<string>(), hits: SearchHit[] = [];
  for (const h of [...a.hits.slice(0, 3), ...b.hits, ...a.hits.slice(3)]) {
    const k = assetKey(h.asset);
    if (!seen.has(k) && hits.length < SEARCH_LIMIT + 1) { seen.add(k); hits.push(h); }
  }
  const note = [a.note, b.hits.some(h => !a.hits.some(x => assetKey(x.asset) === assetKey(h.asset))) ? "some results matched the words without the industry/product filter" : null].filter(Boolean).join("; ") || null;
  return { hits, considered: a.considered, input: a.input, note, payload: toolPayload(hits, note) };
}

/** What to search for. A short follow-up ("anything newer?", "shorter one? 1-2 pages") means nothing
 *  on its own and came back a gap; it is about the previous question, so it is searched with it.
 *  ponytail: "no topic words of its own, or opens like a follow-up, and names no type" is the whole
 *  test; "citrix battlecard" after a pharma question is searched on its own, which is right. */
export function searchText(question: string, history: { role: string; content: string }[] = []): string {
  const prev = [...history].reverse().find(h => h.role === "user")?.content?.trim();
  if (!prev) return question;
  if (typesNamedIn(question).length) return question; // "citrix battlecard" is a new ask
  const content = queryTokens(question).filter(t => !FOLLOW_WORDS.test(t));
  const opener = /^\W*(and|also|what about|how about|anything|any|something|shorter|longer|newer|older|another|other|more|same|that|this|it|one|ok|okay)\b/i.test(question);
  return content.length === 0 || opener ? `${prev} ${question}` : question;
}
const FOLLOW_WORDS = /^(newer|older|shorter|longer|smaller|bigger|pages?|another|else|more|one|version|edition|similar|instead|also)$/;
export const SEED_STEP = "tool call: search_assets (the rep's own words)";

export function finish(p: {
  question: string; text: string; pool: SearchHit[]; calls: number; runtime: AskResult["runtime"]; model: string | null;
  trace: AskResult["trace"]; filters: Record<string, unknown>; error: AskError | null;
}): AskResult {
  let hits = best(p.pool), text = p.text.trim();
  const names = namedTitles(text);
  const bad = names.filter(n => !hits.some(h => namesAsset(n, h.asset)));
  if (bad.length) p.trace.push({ step: "grounding guard: answer replaced", detail: `named ${bad.length} document(s) no search returned: ${bad.join("; ")}`.slice(0, 300) });
  // Named documents without searching at all: search for it, rather than trust what the model remembers.
  if (bad.length && !p.calls) {
    const s = runSearch({ query: p.question }, p.question);
    hits = s.hits;
    p.trace.push({ step: "tool call: search_assets (grounding)", detail: JSON.stringify(s.input) }, { step: "tool result", detail: `${s.hits.length} of ${s.considered} assets` });
  }
  const searched = p.calls > 0 || bad.length > 0;
  // A pricing ask finds real product brochures, and the prose then said "internal brochures contain
  // the cost details" - a claim about content, which the title guard cannot see. So unless a returned
  // document is ABOUT price (by title; battlecards mention competitors' price rises in passing), a
  // pricing ask is a gap. A price list added later passes.
  if (PRICE_ASK.test(p.question) && !hits.some(h => /\b(price|pricing)\b/i.test(h.asset.title))) {
    p.trace.push({ step: "grounding guard: pricing", detail: "no returned document is a price list" });
    return { text: NO_PRICING, assets: [], trace: p.trace, runtime: p.runtime, model: p.model, filters: p.filters, error: p.error, intent: "gap", zero: true, missing: true };
  }
  const named = names.map(n => hits.find(h => namesAsset(n, h.asset))).filter((h): h is SearchHit => Boolean(h));
  const gap = (t: string, why: string): AskResult => {
    p.trace.push({ step: "verdict: nothing fits", detail: why });
    return { text: t, assets: [], trace: p.trace, runtime: p.runtime, model: p.model, filters: p.filters, error: p.error, intent: "gap", zero: true, missing: true };
  };
  // The verdict is "we don't have it". The exact thing is missing (a gap, and the rep may ask marketing
  // for it), but the rep still gets the closest real documents, clearly as substitutes:
  //   - the ones the model named, if they clear the relevance floor (at most 2);
  //   - otherwise the best results that clear it. The model over-rejects: production said "No pharma
  //     case study" over four pharma whitepapers and a public pharmacy case study, and zero cards hid
  //     all of them. Only when nothing clears the floor (banner PNGs for a whitepaper ask) is it a
  //     plain gap with no cards.
  if (searched && text && !bad.length && DENIAL.test(text)) {
    const verdict = text.split("\n")[0].trim();
    let subs = [...new Set(named)].filter(h => substituteFits(p.question, h.asset)).slice(0, 2);
    let out: string;
    if (subs.length) {
      if (subs.length < named.length) p.trace.push({ step: "substitutes: floor", detail: `kept ${subs.length} of ${named.length} named substitutes` });
      out = keepLines(text, subs);
    } else {
      subs = hits.filter(h => substituteFits(p.question, h.asset)).slice(0, 2);
      if (!subs.length) return gap(verdict, named.length ? "the model's substitutes share nothing with the ask" : "the model rejected every result and nothing clears the relevance floor");
      p.trace.push({ step: "substitutes: from the results", detail: `the model named ${named.length ? "only unrelated documents" : "none"}; showing the ${subs.length} closest that share the ask's product, industry or topic` });
      out = `${verdict}\nClosest in the library:`;
    }
    if (heuristicFilters(p.question).audience === "external" && !subs.some(h => h.asset.public_url))
      out += "\nNone of these is published, so ask marketing before sending anything outside Accops.";
    return { text: out, assets: subs.map(toCard), trace: p.trace, runtime: p.runtime, model: p.model, filters: p.filters, error: p.error,
      intent: "gap", zero: false, missing: true };
  }
  const shown = [...new Set([...named, ...hits])].slice(0, 3);
  const cards = shown.map(toCard);
  if (searched && !hits.length) text = GAP_TEXT;
  else if (bad.length || !text) text = plainAnswer(cards, p.question);
  // A gap is "we ended up with nothing", not "the first search missed": the first search is often
  // over-filtered and widened later. No search at all (a greeting) is not a gap either.
  const zero = searched && !hits.length;
  const missing = zero || (searched && typeMissing(p.question, shown));
  if (missing && !zero) p.trace.push({ step: "verdict: type missing", detail: `asked for ${typesNamedIn(p.question).join(" or ")}; none of the results is one` });
  return { text, assets: cards, trace: p.trace, runtime: p.runtime, model: p.model, filters: p.filters, error: p.error,
    intent: searched ? (missing ? "gap" : "find_asset") : "other", zero, missing };
}

/** One entry per asset across every search, at its best score, best first. */
function best(pool: SearchHit[]): SearchHit[] {
  const m = new Map<string, SearchHit>();
  for (const h of pool) { const k = assetKey(h.asset), seen = m.get(k); if (!seen || h.score > seen.score) m.set(k, h); }
  return [...m.values()].sort((a, b) => b.score - a.score);
}

// Leaves ~20 s of the route's 60 s maxDuration for retrieval, logging and a second provider.
const MODEL_BUDGET_MS = 40_000;

export async function ask(question: string, history: { role: "user" | "assistant"; content: string }[] = []): Promise<AskResult> {
  const t0 = Date.now(), deadline = t0 + MODEL_BUDGET_MS;
  const failures: { model: string; message: string; timeout: boolean }[] = [];
  const failed = (model: string, err: unknown) => {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    console.error(`${model} failed, falling back`, e);
    // fetch() reports network failures as a bare "fetch failed"; the reason is on .cause.
    const cause = e?.cause ? `${e.cause.code ?? ""} ${e.cause.message ?? ""}`.trim() : "";
    const message = [e?.message ?? String(err), cause].filter(Boolean).join(": ");
    failures.push({ model, message, timeout: e?.name === "TimeoutError" || e?.name === "APIConnectionTimeoutError" || /time(d)? ?out/i.test(message) });
  };
  // A model that answers after an earlier provider failed keeps its own error if it has one (an
  // empty answer outranks a recovered outage); otherwise the recovered failure is what gets recorded.
  const withFailures = (r: AskResult): AskResult => ({ ...r, error: r.error ?? providerFailure(failures, true) });
  if (openAICompatConfigured()) {
    // Primary, then a second model on the same provider. Groq's free-tier limits are per model, so
    // when gpt-oss-120b is out of tokens for the minute (429) gpt-oss-20b usually is not - better a
    // smaller model than none. Skipped when there is too little time left for a whole answer.
    for (const model of compatModels()) {
      if (Date.now() > deadline - 5_000) break;
      try { return withFailures(await askOpenAICompat(question, history, t0, deadline, model)); }
      catch (err) { failed(model, err); }
    }
  }
  if (process.env.ANTHROPIC_API_KEY && Date.now() < deadline) {
    try { return withFailures(await askClaude(question, history, t0, deadline)); }
    catch (err) { failed(process.env.CLAUDE_MODEL ?? "claude-sonnet-5", err); }
  }
  const local = askLocal(searchText(question, history), t0);
  // Surface provider failures in the trace so a silent fallback is visible in the UI, API and dashboard.
  for (const f of failures) local.trace.unshift({ step: "model provider failed, fell back to retrieval", detail: `${f.model}: ${f.message}`.slice(0, 300) });
  return { ...local, error: providerFailure(failures, false) };
}

async function askClaude(question: string, history: { role: "user" | "assistant"; content: string }[], t0: number, deadline: number): Promise<AskResult> {
  const client = new Anthropic();
  const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-5";
  // Effort is supported on Opus/Sonnet 4.6+ and errors on Haiku 4.5, so only send it where it works.
  const effort = /haiku/.test(model) ? {} : { output_config: { effort: "medium" as const } };
  const messages: Anthropic.MessageParam[] = [...history.slice(-4), { role: "user", content: question }];
  const trace: AskResult["trace"] = [];
  const pool: SearchHit[] = [];
  const sq = searchText(question, history); // what to search for: a short follow-up carries the previous question
  const seed = seedSearch(sq);
  if (seed) {
    pool.push(...seed.hits);
    trace.push({ step: SEED_STEP, detail: JSON.stringify(seed.input) }, { step: "tool result", detail: `${seed.hits.length} of ${seed.considered} assets${seed.note ? ` - ${seed.note}` : ""}` });
    messages.push({ role: "assistant", content: [{ type: "tool_use", id: "seed", name: "search_assets", input: { query: sq } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "seed", content: seed.payload }] });
  }
  let filters: Record<string, unknown> = seed ? { ...seed.input } : {}, calls = seed ? 1 : 0;
  // Same shape as askOpenAICompat: up to MAX_SEARCHES searching rounds, then one with tools off.
  for (let round = 0; ; round++) {
    const final = calls >= MAX_SEARCHES || round >= MAX_SEARCHES;
    const res = await client.messages.create({ model, max_tokens: 2000, system: SYSTEM, tools, tool_choice: { type: final ? "none" : "auto" }, messages, ...effort },
      { timeout: Math.max(1000, deadline - Date.now()), maxRetries: 0 });
    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (final || res.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("\n").trim();
      trace.push({ step: "model", detail: `${model} · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${res.usage.input_tokens} in / ${res.usage.output_tokens} out` });
      return finish({ question: sq, text, pool, calls, runtime: "claude", model, trace, filters,
        error: text ? null : { kind: final ? "step_exhausted" : "empty_answer", detail: `${model} finished with no text after ${calls} searches` } });
    }
    messages.push({ role: "assistant", content: res.content });
    const results: (Anthropic.ToolResultBlockParam | Anthropic.TextBlockParam)[] = [];
    for (const tu of toolUses) {
      const s = runSearch(tu.input as Record<string, unknown>, sq);
      calls++; filters = { ...s.input };
      pool.push(...s.hits);
      trace.push({ step: "tool call: search_assets", detail: JSON.stringify(s.input) }, { step: "tool result", detail: `${s.hits.length} of ${s.considered} assets${s.note ? ` - ${s.note}` : ""}` });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: s.payload });
    }
    if (calls >= MAX_SEARCHES) results.push({ type: "text", text: BUDGET_USED });
    messages.push({ role: "user", content: results });
  }
}

export const BUDGET_USED = "Search budget used. Answer now from the results above.";

function askLocal(question: string, t0: number): AskResult {
  // The keyword router only knows two types; a brochure, deck or battlecard the rep names is a filter
  // too, so "remote browser isolation brochure" finds no brochure and says so instead of passing an
  // eBook off as one.
  const hf = heuristicFilters(question);
  const f = { ...hf, asset_type: hf.asset_type || typesNamedIn(question)[0] || "" };
  const trace: AskResult["trace"] = [{ step: "router (local heuristics)", detail: JSON.stringify(Object.fromEntries(Object.entries(f).filter(([, v]) => v))) }];
  // Some assets ARE published now, so an external ask is answerable rather than automatically a
  // false gap. Try external first when that is what was asked, and fall back to internal only if it
  // finds nothing - the old code searched internally always and told every rep that nothing could
  // be sent, which stopped being true once the public links landed.
  const askedExternal = f.audience === "external";
  let args = { query: question, ...f, audience: askedExternal ? "external" as const : "internal" as const, limit: 3 } as Parameters<typeof searchAssets>[0];
  trace.push({ step: "tool call: search_assets", detail: JSON.stringify(args) });
  let { results, considered } = searchAssets(args);
  // Asked for something sendable and nothing is published: widen to internal and say so, rather
  // than reporting a gap for an asset the library actually holds.
  let externalEmpty = false;
  if (!results.length && askedExternal) {
    externalEmpty = true;
    args = { ...args, audience: "internal" as const };
    trace.push({ step: "tool call: search_assets (internal fallback)", detail: JSON.stringify(args) });
    ({ results, considered } = searchAssets(args));
  }
  const exactZero = results.length === 0;
  if (!results.length && (f.asset_type || f.product)) {
    args = { ...args, asset_type: undefined, product: undefined };
    trace.push({ step: "tool call: search_assets (relaxed)", detail: JSON.stringify(args) });
    ({ results, considered } = searchAssets(args));
  }
  trace.push({ step: "tool result", detail: `${results.length} of ${considered} assets` });
  trace.push({ step: "model", detail: `none, retrieval only · ${Date.now() - t0}ms` });
  // Same rule as finish(): a pricing ask with no price list is a gap on every path.
  if (PRICE_ASK.test(question) && !results.some(h => /\b(price|pricing)\b/i.test(h.asset.title)))
    return { text: NO_PRICING, assets: [], trace, runtime: "local", model: null, intent: "gap", filters: f, zero: true, missing: true, error: null };
  const label = f.vertical ? ` for ${f.vertical}` : "";
  // With no model to read the results, "exact" is mechanical: of the type the rep named, and ABOUT
  // the product they named (in its title or product tags), not merely mentioning it. The product
  // filter matches brief text, so "remote browser isolation brochure" found three datasheets for
  // other products whose briefs mention browser isolation, and called them a fit.
  const types = typesNamedIn(question);
  const exact = (a: Asset) => (!types.length || types.some(t => isType(a, t))) && (!f.product || isAbout(a, f.product));
  const missing = exactZero || !results.some(h => exact(h.asset));
  let shown = results;
  if (missing && results.length) {
    // Substitutes: the product's own documents first, whatever their type, then the rest; only
    // ones that clear the relevance floor, at most 2.
    const wide = searchAssets({ ...args, asset_type: undefined, limit: 8 }).results;
    const pool = [...new Map([...wide, ...results].map(h => [assetKey(h.asset), h])).values()];
    shown = [...pool.filter(h => f.product && isAbout(h.asset, f.product)), ...pool].filter((h, i, all) => all.indexOf(h) === i)
      .filter(h => substituteFits(question, h.asset)).slice(0, 2);
    trace.push({ step: "verdict: no exact match", detail: `nothing returned is ${[f.product, types.join(" or ")].filter(Boolean).join(" ") || "an exact fit"}; ${shown.length} substitute(s)` });
  }
  let text: string;
  const want = [f.vertical, f.product, (types[0] ?? f.asset_type)?.toLowerCase()].filter(Boolean).join(" ");
  if (!results.length) text = `Nothing in the library matches that${label}. Try a broader industry, drop the product, or browse the catalogue on the right.`;
  else if (missing && !shown.length) text = `There is no ${want || "exact match"} in the library, and nothing close enough to suggest instead.`;
  else if (missing) text = `There is no ${want || "exact match"} in the library. Closest substitutes${label}:`;
  else if (results.length === 1) text = `One asset fits${label}.`;
  else text = `${results.length} assets fit${label}. The first is the closest match.`;
  // Only say "internal only" when it is true of what was actually returned. Saying it unconditionally
  // told reps a public case study could not be sent, which is the false-gap defect in reverse.
  if (externalEmpty && shown.length) text += " None of these is published yet, so ask marketing before sending anything outside Accops.";
  return { text, assets: shown.map(toCard), trace, runtime: "local", model: null, intent: missing ? "gap" : "find_asset", filters: f,
    zero: !shown.length, missing, error: null };
}

export function catalogueSummary() { return facetCounts(); }
export type { Asset };
