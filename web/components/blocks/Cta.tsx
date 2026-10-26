"use client";
import type { z } from "zod";
import type { Cta as CtaT } from "@/lib/blocks";
import { ICON, Icon, useAct } from "./parts";

/** The one orange thing in an answer. A real link (works with no host), handed to the host when there is one so
 *  the loader can scroll to #talk or open the demo page and log talk_to_sales_clicked. */
export function Cta({ label, action, url, sub }: Omit<z.infer<typeof CtaT>, "type">) {
  const act = useAct();
  return (
    <div className="sb-cta">
      <a className="sb-cta-btn" href={url} target="_blank" rel="noopener noreferrer"
        onClick={e => { if (act("cta", { action, url }, label)) e.preventDefault(); }}>
        {label}<Icon d={ICON.arrow} />
      </a>
      {sub && <p>{sub}</p>}
    </div>
  );
}
