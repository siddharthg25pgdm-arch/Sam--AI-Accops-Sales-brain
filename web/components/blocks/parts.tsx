"use client";
// Shared bits for the answer blocks: the action bridge, the provenance pill and the few icons.
import { createContext, useContext, type ReactNode } from "react";
import type { z } from "zod";
import type { Source } from "@/lib/blocks";

/** What a block asks the host to do. "ask" = ask an approved qa_id (picker, chips); "cta" = talk to sales / open a URL;
 *  "event" = analytics only (doc_opened, filter_used, step_viewed). Returns true when the host handled it (the
 *  block then skips its own default, e.g. the CTA link's navigation). No typed text ever travels through here. */
export type ActType = "ask" | "cta" | "event";
export type Act = (type: ActType, params: Record<string, unknown>, label: string) => boolean;
export const ActCtx = createContext<Act>(() => false);
export const useAct = () => useContext(ActCtx);

export function SourcePill({ source }: { source: z.infer<typeof Source> }) {
  return (
    <a className="sb-src" href={source.url} target="_blank" rel="noopener noreferrer" title={source.url}>
      <Icon d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1" />
      <span>From {source.label}</span>
      <span className="sb-sr"> (opens in a new tab)</span>
    </a>
  );
}

/** 16px stroke icon; decorative unless a label is passed. */
export function Icon({ d, label, className }: { d: string; label?: string; className?: string }): ReactNode {
  return (
    <svg className={`sb-ic ${className ?? ""}`} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined} aria-label={label}>
      <path d={d} />
    </svg>
  );
}

export const ICON = {
  check: "M3.5 8.5l3 3 6-7",
  arrow: "M3.5 8h9M8.5 4l4 4-4 4",
  down: "M8 3v9M4 8l4 4 4-4",
  chevron: "M6 4l4 4-4 4",
  caution: "M8 5v3.5M8 11h.01M8 1.8l6.5 11.4H1.5z",
  doc: "M4 1.5h5l3 3v10H4zM9 1.5v3h3M6 8h4M6 10.5h4",
  page: "M2 3.5h12v9H2zM2 6h12",
  info: "M8 7v4.5M8 4.5h.01M8 1.5a6.5 6.5 0 110 13 6.5 6.5 0 010-13z",
} as const;

export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
