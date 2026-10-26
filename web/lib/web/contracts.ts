import type { Answer } from "@/lib/blocks";
export type Label = "human" | "suspect" | "bot";
export type Source = "bank" | "intent" | "cache" | "model" | "fallback" | "guard" | "limited" | "repeat";
export type Turn = { kind: "click"; qa_id: string } | { kind: "typed"; text: string };
export type Ctx = { kind: Turn["kind"]; conversation_id: string; visitor_id: string; page: string; page_group: string; country: string | null; ip_hash: string;
  ua: string; hs: string | null; parent: boolean; ms_since_render: number; recent_ms: number[]; eval: boolean };
export type Candidate = { ref: string; kind: "qa" | "fact" | "page" | "asset"; types: string[]; title: string; text: string; url: string | null };
export type Classify = (req: Request, ctx: Ctx) => Promise<{ label: Label; signals: string[] }>;          // F
export type Admit = (ctx: Ctx, kind: "typed" | "click", q_hash: string | null) => Promise<null | "rate" | "repeat">; // F
export type PreGuard = (text: string) => { reason: string; answer: Answer } | null;                           // F
export type CacheGet = (q_hash: string) => Promise<Answer | null>;                                           // F
export type CachePut = (q_hash: string, page_group: string, a: Answer, source: Source) => Promise<void>;      // F
export type IntentMatch = (text: string, page_group: string) => { qa_id: string; score: number; margin: number } | null; // G
export type PickBlocks = (q: string, cands: Candidate[]) => Promise<{ verdict: "answered" | "partial" | "none"; blocks: { type: string; ref: string }[]; model: string; tokens: number } | null>; // B
