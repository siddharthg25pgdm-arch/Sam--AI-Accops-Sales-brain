/** Stream D's acceptance that can run offline (plan 9 "Stream D"): node lib/web-widget.check.mjs (from web/).
 *  1. Loader size + build: public/embed.js is the build of scripts/embed.src.js (sha256 in line 1), <= 5 KB gzip,
 *     parses as a classic script, and never posts to "*".
 *  2. The loader in a fake DOM (fake clock, storage, fetch, postMessage), the real built file:
 *     kill switch; every teaser rule of plan 7.1; the iframe only on first interaction; the bridge ignores a foreign
 *     origin or window and answers only to the iframe's origin; dataLayer / beacons carry no text; #anchor CTA;
 *     the mobile scroll lock; the lift above a bottom bar; server strings only ever set as textContent; page-aware
 *     (27 Oct): the section most in view picks the teaser, goes to /embed as sec and to the widget on a reopen.
 *  3. The widget bridge (app/embed/bridge.ts): init only from an allowed parent; events strip anything but name/id/source/ref.
 *  4. frame-ancestors on /embed only (next.config.ts), from the same origin list the widget trusts.
 *  5. /embed (page.tsx): notFound while inert; when on, a handshake that verifyHs accepts, cleaned page + q + sec, the starters.
 *  6. Every fixture as the widget draws it: each Text / Stat / table / steps shows its source pill ("Based on" for the
 *     model's written answer); a Text without a source is not drawn; **emphasis** is drawn as <strong class="sb-em">
 *     (never raw asterisks), navy on its highlight band at AA contrast; 3-column tables carry data-col (blocks.css).
 *  Stage 3 (27 Oct): the Bookings calendar in the panel only with a valid booking_url and only for talk-to-sales CTAs,
 *  frame-src exactly https://bookings.cloud.microsoft, the Back button, booking_opened allowlisted end to end. */
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => readFileSync(path.join(web, f), "utf8");
let n = 0;
const ok = (v, m) => { n++; assert.ok(v, m); };
const eq = (a, b, m) => { n++; assert.deepStrictEqual(a, b, m); };

// ---------- 1. size + build ----------
const built = read("public/embed.js"), src = read("scripts/embed.src.js");
const { srcHash } = await import("../scripts/build-embed.mjs");
ok(built.split("\n")[0].includes(`sha256:${srcHash(src)}`), "public/embed.js is stale: run node scripts/build-embed.mjs");
const gz = gzipSync(built, { level: 9 }).length;
ok(gz <= 5120, `loader ${gz} B gzip > 5120`);
new vm.Script(built); n++; // a classic script (no import/export), parses
ok(!/postMessage\([^)]*,\s*["']\*["']/.test(src + built), "no postMessage to *");
ok(!/innerHTML\s*=(?![^;]*CSS[^;]*HTML)/.test(src), "innerHTML only ever takes the fixed template");

// ---------- 2. the loader in a fake DOM ----------
const BASE = "https://sam-accops.vercel.app", LP = "https://accops-citrix-lp.vercel.app";
class Store { constructor(o = {}) { this.m = { ...o }; } getItem(k) { return k in this.m ? this.m[k] : null; } setItem(k, v) { this.m[k] = String(v); } }

function boot({ width = 1280, consent = false, teaser = "15", avoid = null, pg = null, origin = LP, config = { enabled: true, teaser: { after_s: 15, qa_id: "lp-01", label: "Why did my Citrix renewal go up?" }, chips: [{ id: "lp-03", label: "Compare licensing" }, { id: "lp-05", label: "How does migration work?" }] },
  ss = new Store(), ls = new Store(), start = Date.UTC(2026, 9, 27), talk = false, avoidRect = null, sections = [] } = {}) {
  const t = { now: start, timers: new Map(), id: 0, posts: [], beacons: [], opened: [], fetches: [], ios: [], docL: {}, winL: {} };
  const on = (bag, k, f) => (bag[k] ||= []).push(f);
  class El {
    constructor(tag) { Object.assign(this, { tag, attrs: {}, children: [], L: {}, q: {}, className: "", hidden: false, textContent: "", type: "" });
      this.style = { setProperty: (k, v) => { this.style[k] = v; } }; }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "hidden") this.hidden = true; }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(k, f) { on(this.L, k, f); }
    fire(k, e = {}) { (this.L[k] || []).forEach(f => f(e)); }
    appendChild(c) { this.children.push(c); c.parentNode = this; if (c.tag === "iframe") c.contentWindow = { postMessage: (m, o) => t.posts.push([m, o]) }; return c; }
    attachShadow(o) { t.shadowMode = o.mode; return (this.shadow = new El("#shadow")); }
    querySelector(s) { return (this.q[s] ||= new El(`q:${s}`)); }
    focus() { doc.activeElement = this; }
    matches(s) { return s.split(",").includes(this.tag); }
    getBoundingClientRect() { return this.rect || { top: 0, height: 0 }; }
    scrollIntoView(o) { this.scrolled = o; }
    set textContent(v) { this.text = v; if (v === "") this.children = []; } // as the DOM: "" removes the children
    get textContent() { return this.text; }
    set innerHTML(v) { this.html = v; }
    get innerHTML() { return this.html; }
  }
  const script = new El("script");
  script.src = `${BASE}/embed.js`;
  if (teaser !== null) script.attrs["data-teaser"] = teaser;
  if (avoid) script.attrs["data-avoid"] = avoid;
  if (pg) script.attrs["data-page"] = pg;
  const talkEl = new El("section"), avoidEl = new El("div");
  avoidEl.rect = avoidRect;
  const body = new El("body"), html = new El("html");
  // sections: [{ id, rect: {top, bottom}, main }]: <main> sections (id or not) and id'd sections / headings elsewhere
  const secEls = sections.map(x => Object.assign(new El(x.main === false ? "h2" : "section"), x));
  const doc = { currentScript: script, readyState: "complete", visibilityState: "visible", body, documentElement: html, activeElement: body,
    createElement: tag => new El(tag), getElementById: id => (id === "talk" && talk ? talkEl : null),
    querySelectorAll: s => (s === "main section" ? secEls.filter(e => e.main !== false) : s === "main section,section[id],h2[id],h3[id]" ? secEls : []),
    querySelector: s => (s === avoid ? avoidEl : null), addEventListener: (k, f) => on(t.docL, k, f) };
  const timer = every => (fn, ms = 0) => { const id = ++t.id; t.timers.set(id, { at: t.now + ms, fn, every: every ? ms : 0 }); return id; };
  const win = {
    document: doc, location: { origin, pathname: "/", href: `${origin}/` }, innerWidth: width, innerHeight: 800, SAM_CONSENT: consent,
    sessionStorage: ss, localStorage: ls, crypto: globalThis.crypto, URL, Blob, Promise,
    navigator: { sendBeacon: (u, b) => { t.beacons.push([u, b]); return true; } },
    fetch: async u => { t.fetches.push(u); const c = typeof config === "function" ? config(u) : config; return c ? { ok: true, json: async () => c } : { ok: false, json: async () => ({}) }; },
    setTimeout: timer(false), setInterval: timer(true), clearTimeout: id => t.timers.delete(id), clearInterval: id => t.timers.delete(id),
    requestIdleCallback: f => win.setTimeout(f, 1), requestAnimationFrame: f => { f(); return 1; }, matchMedia: () => ({ matches: false }),
    IntersectionObserver: class { constructor(cb) { Object.assign(this, { cb, els: [] }); t.ios.push(this); } observe(el) { this.els.push(el); } },
    open: (...a) => t.opened.push(a), addEventListener: (k, f) => on(t.winL, k, f),
    Date: class extends Date { static now() { return t.now; } },
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(built, win);
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
  const advance = async ms => {
    const end = t.now + ms;
    for (;;) {
      const next = [...t.timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, x] = next;
      t.now = x.at;
      if (x.every) x.at += x.every; else t.timers.delete(id);
      x.fn();
      await flush();
    }
    t.now = end;
  };
  const host = () => body.children[0];
  const sh = s => host().shadow.querySelector(s);
  const fireWin = (k, e = {}) => (t.winL[k] || []).forEach(f => f(e));
  const fireDoc = (k, e = {}) => (t.docL[k] || []).forEach(f => f(e));
  const dl = () => JSON.parse(JSON.stringify(win.dataLayer || [])); // out of the vm realm, so deepStrictEqual compares values
  return { t, win, doc, body, html, talkEl, host, sh, advance, flush, fireWin, fireDoc, dl, ss, ls };
}

// kill switch: 503 or enabled:false draws nothing, ever
for (const config of [null, { enabled: false, teaser: null, chips: [] }]) {
  const b = boot({ config });
  await b.advance(5000);
  eq(b.body.children.length, 0, `kill switch: nothing drawn for ${JSON.stringify(config)}`);
}
// mounted: closed shadow root, launcher, no iframe yet, config asked for this page only (no query string)
{
  const b = boot();
  await b.advance(10);
  eq(b.body.children.length, 1, "host mounted");
  eq(b.t.shadowMode, "closed", "closed shadow root");
  eq(b.t.fetches, [`${BASE}/api/web/config?page=${encodeURIComponent(`${LP}/`)}`], "config fetched once, for origin + path");
  eq(b.sh(".f").children.length, 0, "no iframe before any interaction");
  await b.advance(60_000);
  eq(b.sh(".t").className, "", "no teaser without a scroll or pointer move"); // className is set only when it shows
  // a server string never goes through innerHTML
  ok(!b.host().shadow.html.includes("renewal"), "teaser label not in innerHTML");
}
// the teaser: 15 s of engaged, visible time; textContent only; chips; once a session
{
  const label = "<img src=x onerror=alert(1)> renewal";
  const ss = new Store();
  const b = boot({ ss, config: { enabled: true, teaser: { after_s: 15, qa_id: "lp-01", label }, chips: [{ id: "lp-03", label: "A" }, { id: "bad id!", label: "B" }, { id: "lp-05", label: "C" }] } });
  await b.advance(10);
  b.fireWin("scroll");
  await b.advance(14_500);
  eq(b.sh(".t").className, "", "not shown at 14.5 s");
  await b.advance(750);
  eq([b.sh(".t").className, b.sh(".t").hidden], ["t", false], "shown at 15 s (desktop card)");
  eq(b.sh(".tq span").textContent, label, "label set as textContent");
  ok(!b.host().shadow.html.includes("onerror"), "label never reaches innerHTML");
  eq(b.sh(".tc").children.map(c => [c.textContent, c.tag]), [["A", "button"], ["C", "button"]], "2 valid chips, as buttons");
  eq(b.dl().map(e => e.sam_event), ["popup_shown"], "popup_shown tracked");
  eq(b.ss.getItem("acc_chat_ts"), "1", "marked shown for the session");
  ok(b.doc.activeElement === b.body, "the teaser never takes focus");
  const again = boot({ ss });
  await again.advance(10);
  again.fireWin("scroll");
  await again.advance(60_000);
  eq(again.sh(".t").className, "", "once a session");
  // a chip opens the chat on that question
  b.sh(".tc").children[1].fire("click");
  eq(b.sh(".f").children[0].src, `${BASE}/embed?page=${encodeURIComponent(`${LP}/`)}&q=lp-05`, "chip opens /embed with q");
  eq(b.dl().slice(-2).map(e => [e.sam_event, e.sam_qa_id]), [["popup_clicked", "lp-05"], ["chat_opened", "lp-05"]], "popup_clicked + chat_opened");
}
// only visible time counts; pointer move also engages; config after_s when no data-teaser; data-teaser=0 = never
{
  const b = boot({ teaser: null, config: { enabled: true, teaser: { after_s: 5, qa_id: "lp-01", label: "Q" }, chips: [] } });
  await b.advance(10);
  b.fireWin("pointermove");
  b.doc.visibilityState = "hidden";
  await b.advance(30_000);
  eq(b.sh(".t").className, "", "hidden-tab time does not count");
  b.doc.visibilityState = "visible";
  await b.advance(5_000);
  eq(b.sh(".t").className, "t", "config after_s used without data-teaser");
  const off = boot({ teaser: "0" });
  await off.advance(10);
  off.fireWin("scroll");
  await off.advance(120_000);
  eq(off.sh(".t").className, "", "data-teaser=0: never");
}
// never while a form field has focus or #talk is in view; it hides if either happens later
{
  const b = boot({ talk: true });
  await b.advance(10);
  b.fireWin("scroll");
  b.doc.activeElement = { matches: s => s.split(",").includes("input") };
  await b.advance(30_000);
  eq(b.sh(".t").className, "", "not while a field has focus");
  b.doc.activeElement = b.body;
  await b.advance(250);
  eq(b.sh(".t").className, "t", "shows once the field is left");
  b.doc.activeElement = { matches: s => s.split(",").includes("textarea") };
  b.fireDoc("focusin");
  eq(b.sh(".t").hidden, true, "hides when a field gets focus");
  const c = boot({ talk: true });
  await c.advance(10);
  c.fireWin("scroll");
  c.t.ios.find(o => o.els.includes(c.talkEl)).cb([{ isIntersecting: true, target: c.talkEl }]);
  await c.advance(60_000);
  eq(c.sh(".t").className, "", "not while #talk is in view");
}
// mobile: a one-line pill, never an overlay
{
  const b = boot({ width: 375 });
  await b.advance(10);
  b.fireWin("scroll");
  await b.advance(15_000);
  eq(b.sh(".t").className, "t m", "pill under 640 px");
}
// dismissal: session only without consent, 30 days with consent; Esc dismisses
{
  const ls = new Store();
  const b = boot({ ls });
  await b.advance(10); b.fireWin("scroll"); await b.advance(15_000);
  b.sh(".tx").fire("click");
  eq([b.sh(".t").hidden, b.ss.getItem("acc_chat_td"), ls.getItem("acc_chat_td")], [true, "1", null], "no consent: dismissed for the session only");
  eq(b.dl().at(-1).sam_event, "popup_dismissed", "popup_dismissed tracked");
  const next = boot({ ls }); // a new session
  await next.advance(10); next.fireWin("scroll"); await next.advance(15_000);
  eq(next.sh(".t").className, "t", "a new session shows it again");
  next.fireDoc("keydown", { key: "Escape" });
  eq(next.sh(".t").hidden, true, "Esc dismisses");

  const cls = new Store(), t0 = Date.UTC(2026, 9, 27);
  const c = boot({ consent: true, ls: cls, start: t0 });
  await c.advance(10); c.fireWin("scroll"); await c.advance(15_000);
  c.sh(".tx").fire("click");
  ok(Number(cls.getItem("acc_chat_td")) > 0, "consent: dismissal stored for 30 days");
  const d = boot({ consent: true, ls: cls, start: t0 + 29 * 864e5 });
  await d.advance(10); d.fireWin("scroll"); await d.advance(15_000);
  eq(d.sh(".t").className, "", "still dismissed on day 29");
  const e = boot({ consent: true, ls: cls, start: t0 + 31 * 864e5 });
  await e.advance(10); e.fireWin("scroll"); await e.advance(15_000);
  eq(e.sh(".t").className, "t", "back after 30 days");
  ok(cls.getItem("acc_chat_v")?.startsWith("v_") && !new Store().getItem("acc_chat_v"), "visitor id kept across visits only with consent");
  eq(ls.getItem("acc_chat_v"), null, "no consent: visitor id not persisted");
}
// the iframe, the bridge, events, close, CTA
{
  const b = boot({ width: 375 });
  await b.advance(10);
  const btn = b.sh(".l"), wrap = b.sh(".f");
  b.html.style.overflow = "auto";
  btn.fire("click");
  const fr = wrap.children[0];
  eq([fr.tag, fr.src, fr.title, fr.attrs.referrerpolicy, fr.attrs.allow], ["iframe", `${BASE}/embed?page=${encodeURIComponent(`${LP}/`)}`, "Ask Accops", "strict-origin", ""], "iframe created on the first click");
  eq([wrap.className, btn.attrs["aria-expanded"], b.html.style.overflow], ["f on", "true", "hidden"], "open; page scroll locked on mobile");
  btn.fire("click"); btn.fire("click");
  eq(wrap.children.length, 1, "one iframe, reused");
  const msg = (data, origin = BASE, source = fr.contentWindow) => b.fireWin("message", { data, origin, source });
  msg({ t: "ready" }, "https://evil.example");
  msg({ t: "ready" }, BASE, {});
  msg({ t: "ready" }, LP);
  eq(b.t.posts.filter(([m]) => m.t === "init").length, 0, "foreign origin / foreign window ignored");
  msg({ t: "ready" });
  const init = b.t.posts.filter(([m]) => m.t === "init");
  eq(init.length, 1, "init answered");
  eq(init[0][1], BASE, "init goes to the iframe's origin only");
  ok(b.t.posts.every(([, o]) => o === BASE), "every post targets the iframe origin, never *");
  ok(/^v_[0-9a-f]{16}$/.test(init[0][0].visitor_id) && init[0][0].consent === false, "init carries visitor id + consent");
  const before = b.dl().length;
  msg({ t: "event", name: "answer_shown", qa_id: "lp-01", source: "bank", text: "my email is a@b.com", ref: "x" });
  msg({ t: "event", name: "question_clicked", qa_id: "call me on 98765 43210", source: "typed text here" });
  msg({ t: "event", name: "typed", qa_id: "lp-01" });
  msg({ t: "event", name: "answer_shown", qa_id: "lp-02" }, "https://evil.example");
  const evs = b.dl().slice(before);
  eq(evs, [{ event: "sam_chat", sam_event: "answer_shown", page_path: "/", sam_qa_id: "lp-01", sam_source: "bank" },
    { event: "sam_chat", sam_event: "question_clicked", page_path: "/" }], "events: allowlisted names, ids and sources only");
  const KEYS = new Set(["event", "sam_event", "sam_qa_id", "sam_source", "page_path"]);
  ok(b.dl().every(e => Object.keys(e).every(k => KEYS.has(k)) && Object.values(e).every(v => typeof v === "string" && !/\s/.test(v))), "no dataLayer field can hold text");
  for (const [u, blob] of b.t.beacons) {
    eq(u, `${BASE}/api/web/event`, "beacons go to the event route");
    const j = JSON.parse(await blob.text());
    ok(Object.keys(j).every(k => ["visitor_id", "page", "name", "qa_id"].includes(k)), "beacon fields allowlisted");
  }
  msg({ t: "close" });
  eq([wrap.className, btn.attrs["aria-expanded"], b.doc.activeElement, b.html.style.overflow], ["f", "false", btn, "auto"], "close: hidden, focus back on the launcher, scroll restored");
  eq(b.dl().at(-1).sam_event, "chat_closed", "chat_closed tracked");
  btn.fire("click");
  msg({ t: "cta", url: "https://www.accops.com/schedule-a-free-demo" });
  eq([b.t.opened.length, wrap.className, b.dl().at(-1).sam_event], [0, "f on", "talk_to_sales_clicked"], "https CTA: counted, the widget's link opens it (no window.open)");
  // stage 3, the calendar in the panel: the widget posts {t:"cta"} with the Bookings URL (counted, never navigated) and booking_opened
  msg({ t: "cta", url: "https://bookings.cloud.microsoft/book/x@y.onmicrosoft.com/s/abc" });
  msg({ t: "event", name: "booking_opened", text: "my name is Priya", qa_id: "call me on 98765" });
  eq([b.t.opened.length, wrap.className, b.dl().slice(-2).map(e => e.sam_event)], [0, "f on", ["talk_to_sales_clicked", "booking_opened"]], "booking: counted as talk to sales + booking_opened; the chat stays open, nothing navigates");
  eq(b.dl().at(-1), { event: "sam_chat", sam_event: "booking_opened", page_path: "/" }, "booking_opened reaches the dataLayer (GA4) with no text");
  const c = boot({ talk: true });
  await c.advance(10);
  c.sh(".l").fire("click");
  c.fireWin("message", { data: { t: "cta", url: "#talk" }, origin: BASE, source: c.sh(".f").children[0].contentWindow });
  ok(c.talkEl.scrolled && c.sh(".f").className === "f", "#talk CTA: chat closes, the page scrolls to the form");
  c.sh(".l").fire("click");
  c.fireDoc("keydown", { key: "Escape" });
  eq(c.sh(".f").className, "f", "Esc closes the chat");
}
// data-page (SAM's "Test the bot" page): /embed gets it as pg (honoured there only when SAM frames itself, section 5);
// the teaser uses that page's public roots; events still report the real page
{
  const b = boot({ origin: BASE, pg: `${LP}/` });
  await b.advance(10);
  eq(b.t.fetches, [`${BASE}/api/web/config?page=${encodeURIComponent(`${LP}/`)}`], "data-page: config asked for that page's roots");
  b.sh(".l").fire("click");
  eq(b.sh(".f").children[0].src, `${BASE}/embed?page=${encodeURIComponent(`${BASE}/`)}&pg=${encodeURIComponent(`${LP}/`)}`, "data-page passed to /embed as pg, page stays the host's");
  const j = JSON.parse(await b.t.beacons.at(-1)[1].text());
  eq(j.page, `${BASE}/`, "beacons report the real host page, not data-page");
}
// page-aware (27 Oct): the section with the most pixels in view (its id, or "section-N" for the N-th id-less <main>
// section, SEC-allowlisted) picks the teaser when it is due, goes to /embed as sec, and to the open widget on a reopen
{
  const at = (id, top, bottom, main = true) => ({ id, rect: { top, bottom, height: bottom - top }, main });
  const cfg = u => (u.includes("&section=migration")
    ? { enabled: true, teaser: { after_s: 15, qa_id: "lp-05", label: "Can we migrate off Citrix without downtime?" }, chips: [{ id: "lp-07", label: "Pilot first?" }, { id: "lp-06", label: "How long?" }, { id: "lp-29", label: "Support?" }] }
    : { enabled: true, teaser: { after_s: 15, qa_id: "lp-01", label: "How is Accops different from Citrix?" }, chips: [{ id: "lp-02", label: "Components" }] });
  const see = (b, rects) => { const o = b.t.ios[0]; Object.entries(rects).forEach(([i, r]) => { o.els[i].rect = r; }); o.cb(o.els.map(target => ({ target, isIntersecting: target.rect.bottom > 0 && target.rect.top < 800 }))); };
  const b = boot({ config: cfg, sections: [at("", -900, -100), at("migration", -200, 700), at("faq", 700, 1600), at("talk", 1600, 2400)] });
  await b.advance(10);
  eq(b.t.ios[0].els.map(e => e.id), ["", "migration", "faq", "talk"], "one observer over the <main> sections and id'd sections / headings");
  see(b, {});
  b.fireWin("scroll");
  await b.advance(15_000);
  eq(b.t.fetches.length, 2, "nothing measured or fetched before the teaser is due (no per-scroll work)");
  eq(b.t.fetches[1], `${BASE}/api/web/config?page=${encodeURIComponent(`${LP}/`)}&section=migration`, "teaser due: config for the section most in view (700 px of migration vs 100 px of faq)");
  await b.advance(250);
  eq([b.sh(".t").className, b.sh(".tq span").textContent, b.sh(".tc").children.map(c => c.textContent)],
    ["t", "Can we migrate off Citrix without downtime?", ["Pilot first?", "How long?"]], "the teaser and its 2 chips follow the section");
  eq(b.dl().at(-1), { event: "sam_chat", sam_event: "popup_shown", page_path: "/", sam_qa_id: "lp-05" }, "popup_shown names the section's question");
  b.sh(".tq").fire("click");
  const fr = b.sh(".f").children[0];
  eq(fr.src, `${BASE}/embed?page=${encodeURIComponent(`${LP}/`)}&q=lp-05&sec=migration`, "/embed gets the section (starter chips match)");
  b.fireWin("message", { data: { t: "close" }, origin: BASE, source: fr.contentWindow });
  see(b, { 1: { top: -1200, bottom: -300 }, 2: { top: -300, bottom: 600 }, 3: { top: 600, bottom: 1400 } });
  b.sh(".l").fire("click");
  eq(JSON.parse(JSON.stringify(b.t.posts.filter(([m]) => m.t === "sec"))), [[{ t: "sec", sec: "faq" }, BASE]], "reopened after scrolling: the widget is told the new section, at its origin only");
  b.sh(".l").fire("click"); b.sh(".l").fire("click");
  eq(b.t.posts.filter(([m]) => m.t === "sec").length, 1, "reopened on the same section: nothing new sent");
  eq(b.sh(".f").children.length, 1, "still one iframe");

  // the N-th id-less <main> section is "section-N"; ids outside the allowlist are never sent (no free text leaves the page)
  const c = boot({ config: cfg, sections: [at("", -900, -100), at("comparison", -100, 50), at("", 50, 800)] });
  await c.advance(10); see(c, {});
  c.sh(".l").fire("click");
  ok(c.sh(".f").children[0].src.endsWith("&sec=section-3"), "id-less <main> section: section-N (the page cards' naming)");
  for (const junk of ["Pricing_Table", "a b", "-x", "x".repeat(42), "évaluation"]) {
    const d = boot({ config: cfg, sections: [at(junk, 0, 800, false)] });
    await d.advance(10); see(d, {});
    d.fireWin("scroll"); await d.advance(15_250);
    d.sh(".l").fire("click");
    ok(!d.t.fetches.some(u => u.includes("section=")) && !d.sh(".f").children[0].src.includes("sec="), `id ${JSON.stringify(junk)} dropped`);
    eq(d.sh(".tq span").textContent, "How is Accops different from Citrix?", "no section: the page's teaser");
  }
  // SAM's test page: data-page's #anchor stands in for the section (the host page's own sections are never read)
  const e = boot({ origin: BASE, pg: `${LP}/#comparison`, config: cfg, sections: [at("migration", 0, 800)] });
  await e.advance(10); see(e, {});
  e.sh(".l").fire("click");
  ok(e.sh(".f").children[0].src.endsWith(`&pg=${encodeURIComponent(`${LP}/#comparison`)}&sec=comparison`), "data-page #anchor -> sec");
}
// the launcher rises above the page's sticky bar while it shows
{
  const b = boot({ width: 375, avoid: "[data-sticky]", avoidRect: { top: 730, height: 70 } });
  await b.advance(10);
  eq(b.host().style["--lift"], "70px", "lift = the bar's visible height");
}

// ---------- 3-6: the iframe side (TypeScript via jiti) ----------
const stub = path.join(mkdtempSync(path.join(tmpdir(), "web-widget-")), "stub.mjs");
writeFileSync(stub, "export const Barlow = () => ({ variable: 'f' }); export default function Widget() { return null; } export const headers = async () => new Headers(globalThis.__H ?? {});");
const jiti = createJiti(import.meta.url, { alias: { "@": web }, jsx: { runtime: "automatic" } });
const pj = createJiti(import.meta.url, { alias: { "next/font/google": stub, "next/headers": stub, "@/components/blocks/blocks.css": stub, "./embed.css": stub, "./Widget": stub, "@": web }, jsx: { runtime: "automatic" } });
const Br = await jiti.import("@/app/embed/bridge.ts");

// 3. bridge
{
  const parentWin = {}, A = Br.embedOrigins("");
  eq(A, ["https://www.accops.com", "https://accops.com", LP], "default origins: accops.com + the LP");
  eq(Br.embedOrigins(" https://accops-citrix-lp-git-x.vercel.app,http://insecure.example,javascript:alert(1),https://x.example/path "),
    [...A, "https://accops-citrix-lp-git-x.vercel.app"], "WEB_EMBED_ORIGINS adds exact https origins only");
  eq(Br.acceptInit({ origin: "https://evil.example", source: parentWin, data: { t: "init" } }, A, parentWin), null, "init: foreign origin ignored");
  eq(Br.acceptInit({ origin: LP, source: {}, data: { t: "init" } }, A, parentWin), null, "init: a window other than the parent ignored");
  eq(Br.acceptInit({ origin: LP, source: parentWin, data: { t: "init", visitor_id: "v_0123456789abcdef", consent: true } }, A, parentWin),
    { origin: LP, visitor_id: "v_0123456789abcdef", consent: true }, "init from the framing LP accepted");
  eq(Br.acceptInit({ origin: LP, source: parentWin, data: { t: "init", visitor_id: "drop table" } }, A, parentWin)?.visitor_id, null, "bad visitor id dropped");
  eq(Br.eventMessage("answer_shown", { qa_id: "lp-01", source: "model", text: "secret", ref: "a b<script>" }),
    { t: "event", name: "answer_shown", qa_id: "lp-01", source: "model", ref: "a_bscript" }, "event: only name/id/source/ref, ref reduced");
  eq(Br.eventMessage("question_clicked", { qa_id: "my email is a@b.com", source: "typed" }), { t: "event", name: "question_clicked" }, "free text in ids/sources dropped");
  eq(Br.eventMessage("custom_text", {}), null, "unknown event names never leave");
  ok(!/postMessage\([^)]*["']\*["']/.test(read("app/embed/Widget.tsx")), "the widget never posts to *");
  // SAM's own origin (the "Test the bot" page) is trusted only when WEB_EMBED_ORIGINS lists it; never a wildcard
  const S = Br.embedOrigins(`${LP},${BASE}`);
  ok(!A.includes(BASE) && S.includes(BASE) && !Br.embedOrigins("*").includes("*"), "SAM's origin only via WEB_EMBED_ORIGINS, no wildcard");
  eq(Br.acceptInit({ origin: BASE, source: parentWin, data: { t: "init" } }, A, parentWin), null, "init from SAM refused when not listed");
  eq(Br.acceptInit({ origin: BASE, source: parentWin, data: { t: "init" } }, S, parentWin)?.origin, BASE, "init from SAM accepted when listed");
  const H = o => ({ get: k => o[k] ?? null });
  const self = { "sec-fetch-site": "same-origin", "sec-fetch-dest": "iframe", referer: `${BASE}/` };
  ok(Br.selfFramed(H(self), S), "selfFramed: SAM framing its own /embed, listed");
  ok(!Br.selfFramed(H(self), A), "selfFramed: not when SAM's origin is not listed");
  ok(!Br.selfFramed(H({ ...self, "sec-fetch-site": "cross-site", referer: `${LP}/` }), S), "selfFramed: the LP framing is not self");
  ok(!Br.selfFramed(H({ ...self, "sec-fetch-site": "cross-site" }), S), "selfFramed: a foreign page claiming SAM's referer is still cross-site");
  ok(!Br.selfFramed(H({ ...self, "sec-fetch-dest": "document" }), S) && !Br.selfFramed(H({ ...self, referer: null }), S), "selfFramed: iframe only, referer required");
  // /api/web/event's is_test: server-side, from the origin (loader beacons) or the signed t_ conversation (widget events)
  eq([Br.testEvent(BASE, "sam-accops.vercel.app"), Br.testEvent(LP, "sam-accops.vercel.app"), Br.testEvent(null, "sam-accops.vercel.app")], [true, false, false], "is_test from origin: SAM's own page only");
  eq([Br.testEvent(BASE, "sam-accops.vercel.app", "c_1"), Br.testEvent(BASE, "sam-accops.vercel.app", "t_1")], [false, true], "widget events: test only for a t_ conversation");
  // stage 3: the booking calendar URL, and which CTAs open it
  const BK = "https://bookings.cloud.microsoft/book/AccopsUnifiedPlatformforSecureRemoteAccess2@propalmsnetwork.onmicrosoft.com/s/UEDDAf42hEiNVqsGcRVJ-w2?ismsaljsauthenabled";
  eq(Br.BOOKING_ORIGIN, "https://bookings.cloud.microsoft", "one booking origin");
  eq(Br.bookingUrl(BK), BK, "the Accops Bookings page is accepted as is");
  eq(Br.bookingUrl(` ${BK} `), BK, "trimmed");
  for (const bad of ["", null, 42, "http://bookings.cloud.microsoft/book/x", "https://evil.example/book/x", "https://bookings.cloud.microsoft.evil.example/x",
    "https://user:pw@bookings.cloud.microsoft/x", "javascript:alert(1)", "https://outlook.office.com/book/x", `https://bookings.cloud.microsoft/${"x".repeat(500)}`])
    eq(Br.bookingUrl(bad), "", `booking_url refused: ${String(bad).slice(0, 60)}`);
  eq([Br.opensBooking("", "talk_to_sales"), Br.opensBooking(BK, "talk_to_sales"), Br.opensBooking(BK, undefined), Br.opensBooking(BK, ""), Br.opensBooking(BK, "open_url")],
    [false, true, true, true, false], "the calendar opens only with a booking_url, and only for talk-to-sales (never an open_url CTA)");
  eq(Br.eventMessage("booking_opened", { text: "my email is a@b.com", ref: "a b" }), { t: "event", name: "booking_opened", ref: "a_b" }, "booking_opened is allowlisted, no text");
  ok(read("app/api/web/event/route.ts").includes('"booking_opened"] as const'), "the event route accepts booking_opened");
  ok(/EV = \/\^\([^)]*\|booking_opened\)\$\//.test(read("scripts/embed.src.js")), "the loader forwards booking_opened to the dataLayer");
  // the Website tab's setting takes the same rule
  const Wd = await jiti.import("@/lib/web-dashboard.ts");
  const cur = { enabled: "true", model_enabled: "true", model_ceiling: "300", groq_daily_cap: "40", repeat_n: "3", repeat_window_min: "10", cta_label: "Talk to an expert", cta_url: "https://www.accops.com/schedule-a-free-demo" };
  const form = o => ({ ...cur, enabled: "on", model_enabled: "on", ...o });
  eq(Wd.settingsPatch(form({}), cur), { changes: [] }, "booking_url empty and no row yet: no change");
  eq(Wd.settingsPatch(form({ booking_url: BK }), cur), { changes: [{ key: "booking_url", value: BK }] }, "setting: the Bookings link saved");
  eq(Wd.settingsPatch(form({ booking_url: "" }), { ...cur, booking_url: BK }), { changes: [{ key: "booking_url", value: "" }] }, "setting: empty switches it off");
  for (const bad of ["https://evil.example/x", "http://bookings.cloud.microsoft/x", "javascript:alert(1)"])
    ok("error" in Wd.settingsPatch(form({ booking_url: bad }), cur), `setting refused: ${bad}`);
}

// 4. frame-ancestors on /embed only, same list as the widget trusts
{
  const cfg = (await jiti.import("@/next.config.ts")).default;
  for (const env of [undefined, "https://accops-citrix-lp-git-x.vercel.app", `${LP},${BASE}`]) {
    if (env) process.env.WEB_EMBED_ORIGINS = env; else delete process.env.WEB_EMBED_ORIGINS;
    const h = await cfg.headers();
    eq(h.map(r => r.source), ["/embed"], "headers() touches /embed only");
    const csp = h[0].headers.find(x => x.key === "Content-Security-Policy")?.value;
    eq(csp, `frame-ancestors 'self' ${Br.embedOrigins(env).join(" ")}; frame-src ${Br.BOOKING_ORIGIN}`, `frame-ancestors = 'self' + the widget's origin list (env ${env ?? "unset"}); frame-src = the booking origin`);
    eq(csp.match(/frame-src ([^;]*)/)[1], "https://bookings.cloud.microsoft", "frame-src: exactly the Bookings origin, nothing else");
    ok(!csp.includes("*"), "frame-ancestors / frame-src: no wildcard");
    ok(!h.flatMap(r => r.headers).some(x => /x-frame-options/i.test(x.key)), "no X-Frame-Options");
  }
  delete process.env.WEB_EMBED_ORIGINS;
  eq((await cfg.redirects()).map(r => r.source), ["/live/:path*"], "redirects unchanged");
}

// 5. /embed: inert -> 404; on -> fresh, verifiable handshake + cleaned inputs
{
  const ENV = { WEB_CHAT_ENABLED: "1", SUPABASE_URL: "https://stub.example.co", SAM_WEB_READER_JWT: "jwt.stub.sig", SAM_WEB_SUPABASE_APIKEY: "pub_stub",
    WEB_IP_SALT: "salt", WEB_HS_SECRET: "hs-secret-for-the-check" };
  const Page = (await pj.import("@/app/embed/page.tsx")).default;
  const { verifyHs, mintHs } = await jiti.import("@/lib/web/bot.ts");
  const is404 = e => String(e?.digest).includes("404");
  await assert.rejects(() => Page({ searchParams: Promise.resolve({}) }), is404, "inert (no env): 404"); n++;
  Object.assign(process.env, ENV);
  let enabled = true, booking;
  const seen = [];
  globalThis.fetch = async u => {
    const s = String(u);
    seen.push(decodeURIComponent(s));
    const body = s.includes("rpc/sam_web_settings") ? { enabled, model_enabled: true, cta_url: "https://www.accops.com/schedule-a-free-demo", cta_label: "Talk to an expert",
      ...(booking === undefined ? {} : { booking_url: booking }) }
      : s.includes("rpc/sam_web_roots") ? [{ id: "lp-01", question: "Why did my Citrix renewal go up?" }, { id: "bad id", question: "x" }, { id: "lp-03", question: "q".repeat(80) }]
      : null;
    return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
  };
  enabled = false;
  await assert.rejects(() => Page({ searchParams: Promise.resolve({}) }), is404, "settings.enabled=false: 404"); n++;
  enabled = true;
  const el = await Page({ searchParams: Promise.resolve({ page: "https://accops-citrix-lp.vercel.app/", q: "lp-01" }) });
  const p = el.props.children.props;
  ok("age" in verifyHs(p.hs, p.conversationId, Date.now() + 1500), "hs verifies with bot.ts (same secret and format)");
  ok(/^c_[0-9a-f-]{36}$/.test(p.conversationId), "a fresh conversation id per request");
  eq([p.page, p.ask, p.origins], ["https://accops-citrix-lp.vercel.app/", "lp-01", Br.embedOrigins()], "page, q and origins passed");
  eq(p.starters.map(r => r.id), ["lp-01", "lp-03"], "starters: valid ids only (no pairs or cards readable here: the roots)");
  ok(p.starters[1].label.length <= 60, "starter labels cut to 60");
  seen.length = 0;
  await Page({ searchParams: Promise.resolve({ page: "https://accops-citrix-lp.vercel.app/", sec: "migration" }) });
  ok(seen.some(u => u.includes("sam_web_pages_public") && u.includes('"https://accops-citrix-lp.vercel.app/#migration"')), "sec: the section's page card is asked for");
  seen.length = 0;
  await Page({ searchParams: Promise.resolve({ page: "https://accops-citrix-lp.vercel.app/", sec: "Bad Id\"),x" }) });
  ok(!seen.some(u => u.includes("#")), "a junk sec is dropped before any query");
  eq(p.talk, { label: "Talk to an expert", url: "https://www.accops.com/schedule-a-free-demo" }, "talk-to-sales from settings");
  eq(p.booking, "", "no booking_url (before the 05 SQL): no calendar, the CTA opens a new tab as before");
  const BK = "https://bookings.cloud.microsoft/book/AccopsUnifiedPlatformforSecureRemoteAccess2@propalmsnetwork.onmicrosoft.com/s/UEDDAf42hEiNVqsGcRVJ-w2?ismsaljsauthenabled";
  for (const [v, want] of [[BK, BK], ["", ""], ["https://evil.example/book", ""], ["javascript:alert(1)", ""]]) {
    booking = v;
    eq((await Page({ searchParams: Promise.resolve({}) })).props.children.props.booking, want, `booking_url ${v || "(empty)"} -> ${want || "no calendar"}`);
  }
  booking = undefined;
  const p2 = (await Page({ searchParams: Promise.resolve({ page: "javascript:alert(1)", q: "x y" }) })).props.children.props;
  eq([p2.page, p2.ask], ["", null], "a bad page or q is dropped, never reflected");
  ok(p2.hs !== p.hs, "hs minted per request");
  // the "Test the bot" page: pg honoured and a test conversation only when SAM frames itself (Sec-Fetch, listed origin)
  const { isTestConv } = await jiti.import("@/lib/web/bot.ts");
  const SP = { page: `${BASE}/`, pg: "https://accops-citrix-lp.vercel.app/" };
  const SELF = { "sec-fetch-site": "same-origin", "sec-fetch-dest": "iframe", referer: `${BASE}/` };
  const embed = async h => { globalThis.__H = h; return (await Page({ searchParams: Promise.resolve(SP) })).props.children.props; };
  process.env.WEB_EMBED_ORIGINS = `${LP},${BASE}`;
  const pt = await embed(SELF);
  ok(/^t_[0-9a-f-]{36}$/.test(pt.conversationId) && pt.page === SP.pg, "self-framed: a t_ conversation, answering as the LP page");
  ok(isTestConv(pt.hs, pt.conversationId), "the t_ id verifies as a test conversation");
  const pf = await embed({ "sec-fetch-site": "cross-site", "sec-fetch-dest": "iframe", referer: "https://evil.example/" });
  ok(/^c_/.test(pf.conversationId) && pf.page === `${BASE}/`, "spoofed pg from a foreign origin: ignored, a normal conversation");
  ok(!isTestConv(pf.hs, pf.conversationId) && !isTestConv(pf.hs, `t_${pf.conversationId.slice(2)}`) && !isTestConv(null, "t_x"), "a renamed or unsigned t_ id is not a test");
  delete process.env.WEB_EMBED_ORIGINS;
  const pn = await embed(SELF);
  ok(/^c_/.test(pn.conversationId) && pn.page === `${BASE}/`, "SAM not in WEB_EMBED_ORIGINS: pg ignored, not a test");
  ok(isTestConv(mintHs("t_old", Date.now() - 3 * 3600_000), "t_old"), "an expired but signed test hs is still a test");
  delete globalThis.__H;
  for (const k of Object.keys(ENV)) delete process.env[k];
  const pageSrc = read("app/embed/page.tsx");
  eq((pageSrc.match(/blocks\/blocks\.css/g) || []).length, 1, "page.tsx imports blocks.css once");
  ok(/robots:\s*\{\s*index:\s*false/.test(pageSrc), "noindex");
}

// 6. every fixture as the widget draws it
{
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const W = await jiti.import("@/app/embed/Widget.tsx");
  const { fixtures } = createRequire(import.meta.url)("../components/blocks/fixtures.json");
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  const { emSplit } = await jiti.import("@/lib/emphasis.ts");
  let pills = 0, strong = 0;
  for (const f of fixtures) {
    const html = renderToStaticMarkup(React.createElement(W.AnswerView, { a: f.answer }));
    for (const b of f.answer.blocks) {
      if (["text", "stat", "compare_table", "steps", "calculator"].includes(b.type)) {
        ok(b.source, `${f.id}: ${b.type} has a source`);
        ok(html.includes(`${b.type === "text" && b.ai ? "Based on" : "From"} ${esc(b.source.label)}`), `${f.id}: ${b.type} shows its source pill`);
        pills++;
      }
      if (b.type === "text") emSplit(b.body).forEach((t, i) => {
        if (i % 2) { ok(html.includes(`<strong class="sb-em">${esc(t)}</strong>`), `${f.id}: "${t}" emphasised`); strong++; }
      });
      if (b.type === "compare_table" && b.columns.length === 3)
        ok(b.columns.slice(1).every(c => html.includes(`data-col="${esc(c)}"`)), `${f.id}: 3-column cells carry data-col`);
    }
  }
  const t = fixtures.find(f => f.id === "lp-28").answer;
  const bare = { ...t, blocks: [{ type: "text", body: "An unsourced claim: 99% faster." }, ...t.blocks] };
  ok(!renderToStaticMarkup(React.createElement(W.AnswerView, { a: bare })).includes("99% faster"), "a Text without a source is not drawn");
  ok(!/\*\*/.test(fixtures.map(f => renderToStaticMarkup(React.createElement(W.AnswerView, { a: f.answer }))).join("")), "no raw ** reaches the page");
  ok(strong >= 2, `emphasis drawn (${strong})`);
  const css = read("components/blocks/blocks.css");
  const hex = n => css.match(new RegExp(`--sb-${n}: (#[0-9a-f]{6})`, "i"))[1];
  const lum = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  ok(ratio(hex("navy"), hex("hl")) >= 4.5 && ratio(hex("navy"), "#ffffff") >= 4.5, `emphasis contrast: navy on the band ${ratio(hex("navy"), hex("hl")).toFixed(1)}:1`);
  const emRule = css.match(/\.sb-em \{[^}]*\}/)[0];
  ok(/color: var\(--sb-navy\)/.test(emRule) && !/animation|transition/.test(emRule) && /forced-colors[^{]*\{ \.sb-em/.test(css), "emphasis: navy, static, visible in forced colours");
  ok(/@container \(max-width: 479px\)[\s\S]*content: attr\(data-col\)/.test(css), "narrow 3-column tables stack as cards (container query)");
  ok(/@container \(max-width: 479px\)[\s\S]*tbody tr\[hidden\] \{ display: none; \}/.test(css), "card mode keeps collapsed row details hidden");
  const shell = renderToStaticMarkup(React.createElement(W.default, { conversationId: "c_x", hs: "h", page: "", origins: [], ask: null,
    starters: [{ id: "lp-01", label: "Why did my Citrix renewal go up?" }], talk: { label: "Talk to an expert", url: "https://www.accops.com/schedule-a-free-demo" } }));
  ok(/role="log"[^>]*aria-live="polite"/.test(shell), "thread is a polite live log");
  ok(shell.includes("Please don&#x27;t share personal details") || shell.includes("Please don’t share personal details"), "privacy line above the input");
  ok(shell.includes('maxLength="500"'), "input capped at 500");
  ok(shell.includes("Why did my Citrix renewal go up?") && shell.includes("↳"), "roots as ↳ rows");
  // stage 3: the booking calendar inside the panel
  const BK = "https://bookings.cloud.microsoft/book/AccopsUnifiedPlatformforSecureRemoteAccess2@propalmsnetwork.onmicrosoft.com/s/UEDDAf42hEiNVqsGcRVJ-w2?ismsaljsauthenabled";
  const withBk = renderToStaticMarkup(React.createElement(W.default, { conversationId: "c_x", hs: "h", page: "", origins: [], ask: null, starters: [],
    talk: { label: "Talk to an expert", url: "https://www.accops.com/schedule-a-free-demo" }, booking: BK }));
  ok(!withBk.includes("<iframe") && withBk.includes('href="https://www.accops.com/schedule-a-free-demo"'), "with a booking_url: nothing loads from Microsoft until asked; the link still works without script");
  const bv = on => renderToStaticMarkup(React.createElement(W.BookingView, { url: BK, title: "Talk to an expert", on, onBack: () => {}, onClose: () => {} }));
  const opened = bv(true), shut = bv(false);
  ok(opened.includes('class="w-book on"') && shut.includes('class="w-book"') && !shut.includes('class="w-book on"'), "shown only when open (kept mounted when not, so a half-filled booking survives Back)");
  ok(/<button type="button" class="w-back" aria-label="Back to the chat">.*?Back<\/button>/.test(opened), "a Back button to the chat");
  ok(opened.includes(`<iframe src="${esc(BK)}" title="Talk to an expert: booking calendar"`), "the calendar iframe, titled");
  ok(opened.includes(`href="${esc(BK)}" target="_blank" rel="noopener noreferrer" aria-label="Open the calendar in a new tab"`) && opened.includes('aria-label="Close chat"'), "a way out to a new tab; close stays reachable");
  const wsrc = read("app/embed/Widget.tsx");
  ok(/if \(opensBooking\(booking, action\)\)/.test(wsrc) && /track\("booking_opened"\)/.test(wsrc) && /cta\(String\(params\.url \?\? ""\), String\(params\.action \?\? ""\)\)/.test(wsrc),
    "every talk-to-sales CTA (answer blocks, Prefer a person, the error CTA) goes through opensBooking");
  eq((wsrc.match(/inert=\{inBooking\}/g) || []).length, 3, "the chat underneath (header, thread, input) is inert while the calendar is open");
  const ecss = read("app/embed/embed.css");
  ok(/\.w-book \{ position: absolute; inset: 0;/.test(ecss) && /\.w-book\.on \{ display: flex;/.test(ecss) && /\.w-book-frame iframe \{[^}]*height: 100%/.test(ecss), "the calendar takes the whole sheet (on a phone the loader's frame is full screen)");
  console.log(`web-widget.check: ${n} assertions passed (loader ${gz} B gzip, ${pills} source pills shown, ${strong} emphasised phrases)`);
}
