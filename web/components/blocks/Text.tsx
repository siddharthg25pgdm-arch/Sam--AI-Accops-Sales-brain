"use client";
import type { z } from "zod";
import type { Text as TextT } from "@/lib/blocks";
import { SourcePill } from "./parts";

/** A verbatim bank answer or page quote, with the provenance pill under it (Lightfield pattern). */
export function Text({ body, source }: Omit<z.infer<typeof TextT>, "type">) {
  return (
    <div className="sb-text">
      <p>{body}</p>
      {source && <SourcePill source={source} />}
    </div>
  );
}
