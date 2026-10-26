"use client";
import { useId, useState } from "react";
import type { z } from "zod";
import type { Steps as StepsT } from "@/lib/blocks";
import { ICON, Icon, SourcePill, useAct } from "./parts";

type Props = Omit<z.infer<typeof StepsT>, "type">;

/** Up to 3 steps: a plain numbered rail, all open. Above 3: a stepper (segmented progress, the current step open
 *  with its "you'll need" checklist, Back/Next). `init` (gallery only) opens a given step. */
export function Steps({ title, steps, source, init }: Props & { init?: number }) {
  const act = useAct();
  const id = useId();
  const stepper = steps.length > 3;
  const [cur, setCur] = useState(Math.min(Math.max(init ?? 0, 0), steps.length - 1));
  const go = (i: number) => {
    if (i === cur || i < 0 || i >= steps.length) return;
    setCur(i);
    act("event", { name: "step_viewed", step: i + 1 }, steps[i].title);
  };

  return (
    <div role="group" className={`sb-steps${stepper ? " sb-stepper" : ""}`} aria-labelledby={`${id}t`}>
      <h3 className="sb-title" id={`${id}t`}>{title}</h3>
      {stepper && (
        <div className="sb-progress">
          <span className="sb-segs" aria-hidden="true">
            {steps.map((_, i) => <span key={i} className={i <= cur ? "sb-on" : undefined} />)}
          </span>
          <p className="sb-count" aria-live="polite">Step {cur + 1} of {steps.length}</p>
        </div>
      )}
      <ol className="sb-rail">
        {steps.map((s, i) => {
          const state = !stepper ? "open" : i < cur ? "done" : i === cur ? "open" : "next";
          const body = (state === "open") && (s.body || s.need?.length) ? (
            <div className="sb-step-body" id={`${id}b${i}`}>
              {s.body && <p>{s.body}</p>}
              {!!s.need?.length && (
                <div className="sb-need">
                  <p className="sb-eyebrow">You&rsquo;ll need</p>
                  <ul>{s.need.map((n, k) => <li key={k}><Icon d={ICON.check} />{n}</li>)}</ul>
                </div>
              )}
            </div>
          ) : null;
          return (
            <li key={i} className={`sb-step sb-${state}`} aria-current={stepper && i === cur ? "step" : undefined}>
              <span className="sb-dot" aria-hidden="true">{state === "done" ? <Icon d={ICON.check} /> : i + 1}</span>
              <div className="sb-step-main">
                {stepper ? (
                  <button type="button" className="sb-step-title" onClick={() => go(i)} aria-expanded={i === cur}
                    aria-controls={i === cur && body ? `${id}b${i}` : undefined}>
                    <span className="sb-sr">Step {i + 1}{state === "done" ? ", done" : ""}: </span>{s.title}
                  </button>
                ) : <p className="sb-step-title">{s.title}</p>}
                {body}
              </div>
            </li>
          );
        })}
      </ol>
      {stepper && (
        <div className="sb-nav">
          <button type="button" className="sb-btn2" onClick={() => go(cur - 1)} aria-disabled={cur === 0}>Back</button>
          <button type="button" className="sb-btn2 sb-btn2-strong" onClick={() => go(cur + 1)} aria-disabled={cur === steps.length - 1}>
            Next<Icon d={ICON.arrow} />
          </button>
        </div>
      )}
      <SourcePill source={source} />
    </div>
  );
}
