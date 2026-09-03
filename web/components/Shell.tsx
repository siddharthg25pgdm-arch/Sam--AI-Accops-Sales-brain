"use client";
import { useState } from "react";
import type { SlimAsset, Facets, Gap } from "@/lib/types";
import { Chat } from "./Chat";
import { Catalogue } from "./Catalogue";

export function Shell({ assets, facets, gaps, hasModel }: { assets: SlimAsset[]; facets: Facets; gaps: Gap[]; hasModel: boolean }) {
  const [view, setView] = useState<"chat" | "catalogue">("chat");
  const [prefill, setPrefill] = useState<{ vertical?: string; type?: string; product?: string } | null>(null);
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Section">
        <button role="tab" aria-pressed={view === "chat"} onClick={() => setView("chat")}>Ask SAM</button>
        <button role="tab" aria-pressed={view === "catalogue"} onClick={() => setView("catalogue")}>Catalogue</button>
      </div>
      <main className="shell" data-view={view}>
        <section className="pane-chat" aria-label="Ask SAM">
          <Chat hasModel={hasModel} onBrowse={(f) => { setPrefill(f); setView("catalogue"); }} />
        </section>
        <section className="pane-cat" aria-label="Catalogue">
          <Catalogue assets={assets} facets={facets} gaps={gaps} prefill={prefill} />
        </section>
      </main>
    </>
  );
}
