"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { Chip } from "@/lib/blocks";
import { useAct } from "./parts";

/** The answer root: the fixed lead line, the blocks staggered in 40 ms apart, then up to 3 follow-up chips. */
export function Answer({ lead, blocks, chips }: { lead?: string | null; blocks: ReactNode[]; chips: Chip[] }) {
  const act = useAct();
  let k = 0;
  return (
    <div className="sb sb-answer">
      {lead && <p className="sb-lead sb-in" style={{ ["--i" as string]: k++ }}>{lead}</p>}
      {blocks.map((b, i) => <div key={i} className="sb-in" style={{ ["--i" as string]: k++ }}>{b}</div>)}
      {chips.length > 0 && (
        <ul className="sb-chips sb-in" style={{ ["--i" as string]: k++ }} aria-label="Related questions">
          {chips.map(c => (
            <li key={c.id}>
              {c.url && c.id === "book" ? ( // "Book a time with an engineer": the calendar in the panel, as every talk-to-sales CTA
                <a className="sb-chip" href={c.url} target="_blank" rel="noopener noreferrer"
                  onClick={e => { if (act("cta", { action: "talk_to_sales", url: c.url }, c.label)) e.preventDefault(); }}>{c.label}</a>
              ) : c.url ? ( // a route off the chat (the support portal): a plain new-tab link, never an ask
                <a className="sb-chip" href={c.url} target="_blank" rel="noopener noreferrer">{c.label}<span className="sb-sr"> (opens in a new tab)</span></a>
              ) : <button type="button" className="sb-chip" onClick={() => act("ask", { qa_id: c.id, source: "chip" }, c.label)}>{c.label}</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Model answers only: a 3-dot pulse for up to 600 ms, then skeleton lines. Bank and intent answers never show it. */
export function Thinking({ skeleton = false }: { skeleton?: boolean }) {
  const [late, setLate] = useState(skeleton);
  useEffect(() => { if (!late) { const t = setTimeout(() => setLate(true), 600); return () => clearTimeout(t); } }, [late]);
  return (
    <div className="sb sb-thinking" role="status">
      <span className="sb-sr">Finding an answer</span>
      {late ? (
        <span className="sb-skel" aria-hidden="true"><span /><span /><span /></span>
      ) : (
        <span className="sb-dots" aria-hidden="true"><span /><span /><span /></span>
      )}
    </div>
  );
}
