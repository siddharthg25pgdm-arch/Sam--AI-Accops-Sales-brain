"use client";
import { useId, useState } from "react";
import type { z } from "zod";
import type { Picker as PickerT } from "@/lib/blocks";
import { ICON, Icon, useAct } from "./parts";

type Props = Omit<z.infer<typeof PickerT>, "type">;

/** "What are you replacing?" + stacked full-width options (Klook pattern). Choosing one asks that approved qa_id;
 *  the choice stays marked and the rest lock, so one tap is one question. `init` (gallery only) = chosen qa_id. */
export function Picker({ prompt, options, init }: Props & { init?: string }) {
  const act = useAct();
  const id = useId();
  const [chosen, setChosen] = useState<string | null>(init ?? null);
  const choose = (o: Props["options"][number]) => {
    if (chosen) return;
    setChosen(o.qa_id);
    act("ask", { qa_id: o.qa_id, source: "picker" }, o.label);
  };
  return (
    <div className="sb-picker" role="group" aria-labelledby={`${id}p`}>
      <p className="sb-title" id={`${id}p`}>{prompt}</p>
      <ul>
        {options.map(o => {
          const on = chosen === o.qa_id;
          return (
            <li key={o.qa_id}>
              <button type="button" className={`sb-opt${on ? " sb-on" : ""}`} aria-pressed={on}
                aria-disabled={!!chosen && !on} onClick={() => choose(o)}>
                <span>{o.label}</span>
                <Icon d={on ? ICON.check : ICON.chevron} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
