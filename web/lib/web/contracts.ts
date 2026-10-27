import type { Answer } from "@/lib/blocks";
export type Label = "human" | "suspect" | "bot";
export type Source = "bank" | "intent" | "cache" | "model" | "fallback" | "guard" | "limited" | "repeat";
export type Turn = { kind: "click"; qa_id: string } | { kind: "typed"; text: string };
export type Ctx = { kind: Turn["kind"]; conversation_id: string; visitor_id: string; page: string; page_group: string; country: string | null; ip_hash: string;
  ua: string; hs: string | null; parent: boolean; ms_since_render: number; recent_ms: number[]; eval: boolean };
export type Candidate = { ref: string; kind: "qa" | "fact" | "page" | "asset"; types: string[]; title: string; text: string; url: string | null };
export type Classify = (req: Request, ctx: Ctx) => Promise<{ label: Label; signals: string[] }>;          // F
export type Admit = (ctx: Ctx, kind: "typed" | "click", q_hash: string | null) => Promise<null | "rate" | "repeat">; // F
/** `talk`: the talk-to-sales CTA from settings, put in place of guard.ts's default (benchmark, 27 Oct). */
export type PreGuard = (text: string, talk?: Answer["blocks"][number]) => { reason: string; answer: Answer } | null; // F
export type CacheGet = (q_hash: string) => Promise<Answer | null>;                                           // F
export type CachePut = (q_hash: string, page_group: string, a: Answer, source: Source) => Promise<void>;      // F
export type IntentMatch = (text: string, page_group: string) => { qa_id: string; score: number; margin: number } | null; // G
/** Tier 3 (27 Oct 2026, text-first): the model's written answer, the candidate refs it cites, an optional qa visual
 *  ({type:"none"} = none) and follow-up qa ids. null = no slot or every provider failed. */
export type Written = { verdict: "answered" | "partial" | "none"; answer: string; cites: string[]; visual: { type: string; ref: string };
  followups: string[]; model: string; tokens: number };
export type WriteAnswer = (q: string, cands: Candidate[]) => Promise<Written | null>; // B
