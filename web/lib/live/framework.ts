/** The Accops qualification framework SAM Live tracks on every call (docs/live/2026-10-14-sam-live-design.md).
 *  In code rather than a template editor until someone needs to change it (design decision 12).
 *  `cue` = words that show a field is being talked about: the mock reads customer lines with it, and the
 *  insight uses it to drop an "ask next" the rep has just asked. ponytail: keyword regexes, not a model. */
export type Status = "open" | "partial" | "done";
export type Field = { status: Status; value: string; evidence: string };
export type Qualification = Record<string, Field>;

export const FRAMEWORK = [
  { key: "need", label: "Need", hint: "The pain, and why now",
    question: "What's prompting you to look at this now?",
    cue: /\b(trigger|flagged|problem|pain|issue|struggl\w*|why now|prompted|driving this|not working)\b/i },
  { key: "current_solution", label: "Current solution", hint: "Citrix, VMware/Omnissa Horizon, AVD, none…",
    question: "What are you using today for remote access and virtual desktops?",
    cue: /\b(we're on|we are on|currently (on|use|using|run|running)|running today|using today|today for|citrix|netscaler|xenapp)\b/i },
  { key: "users", label: "Users", hint: "How many, and what kind",
    question: "How many users would this cover, and who are they?",
    cue: /\b(\d[\d,]*\s*(users|staff|employees|seats|people|engineers)|how many users|user count|concurrent)\b/i },
  { key: "use_case", label: "Use case", hint: "Remote work, BYOD, contractors, branch, DR…",
    question: "Which use cases matter most: branches, work from home, vendors, DR?",
    cue: /\b(branch(es)?|work from home|wfh|remote work|byod|contractors?|vendors?|third[- ]party|disaster recovery|dr site|use cases?|thin clients?)\b/i },
  { key: "compliance", label: "Compliance", hint: "RBI, SEBI, DPDP, IRDAI, ISO…",
    question: "Which regulations or audits do you need to satisfy?",
    // Not "audit" or "inspection": those are usually the need ("the audit flagged..."), not the rule itself.
    cue: /\b(rbi|sebi|irdai|dpdp|iso ?27001|iso|pci|hipaa|gdpr|regulat\w*|complian\w*|cyber ?security framework)\b/i },
  { key: "budget", label: "Budget", hint: "Allocated, range, or tied to a renewal",
    question: "Is budget set aside for this, or does it depend on the business case?",
    cue: /\b(budget\w*|lakh|crore|spend|business case|funding|approved amount)\b/i },
  { key: "decision_maker", label: "Decision maker", hint: "Who signs, who evaluates",
    question: "Who else is involved in the decision, and who signs off?",
    cue: /\b(sign[- ]?off|signs off|approv\w*|decision|decides|final say|board|md|ceo|cfo|involved in)\b/i },
  { key: "timeline", label: "Timeline", hint: "Deadline, renewal date, go-live",
    question: "What timeline are you working towards? Is there a renewal date?",
    cue: /\b(timeline|deadline|go[- ]live|by (end of )?(january|february|march|april|may|june|july|august|september|october|november|december|q[1-4]|next (month|quarter|year))|renewal (is )?due|this quarter|next quarter)\b/i },
  { key: "competition", label: "Competition", hint: "Who else they are evaluating",
    question: "Are you evaluating anyone else?",
    cue: /\b(also (looking|evaluating|considering|talking)|evaluating|shortlist\w*|other vendors|omnissa|compar\w* (you|with))\b/i },
  { key: "next_step", label: "Next step", hint: "Agreed next action and date",
    question: "What would be a sensible next step, and when?",
    cue: /\b(next step|proof of concept|poc|pilot|technical session|demo|workshop|follow[- ]up call|next (monday|tuesday|wednesday|thursday|friday|week))\b/i },
] as const;

/** Vendors a customer may be evaluating or running instead of Accops, as named in cards.ts ENTITIES. */
export const COMPETITORS = new Set(["Citrix", "VMware", "Omnissa", "Broadcom", "AVD", "AWS WorkSpaces", "Zscaler", "Cisco", "Fortinet",
  "Palo Alto", "Okta", "Ivanti", "Sophos", "Netskope", "Forcepoint", "Cloudflare", "Parallels", "Workspot", "Check Point"]);

export const KEYS: string[] = FRAMEWORK.map(f => f.key);
/** What the desktop app renders: no cue regexes on the wire. */
export const PUBLIC_FRAMEWORK = FRAMEWORK.map(({ key, label, hint }) => ({ key, label, hint }));

const RANK: Record<Status, number> = { open: 0, partial: 1, done: 2 };
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Anything -> a well-formed field. Unknown statuses are "open". */
export function field(v: unknown): Field {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const status: Status = o.status === "done" || o.status === "partial" ? o.status : "open";
  return { status, value: text(o.value, 200), evidence: text(o.evidence, 300).replace(/^["“']+|["”']+$/g, "") };
}

export function blank(): Qualification {
  return Object.fromEntries(KEYS.map(k => [k, field(null)]));
}

/** A field only moves forward: done stays done whatever a later reading says. On the same status the newer
 *  reading wins only when it brings its own evidence, so an unevidenced restatement never replaces a quote;
 *  an upgrade without a value or quote keeps the earlier one's. Unknown keys are dropped. */
export function merge(prev: Qualification | null | undefined, next: Qualification | null | undefined): Qualification {
  const out: Qualification = {};
  for (const k of KEYS) {
    const a = field(prev?.[k]), b = field(next?.[k]);
    if (RANK[b.status] > RANK[a.status]) out[k] = { status: b.status, value: b.value || a.value, evidence: b.evidence || a.evidence };
    else if (RANK[b.status] < RANK[a.status]) out[k] = a;
    else out[k] = b.evidence && b.value ? b : { ...a, value: a.value || b.value };
  }
  return out;
}

/** done counts 1, partial half. pct is what the dashboard calls "qualification". */
export function progress(q: Qualification | null | undefined) {
  const fs = KEYS.map(k => field(q?.[k]).status);
  const done = fs.filter(s => s === "done").length, partial = fs.filter(s => s === "partial").length;
  return { done, partial, open: KEYS.length - done - partial, pct: Math.round(((done + partial / 2) / KEYS.length) * 100) };
}

/** The cue regex of a framework key; null for an unknown key. */
export function cueOf(key: string): RegExp | null {
  return FRAMEWORK.find(f => f.key === key)?.cue ?? null;
}
