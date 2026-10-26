"use client";
import { useId, useState } from "react";
import type { z } from "zod";
import type { Calculator as CalculatorT } from "@/lib/blocks";
import { ICON, Icon, SourcePill } from "./parts";

type Props = Omit<z.infer<typeof CalculatorT>, "type">;

const money = (v: number, cur: string) => {
  if (/^[A-Z]{3}$/.test(cur)) {
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(v); } catch { /* unknown code */ }
  }
  return `${cur}${Math.round(v).toLocaleString("en-US")}`;
};

/** A seats slider over approved per-unit figures. Nothing here is a quote: the disclaimer is always on screen.
 *  The loader refuses a calculator pair without figures_approved; `init` (gallery only) sets the slider. */
export function Calculator({ title, input, columns, rows, disclaimer, source, init }: Props & { init?: number }) {
  const id = useId();
  const clamp = (v: number) => Math.min(input.max, Math.max(input.min, v));
  const [v, setV] = useState(clamp(init ?? input.default));
  const unit = `${v.toLocaleString("en-US")} ${input.unit}`;
  return (
    <div role="group" className="sb-calc" aria-labelledby={`${id}t`}>
      <h3 className="sb-title" id={`${id}t`}>{title}</h3>
      <div className="sb-calc-in">
        <label htmlFor={`${id}r`}>{input.label}</label>
        <output htmlFor={`${id}r`} aria-live="polite">{unit}</output>
        <input id={`${id}r`} type="range" min={input.min} max={input.max} step={input.step} value={v}
          aria-valuetext={unit} onChange={e => setV(clamp(Number(e.target.value)))}
          style={{ ["--p" as string]: `${((v - input.min) / (input.max - input.min || 1)) * 100}%` }} />
      </div>
      <table className="sb-calc-t">
        <thead><tr><td /><th scope="col">{columns[0]}</th><th scope="col">{columns[1]}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <th scope="row">{r.label}</th>
              <td>{money(r.per_unit[0] * v, r.currency)}</td>
              <td>{money(r.per_unit[1] * v, r.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sb-note"><Icon d={ICON.info} />{disclaimer}</p>
      <SourcePill source={source} />
    </div>
  );
}
