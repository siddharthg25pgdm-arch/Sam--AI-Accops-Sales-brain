import { z } from "zod";
export const Source = z.object({ label: z.string().max(60), url: z.url() });                     // "accops.com/hysecure"
export const Text = z.object({ type: z.literal("text"), body: z.string().max(600), source: Source.optional() });
export const DocCard = z.object({ type: z.literal("doc_card"), title: z.string().max(120), kind: z.string().max(30),
  summary: z.string().max(220), meta: z.string().max(60).optional(), url: z.url(), action: z.enum(["read", "download"]),
  thumb: z.string().max(200).optional() });                                                       // /web-thumbs/<id>.webp or an allowlisted og:image
export const CompareTable = z.object({ type: z.literal("compare_table"), title: z.string().max(80),
  columns: z.array(z.string().max(30)).min(2).max(3),
  rows: z.array(z.object({ label: z.string().max(40), cells: z.array(z.string().max(80)), group: z.string().max(24).optional(),
    detail: z.string().max(240).optional(), accent: z.number().int().min(0).max(2).optional() })).min(1).max(12),
  filters: z.array(z.string().max(24)).max(5).optional(), footnote: z.string().max(160).optional(), source: Source });
export const Steps = z.object({ type: z.literal("steps"), title: z.string().max(80),
  steps: z.array(z.object({ title: z.string().max(60), body: z.string().max(200).optional(), need: z.array(z.string().max(60)).max(4).optional() })).min(2).max(7),
  source: Source });
export const Stat = z.object({ type: z.literal("stat"), value: z.string().max(12), label: z.string().max(80), context: z.string().max(140).optional(), source: Source });
export const Picker = z.object({ type: z.literal("picker"), prompt: z.string().max(80),
  options: z.array(z.object({ label: z.string().max(40), qa_id: z.string().max(80) })).min(2).max(6) });
export const Calculator = z.object({ type: z.literal("calculator"), title: z.string().max(80),
  input: z.object({ label: z.string().max(40), min: z.number(), max: z.number(), step: z.number(), default: z.number(), unit: z.string().max(16) }),
  columns: z.array(z.string().max(30)).length(2),
  rows: z.array(z.object({ label: z.string().max(40), per_unit: z.array(z.number()).length(2), currency: z.string().max(4) })).min(1).max(5),
  disclaimer: z.string().min(20).max(200), source: Source });
export const Cta = z.object({ type: z.literal("cta"), label: z.string().max(28), action: z.enum(["talk_to_sales", "open_url"]), url: z.string().max(300), sub: z.string().max(80).optional() });
export const Block = z.discriminatedUnion("type", [Text, DocCard, CompareTable, Steps, Stat, Picker, Calculator, Cta]);
export const Chip = z.object({ id: z.string().max(80), label: z.string().max(60) });            // id = an approved qa id
export const Answer = z.object({ lead: z.string().max(120).optional(), blocks: z.array(Block).max(5), chips: z.array(Chip).max(3) });
export type Block = z.infer<typeof Block>; export type Chip = z.infer<typeof Chip>; export type Answer = z.infer<typeof Answer>;
