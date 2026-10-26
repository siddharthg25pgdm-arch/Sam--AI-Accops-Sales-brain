"use client";
import type { z } from "zod";
import type { DocCard as DocCardT } from "@/lib/blocks";
import { ICON, Icon, useAct } from "./parts";

/** A public page or PDF. The whole card is the link; with a thumb it is a 16:10 preview card, without one a
 *  compact row with a kind tile (Navan pattern). */
export function DocCard({ title, kind, summary, meta, url, action, thumb }: Omit<z.infer<typeof DocCardT>, "type">) {
  const act = useAct();
  const dl = action === "download";
  return (
    <a className={`sb-doc${thumb ? " sb-doc-thumb" : ""}`} href={url} target="_blank" rel="noopener noreferrer"
      onClick={() => act("event", { name: "doc_opened", url }, title)}>
      {thumb ? (
        <span className="sb-doc-img"><img src={thumb} alt="" loading="lazy" decoding="async" width="320" height="200" /></span>
      ) : (
        <span className="sb-doc-tile" aria-hidden="true"><Icon d={dl ? ICON.doc : ICON.page} /></span>
      )}
      <span className="sb-doc-body">
        <span className="sb-eyebrow">{kind}</span>
        <span className="sb-doc-title">{title}</span>
        {summary && <span className="sb-doc-sum">{summary}</span>}
        <span className="sb-doc-foot">
          {meta && <span className="sb-doc-meta">{meta}</span>}
          <span className="sb-doc-act">
            {dl ? "Download PDF" : "Read"}<Icon d={dl ? ICON.down : ICON.arrow} />
          </span>
        </span>
      </span>
      <span className="sb-sr"> (opens in a new tab)</span>
    </a>
  );
}
