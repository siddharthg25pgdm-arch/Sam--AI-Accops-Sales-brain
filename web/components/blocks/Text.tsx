"use client";
import type { z } from "zod";
import { emSplit } from "@/lib/emphasis";
import type { Text as TextT } from "@/lib/blocks";
import { SourcePill } from "./parts";

/** A verbatim bank answer or page quote ("From ..."), or the model's fact-checked answer ("Based on ..."), with the
 *  provenance pill under it (Lightfield pattern). `**phrase**` is drawn as <strong> (signalling: the few words that
 *  carry the answer); a screen reader reads it as ordinary text. */
export function Text({ body, source, ai }: Omit<z.infer<typeof TextT>, "type">) {
  return (
    <div className="sb-text">
      <p>{emSplit(body).map((t, i) => (i % 2 ? <strong key={i} className="sb-em">{t}</strong> : t))}</p>
      {source && <SourcePill source={source} lead={ai ? "Based on" : "From"} />}
    </div>
  );
}
