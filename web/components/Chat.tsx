"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatTurn, ChatAsset, Delivery } from "@/lib/types";

const STARTERS = ["Bank replacing Citrix, need a proof point", "ZTNA whitepaper for pharma", "Do we have a manufacturing MFA case study?", "Something I can send to a government CIO"];

export function Chat({ hasModel, onBrowse, deliveries = [] }: { hasModel: boolean; onBrowse: (f: { vertical?: string; type?: string; product?: string }) => void; deliveries?: Delivery[] }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [q, setQ] = useState(""); const [busy, setBusy] = useState(false);
  const [sessionId] = useState(() => Math.random().toString(36).slice(2, 12));
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns, busy]);

  async function send(text: string) {
    const question = text.trim(); if (!question || busy) return;
    setQ(""); setBusy(true);
    const history = turns.map(t => ({ role: t.role, content: t.content }));
    setTurns(t => [...t, { role: "user", content: question }]);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, history, sessionId }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Request failed");
      setTurns(t => [...t, { role: "assistant", content: j.text, assets: j.assets, trace: j.trace, eventId: j.eventId, runtime: j.runtime, zero: j.zero, filters: j.filters, missing: j.missing, question, requestTitle: j.requestTitle }]);
    } catch (e) {
      setTurns(t => [...t, { role: "assistant", content: `SAM couldn't answer: ${(e as Error).message}. Try again, or browse the catalogue.`, assets: [] }]);
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="thread">
        <Delivered items={deliveries} />
        {turns.length === 0 && (
          <div className="hello">
            <h1>What do you need?</h1>
            <p>Ask the way you would ask a colleague: industry, product, competitor, who it is for. SAM answers from the Sales and Marketing libraries only.</p>
            <div className="starters">{STARTERS.map(s => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>
            {!hasModel && <p style={{ marginTop: 14, fontSize: 13 }}>Retrieval-only mode: no model key is set on the server, so answers are ranked matches without reasoning.</p>}
          </div>
        )}
        {turns.map((t, i) => t.role === "user"
          ? <div key={i} className="msg user">{t.content}</div>
          : <Answer key={i} turn={t} onBrowse={onBrowse} />)}
        {busy && <div className="msg sam"><span className="typing" aria-label="SAM is searching"><i /><i /><i /></span></div>}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <form onSubmit={e => { e.preventDefault(); send(q); }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ask SAM for collateral…" aria-label="Ask SAM" disabled={busy} />
          <button type="submit" disabled={busy || !q.trim()}>Ask</button>
        </form>
      </div>
    </>
  );
}

function Answer({ turn, onBrowse }: { turn: ChatTurn; onBrowse: (f: { vertical?: string; type?: string; product?: string }) => void }) {
  const [fb, setFb] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  async function feedback(v: "helpful" | "wrong_asset" | "missing") {
    setFb(v);
    // "What I need doesn't exist" is exactly the moment to ask marketing for it.
    if (v === "missing") setAsking(true);
    await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: turn.eventId, feedback: v }) });
  }
  const f = turn.filters;
  return (
    <div className="msg sam">
      <p className="verdict">{turn.content}</p>
      {turn.assets?.map(a => <ResultCard key={a.path ?? a.title} a={a} eventId={turn.eventId} />)}
      {turn.eventId !== undefined && <RequestBox turn={turn} open={asking} onOpen={() => setAsking(true)} onClose={() => setAsking(false)}
        onBrowse={() => onBrowse({ vertical: f?.vertical })} />}
      {turn.eventId !== undefined && (
        <div className="feedback">
          <span>Did this help?</span>
          <button aria-pressed={fb === "helpful"} onClick={() => feedback("helpful")}>Yes</button>
          <button aria-pressed={fb === "wrong_asset"} onClick={() => feedback("wrong_asset")}>Wrong asset</button>
          <button aria-pressed={fb === "missing"} onClick={() => feedback("missing")}>What I need doesn't exist</button>
        </div>
      )}
      {turn.trace && turn.trace.length > 0 && (
        <details className="trace"><summary>How SAM got there ({turn.trace.length} steps{turn.runtime === "local" ? ", no model" : ""})</summary>
          {turn.trace.map((s, i) => <div key={i}><b>{s.step}</b> {s.detail}</div>)}
        </details>
      )}
    </div>
  );
}

const Check = () => (
  <svg className="tick" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" /><path d="M5.8 10.4l2.7 2.7 5.7-6" /></svg>
);

type Filed = { ok: true; title: string; message: string } | { ok: false; error: string };

/** "Ask marketing to create this": inline, prefilled from the question, no modal. Offered on every
 *  answer where the exact thing is missing, and opened by "What I need doesn't exist" on any other. */
function RequestBox({ turn, open, onOpen, onClose, onBrowse }: { turn: ChatTurn; open: boolean; onOpen: () => void; onClose: () => void; onBrowse: () => void }) {
  const [title, setTitle] = useState(turn.requestTitle || turn.question || "");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<Extract<Filed, { ok: true }> | null>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (filed) doneRef.current?.focus(); }, [filed]);
  const missing = turn.missing || turn.zero;

  async function submit() {
    if (!title.trim() || sending) return;
    setSending(true); setError(null);
    try {
      const r = await fetch("/api/v1/request-content", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, note, question: turn.question, event_id: turn.eventId ?? undefined }) });
      const j = (await r.json().catch(() => ({ ok: false, error: "The server did not answer." }))) as Filed;
      if (j.ok) setFiled(j); else setError(j.error);
    } catch { setError("Could not reach SAM. Check your connection and try again."); }
    finally { setSending(false); }
  }

  if (filed) return (
    <div className="askmkt sent" role="status" tabIndex={-1} ref={doneRef}>
      <Check />
      <div>
        <b>Sent to marketing</b>
        <p>{filed.message}</p>
        <a href="/requests">See your requests</a>
      </div>
    </div>
  );

  if (open) return (
    <form className="askmkt form" aria-label="Ask marketing to create this"
      onSubmit={e => { e.preventDefault(); submit(); }}
      onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); onClose(); requestAnimationFrame(() => openerRef.current?.focus()); } }}>
      <label>
        <span>What should marketing create?</span>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} autoFocus required />
      </label>
      <label>
        <span>Note for marketing <i>optional</i></span>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Customer, deadline, why it matters"
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }} />
      </label>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row">
        <button type="submit" className="btn-primary" disabled={sending || !title.trim()}>{sending ? "Sending…" : "Send request"}</button>
        <button type="button" className="btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );

  if (!missing) return null;
  return (
    <div className="askmkt">
      <p><b>Not in the library yet.</b> Need exactly this? Marketing can create it.</p>
      <div className="row">
        <button ref={openerRef} type="button" className="btn-primary" onClick={onOpen}>Ask marketing to create this</button>
        <button type="button" className="btn-quiet" onClick={onBrowse}>Browse the catalogue</button>
      </div>
    </div>
  );
}

/** Requests marketing delivered since the rep last looked. Quiet: one line each, dismissible. */
function Delivered({ items }: { items: Delivery[] }) {
  const [shown, setShown] = useState(items);
  if (!shown.length) return null;
  function dismiss(ids: number[]) {
    setShown(s => s.filter(x => !ids.includes(x.voteId)));
    fetch("/api/requests/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
  }
  return (
    <div className="delivered" role="status" aria-label="Delivered requests">
      {shown.map(d => (
        <div key={d.voteId} className="dl">
          <Check />
          <div className="dl-body">
            <b>Ready: {d.deliveredTitle}</b>
            <span>Marketing made what you asked for{d.title !== d.deliveredTitle ? `: ${d.title}` : ""}.</span>
          </div>
          <a className="open" href={d.url} target="_blank" rel="noreferrer" onClick={() => dismiss([d.voteId])}>Open</a>
          <button type="button" className="btn-quiet" aria-label={`Dismiss ${d.deliveredTitle}`} onClick={() => dismiss([d.voteId])}>Dismiss</button>
        </div>
      ))}
    </div>
  );
}

/** The asset's trust warning (EXPIRED, a newer edition, age), shown on the card itself so a rep sees it
 *  whether or not the model repeated it. Red for EXPIRED, amber otherwise. Renders nothing when null. */
export function TrustNote({ note }: { note?: string | null }) {
  if (!note) return null;
  const hard = /^EXPIRED/.test(note);
  return (
    <div role="note" style={{ marginTop: 6, padding: "4px 8px", borderRadius: 6, fontSize: 12.5, lineHeight: 1.35,
      color: hard ? "var(--red)" : "var(--amber)", background: hard ? "var(--red-soft)" : "var(--amber-soft)" }}>
      {/* An EXPIRED note already says "do not send"; only the softer ones get a label. */}
      {!hard && <b style={{ display: "inline", fontSize: "inherit" }}>Check first: </b>}{note}
    </div>
  );
}

function ResultCard({ a, eventId }: { a: ChatAsset; eventId?: number | null }) {
  const type = a.asset_type.toLowerCase().includes("case") ? "Case Study" : a.asset_type.toLowerCase().includes("white") ? "Whitepaper" : "Other";
  function opened() { fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: a.path, source: "chat", eventId }) }); }
  return (
    <div className="result" data-type={type}>
      <div className="spine" aria-hidden="true" />
      <div className="body">
        <b>{a.title}</b>
        <small>{a.asset_type}{a.industry ? ` · ${a.industry}` : ""}{a.year ? ` · ${a.year}` : ""}</small>
        <div className="why">{a.why}</div>
        <TrustNote note={a.trust} />
      </div>
      <div className="side">
        <span className={`tag ${a.visibility === "public" ? "public" : "internal"}`}>{a.visibility === "public" ? "Public link" : "Internal only"}</span>
        {a.stale && !a.trust && <span className="tag stale">Older than 2 years</span>}
        {a.link ? <a className="open" href={a.link} target="_blank" rel="noreferrer" onClick={opened}>Open</a> : <span className="where" title={a.location ?? undefined}>{a.location ? `In SharePoint: ${a.location}` : "Search SharePoint by title"}</span>}
      </div>
    </div>
  );
}
