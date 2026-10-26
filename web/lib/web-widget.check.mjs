/** Stream D's acceptance that can run offline (plan 9 "Stream D"): node lib/web-widget.check.mjs (from web/).
 *  1. Loader size + build: public/embed.js is the build of scripts/embed.src.js (sha256 in line 1), <= 5 KB gzip,
 *     parses as a classic script, and never posts to "*".
 *  2. The loader in a fake DOM (fake clock, storage, fetch, postMessage), the real built file:
 *     kill switch; every teaser rule of plan 7.1; the iframe only on first interaction; the bridge ignores a foreign
 *     origin or window and answers only to the iframe's origin; dataLayer / beacons carry no text; #anchor CTA;
 *     the mobile scroll lock; the lift above a bottom bar; server strings only ever set as textContent.
 *  3. The widget bridge (app/embed/bridge.ts): init only from an allowed parent; events strip anything but name/id/source/ref.
 *  4. frame-ancestors on /embed only (next.config.ts), from the same origin list the widget trusts.
 *  5. /embed (page.tsx): notFound while inert; when on, a handshake that verifyHs accepts, cleaned page + q, the roots.
 *  6. Every fixture as the widget draws it: each Text / Stat / table / steps shows its source pill; a Text without a
 *     source is not drawn; 3-column tables carry data-col for the narrow stacked-card layout (blocks.css). */
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

function boot({ width = 1280, consent = false, teaser = "15", avoid = null, config = { enabled: true, teaser: { after_s: 15, qa_id: "lp-01", label: "Why did my Citrix renewal go up?" }, chips: [{ id: "lp-03", label: "Compare licensing" }, { id: "lp-05", label: "How does migration work?" }] },
  ss = new Store(), ls = new Store(), start = Date.UTC(2026, 9, 27), talk = false, avoidRect = null } = {}) {
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
    set innerHTML(v) { this.html = v; }
    get innerHTML() { return this.html; }
  }
  const script = new El("script");
  script.src = `${BASE}/embed.js`;
  if (teaser !== null) script.attrs["data-teaser"] = teaser;
  if (avoid) script.attrs["data-avoid"] = avoid;
  const talkEl = new El("section"), avoidEl = new El("div");
  avoidEl.rect = avoidRect;
  const body = new El("body"), html = new El("html");
  const doc = { currentScript: script, readyState: "complete", visibilityState: "visible", body, documentElement: html, activeElement: body,
    createElement: tag => new El(tag), getElementById: id => (id === "talk" && talk ? talkEl : null),
    querySelector: s => (s === avoid ? avoidEl : null), addEventListener: (k, f) => on(t.docL, k, f) };
  const timer = every => (fn, ms = 0) => { const id = ++t.id; t.timers.set(id, { at: t.now + ms, fn, every: every ? ms : 0 }); return id; };
  const win = {
    document: doc, location: { origin: LP, pathname: "/", href: `${LP}/` }, innerWidth: width, innerHeight: 800, SAM_CONSENT: consent,
    sessionStorage: ss, localStorage: ls, crypto: globalThis.crypto, URL, Blob, Promise,
    navigator: { sendBeacon: (u, b) => { t.beacons.push([u, b]); return true; } },
    fetch: async u => { t.fetches.push(u); return config ? { ok: true, json: async () => config } : { ok: false, json: async () => ({}) }; },
    setTimeout: timer(false), setInterval: timer(true), clearTimeout: id => t.timers.delete(id), clearInterval: id => t.timers.delete(id),
    requestIdleCallback: f => win.setTimeout(f, 1), requestAnimationFrame: f => { f(); return 1; }, matchMedia: () => ({ matches: false }),
    IntersectionObserver: class { constructor(cb) { t.ios.push(cb); } observe() {} },
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
  c.t.ios[0]([{ isIntersecting: true }]);
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
  const c = boot({ talk: true });
  await c.advance(10);
  c.sh(".l").fire("click");
  c.fireWin("message", { data: { t: "cta", url: "#talk" }, origin: BASE, source: c.sh(".f").children[0].contentWindow });
  ok(c.talkEl.scrolled && c.sh(".f").className === "f", "#talk CTA: chat closes, the page scrolls to the form");
  c.sh(".l").fire("click");
  c.fireDoc("keydown", { key: "Escape" });
  eq(c.sh(".f").className, "f", "Esc closes the chat");
}
// the launcher rises above the page's sticky bar while it shows
{
  const b = boot({ width: 375, avoid: "[data-sticky]", avoidRect: { top: 730, height: 70 } });
  await b.advance(10);
  eq(b.host().style["--lift"], "70px", "lift = the bar's visible height");
}

// ---------- 3-6: the iframe side (TypeScript via jiti) ----------
const stub = path.join(mkdtempSync(path.join(tmpdir(), "web-widget-")), "stub.mjs");
writeFileSync(stub, "export const Barlow = () => ({ variable: 'f' }); export default function Widget() { return null; }");
const jiti = createJiti(import.meta.url, { alias: { "@": web }, jsx: { runtime: "automatic" } });
const pj = createJiti(import.meta.url, { alias: { "next/font/google": stub, "@/components/blocks/blocks.css": stub, "./embed.css": stub, "./Widget": stub, "@": web }, jsx: { runtime: "automatic" } });
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
}

// 4. frame-ancestors on /embed only, same list as the widget trusts
{
  const cfg = (await jiti.import("@/next.config.ts")).default;
  for (const env of [undefined, "https://accops-citrix-lp-git-x.vercel.app"]) {
    if (env) process.env.WEB_EMBED_ORIGINS = env; else delete process.env.WEB_EMBED_ORIGINS;
    const h = await cfg.headers();
    eq(h.map(r => r.source), ["/embed"], "headers() touches /embed only");
    const csp = h[0].headers.find(x => x.key === "Content-Security-Policy")?.value;
    eq(csp, `frame-ancestors ${Br.embedOrigins(env).join(" ")}`, `frame-ancestors = the widget's origin list (env ${env ?? "unset"})`);
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
  const { verifyHs } = await jiti.import("@/lib/web/bot.ts");
  const is404 = e => String(e?.digest).includes("404");
  await assert.rejects(() => Page({ searchParams: Promise.resolve({}) }), is404, "inert (no env): 404"); n++;
  Object.assign(process.env, ENV);
  let enabled = true;
  globalThis.fetch = async u => {
    const s = String(u);
    const body = s.includes("rpc/sam_web_settings") ? { enabled, model_enabled: true, cta_url: "https://www.accops.com/schedule-a-free-demo", cta_label: "Talk to an expert" }
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
  eq(p.roots.map(r => r.id), ["lp-01", "lp-03"], "roots: valid ids only");
  ok(p.roots[1].label.length <= 60, "root labels cut to 60");
  eq(p.talk, { label: "Talk to an expert", url: "https://www.accops.com/schedule-a-free-demo" }, "talk-to-sales from settings");
  const p2 = (await Page({ searchParams: Promise.resolve({ page: "javascript:alert(1)", q: "x y" }) })).props.children.props;
  eq([p2.page, p2.ask], ["", null], "a bad page or q is dropped, never reflected");
  ok(p2.hs !== p.hs, "hs minted per request");
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
  let pills = 0;
  for (const f of fixtures) {
    const html = renderToStaticMarkup(React.createElement(W.AnswerView, { a: f.answer }));
    for (const b of f.answer.blocks) {
      if (["text", "stat", "compare_table", "steps", "calculator"].includes(b.type)) {
        ok(b.source, `${f.id}: ${b.type} has a source`);
        ok(html.includes(`From ${esc(b.source.label)}`), `${f.id}: ${b.type} shows its source pill`);
        pills++;
      }
      if (b.type === "compare_table" && b.columns.length === 3)
        ok(b.columns.slice(1).every(c => html.includes(`data-col="${esc(c)}"`)), `${f.id}: 3-column cells carry data-col`);
    }
  }
  const t = fixtures.find(f => f.id === "lp-28").answer;
  const bare = { ...t, blocks: [{ type: "text", body: "An unsourced claim: 99% faster." }, ...t.blocks] };
  ok(!renderToStaticMarkup(React.createElement(W.AnswerView, { a: bare })).includes("99% faster"), "a Text without a source is not drawn");
  const css = read("components/blocks/blocks.css");
  ok(/@container \(max-width: 479px\)[\s\S]*content: attr\(data-col\)/.test(css), "narrow 3-column tables stack as cards (container query)");
  const shell = renderToStaticMarkup(React.createElement(W.default, { conversationId: "c_x", hs: "h", page: "", origins: [], ask: null,
    roots: [{ id: "lp-01", label: "Why did my Citrix renewal go up?" }], talk: { label: "Talk to an expert", url: "https://www.accops.com/schedule-a-free-demo" } }));
  ok(/role="log"[^>]*aria-live="polite"/.test(shell), "thread is a polite live log");
  ok(shell.includes("Please don&#x27;t share personal details") || shell.includes("Please don’t share personal details"), "privacy line above the input");
  ok(shell.includes('maxLength="500"'), "input capped at 500");
  ok(shell.includes("Why did my Citrix renewal go up?") && shell.includes("↳"), "roots as ↳ rows");
  console.log(`web-widget.check: ${n} assertions passed (loader ${gz} B gzip, ${pills} source pills shown)`);
}
