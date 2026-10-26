"use client";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { z } from "zod";
import type { CompareTable as CompareTableT } from "@/lib/blocks";
import { ICON, Icon, SourcePill, useAct } from "./parts";

type Props = Omit<z.infer<typeof CompareTableT>, "type">;
type Row = Props["rows"][number];
/** Gallery only: open the table in a given state. */
export type TableInit = { filter?: string; diff?: boolean; open?: number };

/** accent: 0 = parity (hidden by "Differences only"), 1 = Accops advantage, 2 = worth checking. Unset = unmarked.
 *  The mark sits on the first value column (Accops by convention); cells are always text, never bare ticks. */
const same = (r: Row) => r.accent === 0 || (r.cells.length > 1 && r.cells.every(c => c.trim().toLowerCase() === r.cells[0].trim().toLowerCase()));

export function CompareTable({ title, columns, rows, filters, footnote, source, init }: Props & { init?: TableInit }) {
  const act = useAct();
  const id = useId();
  const [filter, setFilter] = useState(init?.filter ?? "");
  const [diff, setDiff] = useState(!!init?.diff);
  const [open, setOpen] = useState<number | null>(init?.open ?? null);
  const scroller = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState(false);

  // ponytail: filters only offered when rows carry those groups; a no-op control never shows
  const groups = (filters ?? []).filter(f => rows.some(r => r.group === f));
  const canDiff = rows.some(same) && rows.some(r => !same(r));
  const shown = rows.map((r, i) => [r, i] as const).filter(([r]) => (!filter || r.group === filter) && (!diff || !same(r)));
  const marks = new Set(rows.map(r => r.accent).filter(a => a === 1 || a === 2));
  const n = columns.length;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const upd = () => setEdge(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    upd();
    el.addEventListener("scroll", upd, { passive: true });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(upd) : null;
    ro?.observe(el);
    return () => { el.removeEventListener("scroll", upd); ro?.disconnect(); };
  }, []);

  const pick = (f: string) => { setFilter(f); setOpen(null); act("event", { name: "filter_used", filter: f || "all" }, f || "All"); };
  const flip = () => { setDiff(!diff); setOpen(null); act("event", { name: "filter_used", filter: diff ? "all_rows" : "differences" }, "Differences only"); };

  return (
    <figure className="sb-table">
      <figcaption className="sb-title" id={`${id}t`}>{title}</figcaption>
      {(groups.length > 0 || canDiff) && (
        <div className="sb-tools">
          {groups.length > 0 && (
            <div className="sb-filters" role="group" aria-label="Filter rows">
              {["", ...groups].map(f => (
                <button key={f || "all"} type="button" className="sb-chip-f" aria-pressed={filter === f} onClick={() => pick(f)}>
                  {f || "All"}
                </button>
              ))}
            </div>
          )}
          {canDiff && (
            <button type="button" role="switch" aria-checked={diff} className="sb-switch" onClick={flip}>
              <span className="sb-switch-track" aria-hidden="true"><span /></span>Differences only
            </button>
          )}
        </div>
      )}
      {/* 3 columns can scroll sideways: focusable so arrow keys scroll it (no role=region: repeated answers would repeat landmarks) */}
      <div className={`sb-scroll${edge ? " sb-edge" : ""}`} ref={scroller} tabIndex={n > 2 ? 0 : undefined}>
        <table className={`sb-cols-${n}`} aria-labelledby={`${id}t`}>
          <thead>
            <tr>{columns.map((c, i) => <th key={i} scope="col" className={i === 1 ? "sb-us" : undefined}>{c || <span className="sb-sr">Item</span>}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map(([r, i]) => {
              const isOpen = open === i;
              return (
                <Fragment key={i}>
                  <tr className={isOpen ? "sb-open" : undefined}>
                    <th scope="row">
                      {r.detail ? (
                        <button type="button" className="sb-rowbtn" aria-expanded={isOpen} aria-controls={`${id}d${i}`}
                          onClick={() => setOpen(isOpen ? null : i)}>
                          <span>{r.label}</span><Icon d={ICON.chevron} className="sb-chev" />
                        </button>
                      ) : r.label}
                    </th>
                    {Array.from({ length: n - 1 }, (_, c) => (
                      <td key={c} data-col={columns[c + 1]} className={c === 0 && (r.accent === 1 || r.accent === 2) ? `sb-acc-${r.accent}` : undefined}>
                        {c === 0 && r.accent === 1 && <Icon d={ICON.check} label="Accops advantage" className="sb-mark" />}
                        {c === 0 && r.accent === 2 && <Icon d={ICON.caution} label="Worth checking" className="sb-mark" />}
                        {r.cells[c] ?? "–"}
                      </td>
                    ))}
                  </tr>
                  {r.detail && (
                    <tr className="sb-detail" id={`${id}d${i}`} hidden={!isOpen}>
                      <td colSpan={n}><div>{r.detail}</div></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={n} className="sb-empty">No differences{filter ? ` in ${filter}` : ""}.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="sb-sr" aria-live="polite">{shown.length < rows.length ? `Showing ${shown.length} of ${rows.length} rows` : ""}</p>
      {(marks.size > 0 || footnote) && (
        <div className="sb-foot">
          {marks.size > 0 && (
            <span className="sb-legend" aria-hidden="true">
              {marks.has(1) && <span className="sb-acc-1"><Icon d={ICON.check} />Accops advantage</span>}
              {marks.has(2) && <span className="sb-acc-2"><Icon d={ICON.caution} />Worth checking</span>}
            </span>
          )}
          {footnote && <span>{footnote}</span>}
        </div>
      )}
      <SourcePill source={source} />
    </figure>
  );
}
