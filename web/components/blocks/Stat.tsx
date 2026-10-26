"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { Stat as StatT } from "@/lib/blocks";
import { SourcePill, reducedMotion } from "./parts";

type Props = Omit<z.infer<typeof StatT>, "type">;
const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** One sourced figure. Plain numbers ("50%", "1000+", "12") count up once when they appear on screen; anything else
 *  ("ISO 27001:2022", "8 → 1") shows as written. Long values step the type size down instead of overflowing. */
export function Stat({ value, label, context, source }: Props) {
  const m = /^(\d{1,7})([^\d]{0,3})$/.exec(value.replace(/,/g, ""));
  const target = m ? Number(m[1]) : null;
  const [n, setN] = useState<number | null>(null);   // null = show the value as written
  const el = useRef<HTMLDivElement>(null);

  // ponytail: count up only if the figure is on screen when it mounts (a new answer is); otherwise it simply shows
  // the value. It never sits on a partial number: no observer to miss, and the cleanup restores the real value.
  useIso(() => {
    const r = el.current?.getBoundingClientRect();
    if (target === null || target < 2 || reducedMotion() || !r || r.top < 0 || r.bottom > innerHeight) return;
    let raf = 0;
    const t0 = performance.now(), dur = 700;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setN(p >= 1 ? null : Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    setN(0);
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); setN(null); };
  }, [target]);

  const size = value.length > 10 ? " sb-v-s" : value.length > 6 ? " sb-v-m" : "";
  return (
    <div className="sb-stat" ref={el}>
      <p className="sb-stat-v">
        <span className={`sb-v${size}`} aria-hidden="true">{n === null ? value : `${n}${m?.[2] ?? ""}`}</span>
        <span className="sb-sr">{value}</span>
      </p>
      <p className="sb-stat-l">{label}</p>
      {context && <p className="sb-stat-c">{context}</p>}
      <SourcePill source={source} />
    </div>
  );
}
