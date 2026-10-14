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

/** Deletes the call, its transcript and, when no other call is on it, its deal. Asks once, then goes to /live. */
export function DeleteCall({ id }: { id: string }) {
  const [asking, setAsking] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  if (!asking) return <button type="button" className="btn-line lv-danger" onClick={() => setAsking(true)}>Delete call</button>;
  return (
    <span className="lv-end" role="group" aria-label="Confirm delete">
      <span>Delete this call and its transcript? This cannot be undone.</span>
      <button type="button" className="btn-line lv-danger" disabled={busy} autoFocus onClick={async () => {
        setBusy(true); setErr(null);
        const r = await fetch(`/api/live/meetings/${id}`, { method: "DELETE" });
        if (!r.ok) { setBusy(false); setErr((await r.json().catch(() => ({}))).error ?? "That did not work. Try again."); return; }
        router.push("/live");
        router.refresh();
      }}>{busy ? "Deleting…" : "Delete"}</button>
      <button type="button" className="btn-line" disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
      {err && <span className="lv-err" role="alert">{err}</span>}
    </span>
  );
}

type Caller = { company: string; contact_name: string; contact_title: string; contact_email: string };
const FIELDS: [keyof Caller, string, string][] = [["company", "Company", "organization"], ["contact_name", "Contact", "name"],
  ["contact_title", "Title", "organization-title"], ["contact_email", "Email", "email"]];

/** Sets who the call was with (PATCH): the company puts it on that deal, created when the rep has none. */
export function EditCaller({ id, deal }: { id: string; deal: Caller | null }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  if (!open) return <button type="button" className="btn-line" onClick={() => setOpen(true)}>{deal ? "Edit company & contact" : "Add company & contact"}</button>;
  return (
    <form className="lv-edit" aria-label="Who the call was with" onSubmit={async e => {
      e.preventDefault();
      const body = Object.fromEntries([...new FormData(e.currentTarget)].map(([k, v]) => [k, String(v).trim()]));
      if (!body.company) { setErr("The company is needed."); return; }
      setBusy(true); setErr(null);
      const r = await fetch(`/api/live/meetings/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setBusy(false);
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "That did not work. Try again."); return; }
      setOpen(false);
      router.refresh();
    }}>
      {FIELDS.map(([k, label, auto]) => (
        <input key={k} name={k} aria-label={label} placeholder={label} autoComplete={auto} defaultValue={deal?.[k] ?? ""}
          required={k === "company"} type={k === "contact_email" ? "email" : "text"} autoFocus={k === "company"} />
      ))}
      <button type="submit" className="btn-line" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      <button type="button" className="btn-line" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      {err && <span className="lv-err" role="alert">{err}</span>}
    </form>
  );
}
