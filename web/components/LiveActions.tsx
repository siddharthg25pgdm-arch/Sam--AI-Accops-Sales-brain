"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Copies `text` and says so for two seconds. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn-line" aria-live="polite" onClick={async () => {
      await navigator.clipboard.writeText(text);
      setDone(true); setTimeout(() => setDone(false), 2000);
    }}>{done ? "Copied" : label}</button>
  );
}

/** For a call still marked live (the desktop app closed before End): summarise it from the saved transcript. */
export function EndCall({ id }: { id: string }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="lv-end">
      <button type="button" className="btn-accent" disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        const r = await fetch(`/api/live/meetings/${id}/end`, { method: "POST" });
        const j = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok) { setErr(j.error ?? "That did not work. Try again in a minute."); return; }
        router.refresh();
      }}>{busy ? "Summarising…" : "End & summarise"}</button>
      {err && <span className="lv-err" role="alert">{err}</span>}
    </span>
  );
}
