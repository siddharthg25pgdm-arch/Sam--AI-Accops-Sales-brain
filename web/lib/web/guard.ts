/** Plan 3.3 step 4: the regex pre-guard. Runs on typed text before tiers 1-3, no model, no network. A hit returns a
 *  fixed safe answer (source `guard`). Kept narrow on purpose: it runs BEFORE the intent matcher, so a broad word
 *  ("price", "internal", "customers") would hide approved bank answers (lp-21 pricing, lp-26 published customers,
 *  HySecure's "internal apps"). Probes for internal material, injections and identities are what it stops.
 *  The red-team set it must catch: docs/eval-website-redteam.json (web/lib/web-guardrails.check.mjs). */
import type { Answer, Block } from "@/lib/blocks";
import type { PreGuard } from "./contracts";

// ponytail: fixed CTA (settings cta_url/label are async; PreGuard is sync). Same values as the settings defaults.
const TALK: Block = { type: "cta", label: "Talk to an expert", action: "talk_to_sales", url: "https://www.accops.com/schedule-a-free-demo" };
const say = (lead: string, cta: Block = TALK): Answer => ({ lead, blocks: [cta], chips: [] });

const PUBLIC_ONLY = say("I can only share what's published on accops.com. The team can help with anything else.");
const RULES: [reason: string, re: RegExp[], answer: Answer][] = [
  ["markup", [/<\s*\/?\s*(script|img|iframe|svg|object|embed|style|link|meta)\b/, /\bon[a-z]+\s*=/, /javascript\s*:/], PUBLIC_ONLY],
  ["injection", [
    /\bignore\s+(all\s+|any\s+)?(the\s+|your\s+)?(previous|prior|above|earlier|preceding|system|instructions)\b/,
    /\b(system|hidden|initial|original|developer)\s+(prompt|message|instructions?)\b/,
    /\b(your|previous|prior|above)\s+(instructions?|prompt|rules|guidelines)\b/,
    /\brepeat\s+(the\s+|all\s+|everything\s+)?(text|words|everything|content)?\s*(above|before|earlier)\b/,
    /\bstarting\s+with\s+["'“‘]?\s*you\s+are\b/, /\byou\s+are\s+now\b/, /\bpretend\s+(to\s+be|you)\b/,
    /\b(internal|developer|admin|debug|god|jailbreak|dan|sudo|unrestricted)\s+mode\b/, /\b(admin|root)\s+password\b/, /\bpassword\s+is\b/,
    /\b(candidate|record|internal)\s+(ids?|notes)\b/, /\breturn\s+(raw\s+|only\s+)?json\b/,
  ], PUBLIC_ONLY],
  ["internal", [
    /\bbattle\s*-?\s*cards?\b/, /\bsharepoint\b/, /\bconfluence\b/, /\bprice\s*-?\s*lists?\b/, /\b(customer|client)\s*-?\s*lists?\b/,
    /\b(client_actual|key_problem|use_for)\b/, /\b(sales|pitch)\s+(decks?|playbooks?|collateral|enablement|scripts?)\b/,
    /\binternal\s+(material|docs?|documents?|wiki|assets?|decks?|pricing|prices?|sales|notes)\b/,
    /\bdeck\b.{0,40}\b(you\s+)?send\s+to\b/,
  ], PUBLIC_ONLY],
  ["identity", [ // who is behind an anonymised case study, or every customer by name
    /\bwhich\s+(bank|customer|client|insurer|psu)\s+is\b/,
    /\b(customers?|clients?)\b.{0,30}\bby\s+name\b/, /\blist\s+(of\s+)?(all\s+)?(your|the)\s+(\w+\s+)?(customers|clients)\b/,
    /\b(real\s+name|who\s+is)\b.{0,40}\b(customer|client|bank|case\s+stud)/,
  ], PUBLIC_ONLY],
  ["pii", [/[\w.+-]+@[\w-]+\.[a-z][\w.-]*/, /\b(call|ring|whatsapp|text)\s+me\b/],
    say("Thanks. To have the team contact you, use the button below; this chat doesn't pass on contact details.")],
  ["contact", [/\b(e-?mail|phone|mobile|whatsapp|contact\s+(details|number|info))\b.{0,40}\b(head|vp|director|ceo|cto|cfo|founder|manager|of\s+your|for\s+your)\b/],
    say("The team can connect you with the right person directly.")],
  ["pricing", [/\bdiscounts?\b/, /\bprice\s*per\b/, /\bprice\s*sheet\b/, /\bquotation\b/, /\b(send|give|share|email|get)\b.{0,30}\bquote\b/],
    say("Accops doesn't publish prices here; the team will price it for your setup.")],
  ["roadmap", [/\b(product|your|accops|hysecure|hyworks|hyid|hylabs)\s+roadmap\b/, /\brelease\s+dates?\b/, /\b(next|upcoming|future)\s+(version|release|features?)\b/,
    /\bwhen\b.{0,40}\b(ship|ships|shipping|come\s+out|be\s+released)\b/],
    say("Release dates aren't shared here. The team can brief you on the roadmap.")],
  ["careers", [/\b(careers?|jobs?|vacanc(y|ies)|internships?|job\s+openings?|are\s+you\s+hiring)\b/],
    say("Open roles at Accops are listed on the careers page.", { type: "cta", label: "See open roles", action: "open_url", url: "https://www.accops.com/career" })],
];

/** A phone number: 10+ digits in one run of digits, spaces, dots, dashes and brackets. */
const phone = (t: string) => (t.match(/\+?\d[\d\s().-]{8,}\d/g) ?? []).some(m => m.replace(/\D/g, "").length >= 10);

export const preGuard: PreGuard = text => {
  const t = text.normalize("NFKC").toLowerCase().replace(/\p{Cf}/gu, ""); // zero-width tricks ("batt​le card") vanish
  for (const [reason, res, answer] of RULES) if (res.some(re => re.test(t))) return { reason, answer };
  return phone(t) ? { reason: "pii", answer: RULES.find(r => r[0] === "pii")![2] } : null;
};
