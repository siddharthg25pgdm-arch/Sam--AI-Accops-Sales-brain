"use client";
// The OpenUI component library for website answers (plan section 1 + 7.5). LOCKED mode: every prop schema IS the
// block contract (lib/blocks.ts minus `type`), the server fills every field from approved data, and
// library.prompt() is never called - no model ever writes OpenUI Lang or a word a visitor sees.
// Flow: Answer JSON -> toOpenUI() (jsonToOpenUI) -> <Renderer library onAction>. The host imports
// "@/components/blocks/blocks.css" once (kept out of here so node checks can load this file).
//
// onAction events the host (Widget, stage-1 Stream D) receives - ActionEvent { type, params, humanFriendlyMessage }:
//   type "ask"   params { qa_id, source: "picker" | "chip" }   -> ask that approved pair (tier 0); echo the label as the visitor bubble
//   type "cta"   params { action: "talk_to_sales" | "open_url", url }  -> postMessage {t:"cta", url} (link default is prevented)
//   type "event" params { name: "doc_opened" | "filter_used" | "step_viewed", ... }  -> analytics only
import { useMemo } from "react";
import { createLibrary, defineComponent, Renderer, useTriggerAction, type ActionEvent } from "@openuidev/react-lang";
// jsonToOpenUI lives in lang-core (react-lang 1.0.1 does not re-export it); lang-core is react-lang's own dependency,
// hoisted to web/node_modules by the lockfile. ponytail: make it a direct dependency if npm ever stops hoisting it.
import { jsonToOpenUI } from "@openuidev/lang-core";
import { z } from "zod";
import * as B from "@/lib/blocks";
import { Answer as AnswerView } from "./Answer";
import { Calculator } from "./Calculator";
import { CompareTable } from "./CompareTable";
import { Cta } from "./Cta";
import { DocCard } from "./DocCard";
import { ActCtx, type Act } from "./parts";
import { Picker } from "./Picker";
import { Stat } from "./Stat";
import { Steps } from "./Steps";
import { Text } from "./Text";

// ponytail: names map 1:1 to Block["type"]; descriptions stay one line because no prompt is ever generated
const parts = {
  text: defineComponent({ name: "Text", description: "Verbatim approved answer + source", props: B.Text.omit({ type: true }), component: ({ props }) => <Text {...props} /> }),
  doc_card: defineComponent({ name: "DocCard", description: "Public page or PDF card", props: B.DocCard.omit({ type: true }), component: ({ props }) => <DocCard {...props} /> }),
  compare_table: defineComponent({ name: "CompareTable", description: "Filterable comparison table", props: B.CompareTable.omit({ type: true }), component: ({ props }) => <CompareTable {...props} /> }),
  steps: defineComponent({ name: "Steps", description: "Steps / migration stepper", props: B.Steps.omit({ type: true }), component: ({ props }) => <Steps {...props} /> }),
  stat: defineComponent({ name: "Stat", description: "One sourced figure", props: B.Stat.omit({ type: true }), component: ({ props }) => <Stat {...props} /> }),
  picker: defineComponent({ name: "Picker", description: "Single-select options mapped to approved questions", props: B.Picker.omit({ type: true }), component: ({ props }) => <Picker {...props} /> }),
  calculator: defineComponent({ name: "Calculator", description: "Seats slider over approved per-unit figures", props: B.Calculator.omit({ type: true }), component: ({ props }) => <Calculator {...props} /> }),
  cta: defineComponent({ name: "Cta", description: "Primary call to action", props: B.Cta.omit({ type: true }), component: ({ props }) => <Cta {...props} /> }),
} satisfies Record<B.Block["type"], unknown>;

const Root = defineComponent({
  name: "Answer",
  description: "Answer root",
  props: z.object({
    lead: z.string().max(120).optional(),
    blocks: z.array(z.union(Object.values(parts).map(p => p.ref) as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]])).max(5),
    chips: z.array(B.Chip).max(3),
  }),
  component: function Root({ props, renderNode }) {
    const trigger = useTriggerAction();
    const act: Act = (type, params, label) => { void trigger(label, undefined, { type, params }); return true; };
    return (
      <ActCtx.Provider value={act}>
        <AnswerView lead={props.lead} chips={props.chips ?? []} blocks={(props.blocks ?? []).map(b => renderNode(b))} />
      </ActCtx.Provider>
    );
  },
});

export const library = createLibrary({ components: [Root, ...Object.values(parts)], root: "Answer" });

/** Answer JSON -> OpenUI Lang. Parses with the contract first: anything off-contract throws here, never renders. */
export function toOpenUI(answer: B.Answer): string {
  const a = B.Answer.parse(answer);
  const el = (typeName: string, props: Record<string, unknown>) => ({ type: "element" as const, typeName, props, partial: false });
  return jsonToOpenUI(el("Answer", {
    ...(a.lead ? { lead: a.lead } : {}),
    blocks: a.blocks.map(({ type, ...p }) => el(parts[type].name, p)),
    chips: a.chips,
  }), library);
}

/** The one thing a host renders per answer. */
export function AnswerBlocks({ answer, onAction }: { answer: B.Answer; onAction?: (e: ActionEvent) => void }) {
  const response = useMemo(() => toOpenUI(answer), [answer]);
  return <Renderer response={response} library={library} onAction={onAction} />;
}
