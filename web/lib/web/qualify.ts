/** The tap-to-answer qualifying question (benchmark 27 Oct, approved by Siddharth): after the 1st answer and again after
 *  the 3rd, ONE question with fixed options under the answer's chips. Anonymous: allowlisted values only, no free text,
 *  never an email. The tap is stored as intent on the conversation (08 SQL sam_web_set_intent, which re-checks these
 *  same values) and answered with a one-line thank-you + 2 follow-ups. Pure (no imports but types), so the server
 *  (answer.ts), the Website tab (web-dashboard.ts) and the checks share one list. Siddharth may edit the strings. */
import type { Label, Source } from "./contracts";

export const QUALIFY = {
  users: { short: "Users", q: "how many users are on Citrix today?", off: "how many users would this cover?",
    options: { under_250: "Under 250", "250_1000": "250–1,000", "1000_5000": "1,000–5,000", "5000_plus": "5,000+" } },
  renewal: { short: "Renewal", q: "when is your Citrix renewal due?", off: "",
    options: { within_3m: "Within 3 months", "3_12m": "3–12 months", later: "Later", not_citrix: "Not on Citrix" } },
  platform: { short: "Runs today", q: "what are you running today?", off: "",
    options: { citrix: "Citrix", vmware_omnissa: "VMware or Omnissa", avd: "Azure Virtual Desktop", other: "Something else" } },
} as const;
export type QKey = keyof typeof QUALIFY;
export const KEYS = Object.keys(QUALIFY) as QKey[];
export type Card = { key: QKey; prompt: string; options: { value: string; label: string }[] };

/** An allowlisted (key, value), or false: the ONLY values the widget may send and the 08 SQL may store. */
export const valid = (key: string, value: string) =>
  Object.hasOwn(QUALIFY, key) && Object.hasOwn(QUALIFY[key as QKey].options, value);

/** The widget's record of this conversation's cards: "users" (shown) or "users=5000_plus" (answered). Junk is dropped. */
export function done(list: string[] | undefined): Map<QKey, string | null> {
  const m = new Map<QKey, string | null>();
  for (const s of list ?? []) {
    const [k, v, extra] = s.split("=");
    if (extra === undefined && Object.hasOwn(QUALIFY, k) && (v === undefined || valid(k, v))) m.set(k as QKey, v ?? null);
  }
  return m;
}

// Which question fits the turn: renewal after a pricing or licensing topic; the platform when the visitor hasn't named one.
// ponytail: two fixed word lists over the question (+ the previous one, + the pair's label); widen them if the Website
// tab's answers skew to one question.
const PRICING = /\b(pric\w*|costs?|costing|licen[cs]\w*|renew\w*|subscription\w*|quotes?|quoted|budget\w*|spend\w*|expensive|cheaper|discount\w*|tco)\b/i;
const PLATFORM = /\b(citrix|xen(app|desktop)|netscaler|vmware|horizon|omnissa|avd|azure virtual desktop|windows 365|w365|rds|remote desktop services|parallels)\b/i;
/** Answers that may carry the card: never a guard, limit or repeat reply, never the triage of a vague opener. */
export const ELIGIBLE: Source[] = ["bank", "intent", "cache", "model", "fallback"];

/** The card for this answer, or null. `n` = the conversation's sends so far, this one included (the widget's recent_ms,
 *  as the CTA timing): a card only after the 1st and the 3rd, at most 2 per conversation, never one already shown,
 *  humans only. */
export function pick(o: { n: number; label: Label; source: Source; reason?: string | null; topic: string; done: Map<QKey, string | null> }): Card | null {
  if (o.label !== "human" || (o.n !== 1 && o.n !== 3) || !ELIGIBLE.includes(o.source) || o.reason === "triage" || o.done.size >= 2) return null;
  const p = o.done.get("platform"), off = (!!p && p !== "citrix") || o.done.get("renewal") === "not_citrix"; // known not to be on Citrix
  const order: QKey[] = PRICING.test(o.topic) ? ["renewal", "users", "platform"] : !PLATFORM.test(o.topic) ? ["platform", "users", "renewal"] : ["users", "renewal", "platform"];
  const key = order.find(k => !o.done.has(k) && !(off && k === "renewal"));
  if (!key) return null;
  const d = QUALIFY[key], q = off && d.off ? d.off : d.q;
  return { key, prompt: `${o.done.size ? "One more, if that's OK" : "Quick one, so we point you to the right thing"}: ${q}`,
    options: Object.entries(d.options).map(([value, label]) => ({ value, label })) };
}

/** After a tap: the thank-you line, the approved pairs to offer (the caller keeps only live ones, tops up from the page's
 *  roots and the widget shows 2), and `book` = "Book a time with an engineer" first (the calendar in the panel). */
const NEXT: Record<string, { lead: string; ids: string[]; book?: true }> = {
  "users=under_250": { lead: "Thanks, that helps. For an estate that size, start here:", ids: ["lp-13", "lp-23"] },
  "users=250_1000": { lead: "Thanks, that helps. For an estate that size, start here:", ids: ["lp-23", "lp-06"] },
  "users=1000_5000": { lead: "Thanks, that helps. For an estate that size, start here:", ids: ["lp-06", "lp-07"] },
  "users=5000_plus": { lead: "Thanks. For a large deployment, these are the most useful next reads:", ids: ["lp-69", "lp-25"] },
  "renewal=within_3m": { lead: "Thanks. With a renewal that close, a call with an engineer is the quickest way to a plan:", ids: ["lp-21", "lp-07"], book: true },
  "renewal=3_12m": { lead: "Thanks. With some time before the renewal, these help you plan a move:", ids: ["lp-06", "lp-07"] },
  "renewal=later": { lead: "Thanks, that helps. These are a good place to start:", ids: ["lp-01", "lp-23"] },
  "renewal=not_citrix": { lead: "Thanks. Here's where Accops fits, whatever you run today:", ids: ["lp-33", "lp-61"] },
  "platform=citrix": { lead: "Thanks. These cover moving off Citrix:", ids: ["lp-02", "lp-05"] },
  "platform=vmware_omnissa": { lead: "Thanks. These cover running Accops on what you have today:", ids: ["lp-09", "lp-12"] },
  "platform=avd": { lead: "Thanks. These cover Accops with Azure Virtual Desktop:", ids: ["lp-14", "lp-13"] },
  "platform=other": { lead: "Thanks, that helps. These are a good place to start:", ids: ["lp-33", "lp-61"] },
};
export const next = (key: string, value: string) => (valid(key, value) ? NEXT[`${key}=${value}`] : null);
