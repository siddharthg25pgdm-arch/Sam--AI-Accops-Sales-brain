"use client";
// The design review surface: every block in every state, from fixtures. Answers go through the real path
// (toOpenUI -> <Renderer>); the extra states render the block component directly with its gallery-only `init`.
import { useState, type ComponentType } from "react";
import type { ActionEvent } from "@openuidev/react-lang";
import type { Answer } from "@/lib/blocks";
import { Thinking } from "@/components/blocks/Answer";
import { Calculator } from "@/components/blocks/Calculator";
import { CompareTable } from "@/components/blocks/CompareTable";
import { Cta } from "@/components/blocks/Cta";
import { DocCard } from "@/components/blocks/DocCard";
import { AnswerBlocks } from "@/components/blocks/library";
import { ActCtx } from "@/components/blocks/parts";
import { Picker } from "@/components/blocks/Picker";
import { Stat } from "@/components/blocks/Stat";
import { Steps } from "@/components/blocks/Steps";
import { Text } from "@/components/blocks/Text";
import data from "@/components/blocks/fixtures.json";

type State = { label: string; block: number; init?: unknown; props?: Record<string, unknown> };
type Fixture = { id: string; name: string; data: string; answer: Answer; states?: State[] };
const fixtures = data.fixtures as unknown as Fixture[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C: Record<Answer["blocks"][number]["type"], ComponentType<any>> = { text: Text, doc_card: DocCard, compare_table: CompareTable, steps: Steps, stat: Stat, picker: Picker, calculator: Calculator, cta: Cta };
const tone = (d: string) => (/^BLOCKED/.test(d) ? "blocked" : /^(PROPOSED|SYNTHETIC)/.test(d) || /PROPOSED/.test(d) ? "proposed" : "bank");

export default function Gallery() {
  const [last, setLast] = useState("Nothing yet. Tab through a block and press Enter.");
  const log = (type: string, params: Record<string, unknown>, label: string) =>
    setLast(`${type} · ${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(" · ")} · “${label}”`);
  const onAction = (e: ActionEvent) => log(e.type, e.params, e.humanFriendlyMessage);

  return (
    <main className="g">
      <header className="g-head">
        <p className="g-kicker">SAM · website answers</p>
        <h1>Block gallery</h1>
        <p>Every block and state, rendered from fixtures through <code>jsonToOpenUI</code> → <code>&lt;Renderer&gt;</code>. Internal and not indexed.</p>
      </header>
      <nav className="g-toc" aria-label="Fixtures">
        {fixtures.map(f => <a key={f.id} href={`#${f.id}`}>{f.name}</a>)}
        <a href="#thinking">Thinking states</a>
      </nav>
      {fixtures.map(f => (
        <section key={f.id} id={f.id} className="g-fx" aria-labelledby={`${f.id}-h`}>
          <div className="g-meta">
            <h2 id={`${f.id}-h`}>{f.name}</h2>
            <p><span className={`g-tag g-${tone(f.data)}`}>{tone(f.data)}</span>{f.id} · {f.data}</p>
          </div>
          <div className="g-frame"><AnswerBlocks answer={f.answer} onAction={onAction} /></div>
          {f.states?.map((s, i) => {
            const b = f.answer.blocks[s.block];
            const Comp = C[b.type];
            return (
              <div key={i}>
                <h3 className="g-state">State: {s.label}</h3>
                <div className="g-frame">
                  <ActCtx.Provider value={(t, p, l) => { log(t, p, l); return true; }}>
                    <div className="sb"><Comp {...b} {...s.props} init={s.init} /></div>
                  </ActCtx.Provider>
                </div>
              </div>
            );
          })}
        </section>
      ))}
      <section id="thinking" className="g-fx" aria-labelledby="thinking-h">
        <div className="g-meta"><h2 id="thinking-h">Thinking states (model answers only)</h2><p>3-dot pulse up to 600 ms, then skeleton lines.</p></div>
        <div className="g-frame"><Thinking /></div>
        <div className="g-frame"><Thinking skeleton /></div>
      </section>
      <p className="g-log" role="status" aria-live="polite"><strong>onAction</strong> {last}</p>
    </main>
  );
}
