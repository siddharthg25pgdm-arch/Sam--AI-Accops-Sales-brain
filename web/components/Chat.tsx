"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatTurn, ChatAsset } from "@/lib/types";

const STARTERS = ["Bank replacing Citrix, need a proof point", "ZTNA whitepaper for pharma", "Do we have a manufacturing MFA case study?", "Something I can send to a government CIO"];

export function Chat({ hasModel, onBrowse }: { hasModel: boolean; onBrowse: (f: { vertical?: string; type?: string; product?: string }) => void }) {
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
      setTurns(t => [...t, { role: "assistant", content: j.text, assets: j.assets, trace: j.trace, eventId: j.eventId, runtime: j.runtime, zero: j.zero, filters: j.filters }]);
    } catch (e) {
      setTurns(t => [...t, { role: "assistant", content: `SAM couldn't answer: ${(e as Error).message}. Try again, or browse the catalogue.`, assets: [] }]);
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="thread">
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
  async function feedback(v: "helpful" | "wrong_asset" | "missing") {
    setFb(v);
    await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: turn.eventId, feedback: v }) });
  }
  const f = turn.filters;
  return (
    <div className="msg sam">
      <p className="verdict">{turn.content}</p>
      {turn.assets?.map(a => <ResultCard key={a.path ?? a.title} a={a} />)}
      {turn.zero && <div style={{ marginTop: 8 }}><span className="tag gap">Logged as a content gap</span> <button className="chip" style={{ marginLeft: 6 }} onClick={() => onBrowse({ vertical: f?.vertical })}>Browse nearest in catalogue</button></div>}
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

function ResultCard({ a }: { a: ChatAsset }) {
  const type = a.asset_type.toLowerCase().includes("case") ? "Case Study" : a.asset_type.toLowerCase().includes("white") ? "Whitepaper" : "Other";
  function opened() { fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: a.path, source: "chat" }) }); }
  return (
    <div className="result" data-type={type}>
      <div className="spine" aria-hidden="true" />
      <div className="body">
        <b>{a.title}</b>
        <small>{a.asset_type}{a.industry ? ` · ${a.industry}` : ""}{a.year ? ` · ${a.year}` : ""}</small>
        <div className="why">{a.why}</div>
      </div>
      <div className="side">
        <span className={`tag ${a.visibility === "public" ? "public" : "internal"}`}>{a.visibility === "public" ? "Public link" : "Internal only"}</span>
        {a.stale && <span className="tag stale">Older than 2 years</span>}
        <a className="open" href={a.link ?? "#"} target="_blank" rel="noreferrer" aria-disabled={!a.link} onClick={opened}>Open</a>
      </div>
    </div>
  );
}
