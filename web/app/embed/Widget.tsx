"use client";
// The website chat panel inside the /embed iframe (plan 7.2, 7.5 layout). Answers are drawn DIRECTLY:
// answer.blocks.map -> C's block components (Siddharth, 26 Oct: no OpenUI <Renderer> on the client; library.tsx +
// toOpenUI stay untouched so it can be switched back). Only types come from lib/blocks: the server already validated
// every answer with Answer.parse, so no zod ships to the browser.
import { useCallback, useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type Ref } from "react";
import type { Answer as AnswerT, Block, Chip } from "@/lib/blocks";
import { Answer, Thinking } from "@/components/blocks/Answer";
import { Calculator } from "@/components/blocks/Calculator";
import { CompareTable } from "@/components/blocks/CompareTable";
import { Cta } from "@/components/blocks/Cta";
import { DocCard } from "@/components/blocks/DocCard";
import { ActCtx, ICON, Icon, reducedMotion, type Act } from "@/components/blocks/parts";
import { Picker } from "@/components/blocks/Picker";
import { Stat } from "@/components/blocks/Stat";
import { Steps } from "@/components/blocks/Steps";
import { Text } from "@/components/blocks/Text";
import { emSplit } from "@/lib/emphasis";
import { acceptInit, eventMessage, ID, opensBooking, SEC, type WidgetEvent } from "./bridge";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BLOCK: Record<Block["type"], ComponentType<any>> = { text: Text, doc_card: DocCard, compare_table: CompareTable, steps: Steps, stat: Stat, picker: Picker, calculator: Calculator, cta: Cta };
const MAX = 500, KEY = "acc_chat_v1", HS_REUSE_MS = 100 * 60_000; // hs lives 2 h (bot.ts); reuse a stored one for 100 min
const FAIL = "That didn't go through. Try again in a moment, or talk to the team.";

export type Props = {
  conversationId: string; hs: string; page: string; starters: Chip[]; origins: string[];
  talk: { label: string; url: string }; ask?: string | null;
  /** The Bookings calendar (bridge.ts bookingUrl): talk-to-sales opens it inside the panel. "" = a new tab, as before. */
  booking?: string;
  /** Welcome-back memory (27 Oct): the loader's device id (a UUID), whether it lasts 90 days on this device (false = this
   *  visit only: EU/EEA/UK/CH), and for a returning device the server's greeting (approved labels / public titles only). */
  visitor?: string; persist?: boolean; welcome?: { line: string; chips: Chip[] } | null;
};
type Item = { id: number; me: string } | { id: number; a: AnswerT; source: string; qa?: string };
type Saved = { c: string; hs: string; at: number; page: string; items: Item[]; recent: number[] };

/** Every Text and Stat must show where it came from (Siddharth, 26 Oct): a Text without a source is not drawn
 *  (a Stat cannot exist without one: the contract requires it). */
export const visible = (blocks: Block[]) => blocks.filter(b => b.type !== "text" || !!b.source);

/** One answer, drawn directly: C's Answer root (lead, 40 ms stagger, chips) around the block components. */
export function AnswerView({ a }: { a: AnswerT }) {
  return <Answer lead={a.lead} chips={a.chips ?? []}
    blocks={visible(a.blocks).map((b, i) => { const { type, ...p } = b; const C = BLOCK[type]; return C ? <C key={i} {...p} /> : null; })} />;
}

const ARROW_L = "M10 3.5L5.5 8l4.5 4.5", EXT = "M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5L7.5 8.5";
/** The calendar inside the panel (Siddharth, 27 Oct): the whole sheet (on a phone the loader's frame is already full
 *  screen), a way back to the chat, a way out to a new tab. Mounted on first open and kept, so going back to check an
 *  answer never loses a half-filled booking. Only BOOKING_ORIGIN can load (next.config.ts frame-src). */
export function BookingView({ url, title, on, onBack, onClose, backRef }: { url: string; title: string; on: boolean;
  onBack: () => void; onClose: () => void; backRef?: Ref<HTMLButtonElement> }) {
  return (
    <section className={`w-book${on ? " on" : ""}`} aria-label={title}>
      <header className="w-head w-book-head">
        <button type="button" ref={backRef} className="w-back" onClick={onBack} aria-label="Back to the chat">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={ARROW_L} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>Back
        </button>
        <div className="w-head-t"><h1>{title}</h1><p>Pick a time that suits you</p></div>
        <a className="w-x" href={url} target="_blank" rel="noopener noreferrer" aria-label="Open the calendar in a new tab">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={EXT} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </a>
        <button type="button" className="w-x" onClick={onClose} aria-label="Close chat">
          <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        </button>
      </header>
      <div className="w-book-frame">
        <p className="w-book-wait" aria-hidden="true">Loading the calendar…</p>
        <iframe src={url} title={`${title}: booking calendar`} referrerPolicy="strict-origin-when-cross-origin" />
      </div>
    </section>
  );
}

const rid = () => crypto.randomUUID(); // only when the loader gave none (the /embed URL's vid, or the init message)
const load = (): Saved | null => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { return null; } };

export default function Widget({ conversationId, hs: hs0, page, starters: starters0, origins, talk, ask: askFirst, booking = "",
  visitor = "", persist = false, welcome = null }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [starters, setStarters] = useState(starters0);
  const [near, setNear] = useState<Chip[]>([]); // the section's questions when the chat is reopened elsewhere mid-conversation
  const [busy, setBusy] = useState<false | "click" | "typed">(false);
  const [slow, setSlow] = useState(false);
  const [text, setText] = useState("");
  const [view, setView] = useState<"chat" | "booking" | "back">("chat"); // "back" = the chat, returned to from the calendar
  const [booked, setBooked] = useState(false); // the calendar was opened once (its iframe then stays)
  const backBtn = useRef<HTMLButtonElement>(null);
  const s = useRef({ c: conversationId, hs: hs0, at: Date.now(), recent: [] as number[], renderAt: 0, n: 0,
    parent: null as string | null, visitor, prev: "", asked: [] as string[] });
  const thread = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastMe = useRef<HTMLDivElement>(null);

  const save = (next: Item[]) => {
    const x = s.current;
    try { sessionStorage.setItem(KEY, JSON.stringify({ c: x.c, hs: x.hs, at: x.at, page, items: next.slice(-30), recent: x.recent } satisfies Saved)); } catch { /* private mode */ }
  };
  const push = (it: Omit<Item, "id">) => setItems(prev => { const next = [...prev, { ...it, id: ++s.current.n } as Item]; save(next); return next; });

  /** Analytics: the event route (with the conversation) + the parent's dataLayer (no text, see bridge.ts). */
  const track = useCallback((name: WidgetEvent, p: { qa_id?: string; source?: string; ref?: unknown } = {}) => {
    const x = s.current, m = eventMessage(name, p);
    if (!m) return;
    x.visitor ||= rid();
    if (x.parent && name !== "talk_to_sales_clicked") parent.postMessage(m, x.parent); // the loader logs CTA clicks from {t:"cta"}
    void fetch("/api/web/event", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: x.c, visitor_id: x.visitor, page, name, ...(m.qa_id ? { qa_id: m.qa_id } : {}), ...(m.ref ? { ref: m.ref } : {}) }) })
      .catch(() => undefined);
  }, [page]);

  const send = useCallback(async (turn: { kind: "click"; qa_id: string } | { kind: "typed"; text: string }, echo: string | null, qa?: string) => {
    const x = s.current, now = Date.now();
    if (busy) return;
    x.recent = [...x.recent, now].slice(-6); // includes this send: the CTA comes after the 2nd answer (contract notes)
    if (echo) push({ me: echo });
    setNear([]);
    setBusy(turn.kind);
    const body = { conversation_id: x.c, visitor_id: x.visitor || (x.visitor = rid()), page, hs: x.hs, parent: !!x.parent,
      ms_since_render: Math.max(0, now - x.renderAt), recent_ms: x.recent, ...(turn.kind === "typed" && x.prev ? { prev: x.prev.slice(0, 200) } : {}), turn };
    if (turn.kind === "typed") x.prev = turn.text;
    let a: AnswerT | null = null, source = "fallback";
    try {
      const r = await fetch("/api/web/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      const j = await r.json(); // a 429 still carries renderable fallback blocks
      if (Array.isArray(j?.blocks)) {
        qa ??= typeof j.qa_id === "string" && ID.test(j.qa_id) ? j.qa_id : undefined; // a typed question the bank answered
        if (qa) x.asked.push(qa);
        a = { lead: j.lead, blocks: j.blocks, chips: Array.isArray(j.chips) ? (j.chips as Chip[]).filter(c => !x.asked.includes(c.id)) : [] };
        source = String(j.source);
      }
    } catch { /* below */ }
    if (!a) a = { lead: FAIL, blocks: [{ type: "cta", label: talk.label, action: "talk_to_sales", url: talk.url }], chips: [] };
    else track("answer_shown", { qa_id: qa, source });
    push({ a, source, qa });
    setBusy(false);
  }, [busy, page, talk, track]);

  /** A tier-0 click: echo the label as the visitor's own bubble (Klook / WhatsApp pattern). */
  const askQa = useCallback((qa_id: string, label: string, source: string) => {
    if (!ID.test(qa_id) || busy) return;
    track("question_clicked", { qa_id, source });
    void send({ kind: "click", qa_id }, label, qa_id);
  }, [busy, send, track]);

  const cta = useCallback((url: string, action?: string) => {
    const x = s.current;
    if (opensBooking(booking, action)) { // the calendar in the panel: still a talk-to-sales click, plus booking_opened
      track("talk_to_sales_clicked", { ref: booking });
      if (x.parent) parent.postMessage({ t: "cta", url: booking }, x.parent); // the loader counts it; an https URL is never navigated
      track("booking_opened");
      setBooked(true);
      setView("booking");
      return true;
    }
    track("talk_to_sales_clicked", { ref: url });
    if (x.parent) parent.postMessage({ t: "cta", url }, x.parent);
    // An https link opens natively (new tab, survives popup blockers); a #anchor is the parent's to scroll to.
    return !!x.parent && url.startsWith("#");
  }, [booking, track]);

  const act: Act = (type, params, label) => {
    if (type === "ask") { askQa(String(params.qa_id), label, String(params.source ?? "chip")); return true; }
    if (type === "cta") return cta(String(params.url ?? ""), String(params.action ?? ""));
    if (type === "event") {
      const n = String(params.name);
      if (n === "doc_opened" || n === "filter_used" || n === "step_viewed")
        track(n, { ref: n === "doc_opened" ? params.url : n === "filter_used" ? params.filter : `step_${params.step}` });
    }
    return false;
  };

  // Mount: restore this tab's thread (same conversation while its hs is fresh), then the bridge handshake.
  useEffect(() => {
    const x = s.current, old = load();
    x.renderAt = Date.now();
    if (old && old.page === page && Date.now() - old.at < HS_REUSE_MS && old.items?.length) {
      Object.assign(x, { c: old.c, hs: old.hs, at: old.at, recent: old.recent ?? [], n: old.items.length + 1,
        asked: old.items.flatMap(i => ("qa" in i && i.qa ? [i.qa] : [])) });
      setItems(old.items);
    }
    /** The loader says the visitor reopened the chat on another section: that section's questions, never one already asked
     *  (the starters while the thread is empty, else a chip row above the input until the next question). */
    const reSection = async (sec: string) => {
      try {
        const c = await (await fetch(`/api/web/config?page=${encodeURIComponent(page)}&section=${sec}`)).json();
        const l = [c?.teaser && { id: c.teaser.qa_id, label: c.teaser.label }, ...(Array.isArray(c?.chips) ? c.chips : [])]
          .filter((r): r is Chip => !!r && typeof r.id === "string" && ID.test(r.id) && typeof r.label === "string");
        if (!l.length) return;
        setStarters(l);
        if (x.n) setNear(l.filter(c => !x.asked.includes(c.id)).slice(0, 3));
      } catch { /* keep what is shown */ }
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== parent || parent === window) return;
      if (x.parent) {
        if (e.origin !== x.parent) return;
        if (e.data?.t === "focus" && !matchMedia("(pointer: coarse)").matches) input.current?.focus();
        else if (e.data?.t === "sec" && typeof e.data.sec === "string" && SEC.test(e.data.sec)) void reSection(e.data.sec);
        return;
      }
      const init = acceptInit(e, origins, parent);
      if (init) {
        x.parent = init.origin;
        if (init.visitor_id) x.visitor = init.visitor_id;
        if (!matchMedia("(pointer: coarse)").matches) input.current?.focus({ preventScroll: true }); // keyboard users land in the box; phones keep the keyboard down
      }
    };
    addEventListener("message", onMsg);
    // Ask each allowed origin; postMessage silently drops all but the one actually framing us. Never "*".
    if (parent !== window) for (const o of origins) parent.postMessage({ t: "ready" }, o);
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape" && x.parent) parent.postMessage({ t: "close" }, x.parent); };
    addEventListener("keydown", esc);
    // The teaser's or a ?q= question: asked once the handshake had its chance (and never inside the 300 ms click rule).
    let t: ReturnType<typeof setTimeout> | undefined;
    if (askFirst && ID.test(askFirst) && !(old?.items?.length && old.page === page)) {
      const label = starters0.find(r => r.id === askFirst)?.label ?? null;
      const t0 = Date.now();
      const go = () => (x.parent || Date.now() - t0 > 1500 ? askQa(askFirst, label ?? "", "teaser") : (t = setTimeout(go, 100)));
      t = setTimeout(go, 400);
    }
    return () => { removeEventListener("message", onMsg); removeEventListener("keydown", esc); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bank and intent answers come back in tens of ms: only a slow reply earns the thinking state (dots, then skeleton).
  useEffect(() => {
    if (!busy) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), busy === "typed" ? 250 : 400);
    return () => clearTimeout(t);
  }, [busy]);

  // Keep the visitor's newest question at the top of the view (when it is sent, while it thinks, when the answer
  // lands), so a long answer reads from its start. Scrolls the thread only, never the host page.
  useEffect(() => {
    const b = thread.current, m = lastMe.current;
    if (!b || !m) return;
    const r = requestAnimationFrame(() => b.scrollTo({ top: m.offsetTop - 12, behavior: reducedMotion() ? "auto" : "smooth" }));
    return () => cancelAnimationFrame(r);
  }, [items.length, slow]);

  // Into the calendar: focus its Back button. Out of it: back to the input (not on a phone: no surprise keyboard).
  useEffect(() => {
    if (view === "booking") backBtn.current?.focus();
    else if (view === "back" && !matchMedia("(pointer: coarse)").matches) input.current?.focus({ preventScroll: true });
  }, [view]);

  const submit = () => {
    const q = text.trim();
    if (!q || q.length > MAX || busy) return;
    setText("");
    void send({ kind: "typed", text: q }, q);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };
  const close = () => { if (s.current.parent) parent.postMessage({ t: "close" }, s.current.parent); };
  const lastMeId = [...items].reverse().find(i => "me" in i)?.id;
  // a returning device: the greeting's own offers first, then the page's (or the section's) questions
  const offer = welcome ? [...welcome.chips, ...starters].filter((c, i, a) => a.findIndex(x => x.id === c.id) === i) : starters;
  const inBooking = view === "booking"; // the chat stays laid out underneath (its scroll is kept) but inert

  return (
    <ActCtx.Provider value={act}>
      <div className="sam-w">
        <header className="w-head" inert={inBooking}>
          <span className="w-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 18.5V8a3 3 0 013-3h8a3 3 0 013 3v5a3 3 0 01-3 3H9z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M9.5 10.5h5M9.5 13h3" stroke="#ff9a76" strokeWidth="1.7" strokeLinecap="round" /></svg>
          </span>
          <div className="w-head-t">
            <h1>Ask Accops</h1>
            <p>Answers from accops.com</p>
          </div>
          <button type="button" className="w-x" onClick={close} aria-label="Close chat">
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
          </button>
        </header>

        <div className="w-body" ref={thread} role="log" aria-live="polite" aria-label="Conversation" inert={inBooking}>
          {items.length === 0 && (
            <div className="w-hello sb-in">
              <p className="w-hello-t">{welcome // "Welcome back! Last time you looked at **…**": its **emphasis** as in a Text block
                ? emSplit(welcome.line).map((t, i) => (i % 2 ? <strong key={i} className="sb-em">{t}</strong> : t)) : "What would you like to know?"}</p>
              <p className="w-hello-s">Every answer links to its source on accops.com.</p>
              {offer.length > 0 && (
                <>
                  <p className="w-eyebrow" id="w-roots">{welcome ? "Pick up where you left off" : "Asked on this page"}</p>
                  <ul className="w-roots" aria-labelledby="w-roots">
                    {offer.slice(0, 4).map(r => ( // the thread is empty here, so nothing was asked yet
                      <li key={r.id}>
                        <button type="button" onClick={() => askQa(r.id, r.label, "root")} disabled={!!busy}>
                          <span className="w-glyph" aria-hidden="true">↳</span><span>{r.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <a className="w-human" href={talk.url} target="_blank" rel="noopener noreferrer"
                onClick={e => { if (cta(talk.url)) e.preventDefault(); }}>
                <span>Prefer a person?</span> {talk.label}<Icon d={ICON.arrow} />
              </a>
            </div>
          )}
          {items.map(it => "me" in it ? (
            it.me ? <div key={it.id} className="w-me" ref={it.id === lastMeId ? lastMe : undefined}><p>{it.me}</p></div> : null
          ) : (
            <div key={it.id} className="w-bot">
              <AnswerView a={it.a} />
            </div>
          ))}
          {busy && slow && <div className="w-bot"><Thinking /></div>}
        </div>

        <footer className="w-foot" inert={inBooking}>
          {items.length > 0 && near.length > 0 && !busy && (
            <ul className="sb-chips w-near" aria-label="Asked about this part of the page">
              {near.map(c => <li key={c.id}><button type="button" className="sb-chip" onClick={() => askQa(c.id, c.label, "chip")}>{c.label}</button></li>)}
            </ul>
          )}
          <p className="w-privacy">Please don&rsquo;t share personal details. Conversations are stored to improve answers, and the topics
            you view are remembered on this device {persist ? "for 90 days" : "for this visit"}.{" "}
            <a href="https://www.accops.com/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy</a></p>
          <form className="w-input" onSubmit={e => { e.preventDefault(); submit(); }}>
            <label htmlFor="w-q" className="sb-sr">Your question</label>
            <textarea id="w-q" ref={input} rows={1} value={text} maxLength={MAX} placeholder="Ask a question"
              onChange={e => setText(e.target.value)} onKeyDown={onKey} enterKeyHint="send" autoComplete="off" />
            {text.length > MAX - 100 && <span className="w-count" aria-live="polite">{text.length}/{MAX}</span>}
            <button type="submit" className="w-send" aria-label="Send" disabled={!text.trim() || !!busy}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </form>
        </footer>
        {booked && booking && <BookingView url={booking} title={talk.label} on={inBooking} backRef={backBtn} onBack={() => setView("back")} onClose={close} />}
      </div>
    </ActCtx.Provider>
  );
}

