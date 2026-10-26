/* Ask Accops loader: the SOURCE of web/public/embed.js (SAM website chatbot, plan 7.1).
 * Edit here, then `node scripts/build-embed.mjs` (esbuild minify, ES2019) writes public/embed.js with this file's
 * sha256 in its first line; web-widget.check fails if they drift, if the build is over 5 KB gzip, or if any rule
 * below breaks (it runs the built file in a fake DOM).
 *
 * Tag:  <script src="https://sam-accops.vercel.app/embed.js" async data-teaser="15" data-avoid="[data-sticky]"></script>
 *   data-teaser  seconds of visible, engaged time before the teaser (0 = never); default: the config's after_s
 *   data-avoid   a bottom-fixed bar of the host page (CSS selector) that the launcher rises above while it shows
 * After load + idle it GETs /api/web/config: the kill switch (anything but enabled:true draws nothing).
 * The launcher and teaser live in a closed shadow root (no CSS leaks either way); the /embed iframe is created on the
 * first click only. The bridge takes messages only from that iframe's window AND origin, answers only to that origin
 * (never "*"), and forwards to dataLayer / Clarity / PostHog nothing but allowlisted event names, ids and sources:
 * never a word the visitor typed. Plain ES2019, no dependencies. */
(function (W, D) {
  "use strict";
  var me = D.currentScript;
  if (!me || W.AccopsChat) return;
  W.AccopsChat = 1;
  var base = new URL(me.src).origin, page = location.origin + location.pathname, K = "acc_chat_", DAY = 864e5;
  var ID = /^[\w.:-]{1,80}$/, EV = /^(question_clicked|answer_shown|doc_opened|filter_used|step_viewed)$/;
  var SRC = /^(bank|intent|cache|model|fallback|guard|limited|repeat|root|chip|picker|teaser)$/;
  var ok = function (re, v) { return typeof v === "string" && re.test(v) ? v : null; };
  var attr = function (n) { return me.getAttribute("data-" + n); };
  var consent = function () { return W.SAM_CONSENT === true; };
  var still = function () { return !!(W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches); };
  function get(k, local) { try { return (local ? W.localStorage : W.sessionStorage).getItem(K + k); } catch (e) { return null; } }
  function put(k, v, local) { try { (local ? W.localStorage : W.sessionStorage).setItem(K + k, v); } catch (e) { } }

  // Visitor id: this session only; kept across visits only with consent (window.SAM_CONSENT === true).
  var vid = ok(ID, get("v")) || (consent() && ok(ID, get("v", 1)));
  if (!vid) {
    var a = new Uint8Array(8);
    W.crypto.getRandomValues(a);
    vid = "v_" + Array.prototype.map.call(a, function (b) { return (b + 256).toString(16).slice(1); }).join("");
  }
  put("v", vid);
  if (consent()) put("v", vid, 1);

  function track(name, qa, src) {
    var e = { event: "sam_chat", sam_event: name, page_path: location.pathname };
    if (qa) e.sam_qa_id = qa;
    if (src) e.sam_source = src;
    (W.dataLayer = W.dataLayer || []).push(e);
    if (typeof W.clarity === "function") { W.clarity("event", name); W.clarity("set", "sam_chat", "1"); }
    if (W.posthog && typeof W.posthog.capture === "function") W.posthog.capture("sam_" + name, { qa_id: qa || undefined, source: src || undefined });
  }
  // The loader's own events, sent before any iframe exists (text/plain JSON: a simple request, no preflight).
  function beacon(name, qa) {
    var b = { visitor_id: vid, page: page, name: name };
    if (qa) b.qa_id = qa;
    try { navigator.sendBeacon(base + "/api/web/event", new Blob([JSON.stringify(b)], { type: "text/plain" })); } catch (e) { }
  }
  function both(name, qa) { track(name, qa); beacon(name, qa); }

  var CSS = ":host{all:initial;--e:cubic-bezier(.22,.61,.36,1)}*{box-sizing:border-box}" +
    ".l,.t,.f{position:fixed;z-index:2147483000;font-family:Barlow,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
    "button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}" +
    "button:focus-visible{outline:2px solid #c8431c;outline-offset:2px}" +
    ".l{right:24px;bottom:calc(24px + env(safe-area-inset-bottom,0px) + var(--lift,0px));width:56px;height:56px;border:0;border-radius:50%;padding:0;" +
    "display:grid;place-items:center;background:#0f1e3a;color:#fff;box-shadow:0 8px 24px rgba(15,30,58,.28),0 1px 3px rgba(15,30,58,.24);" +
    "transition:transform .22s var(--e),bottom .22s var(--e)}" +
    ".l:hover{transform:scale(1.05)}.l:active{transform:scale(.95)}.l:focus-visible{outline-offset:3px}" +
    ".l svg{grid-area:1/1;transition:opacity .18s,transform .22s var(--e)}.l .c,.l[aria-expanded=true] .o{opacity:0;transform:rotate(-60deg) scale(.5)}" +
    ".l[aria-expanded=true] .c{opacity:1;transform:none}" +
    ".f{right:24px;bottom:calc(96px + var(--lift,0px));width:400px;height:min(680px,calc(100vh - 112px - var(--lift,0px)));border-radius:16px;overflow:hidden;" +
    "background:#fff;box-shadow:0 18px 48px rgba(15,30,58,.14),0 0 0 1px rgba(15,30,58,.07);opacity:0;transform:translateY(12px) scale(.98);" +
    "transform-origin:100% 100%;visibility:hidden;pointer-events:none;transition:opacity .22s var(--e),transform .22s var(--e),visibility 0s .22s}" +
    ".f.on{opacity:1;transform:none;visibility:visible;pointer-events:auto;transition:opacity .22s var(--e),transform .22s var(--e)}" +
    ".f iframe{display:block;width:100%;height:100%;border:0;color-scheme:light}" +
    ".t{right:24px;bottom:calc(96px + var(--lift,0px));width:300px;padding:14px 16px 16px;border-radius:16px;background:#fff;color:#282828;" +
    "box-shadow:0 14px 40px rgba(15,30,58,.16),0 0 0 1px rgba(15,30,58,.07);animation:i .32s var(--e) both}" +
    ".t[hidden]{display:none}.te{margin:0 30px 6px 0;font-size:11.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#6b6b6b}" +
    ".tq{display:flex;gap:8px;justify-content:space-between;width:100%;padding:0;border:0;background:none;text-align:left;font-size:16px;font-weight:600;" +
    "line-height:1.35;letter-spacing:-.005em;color:#0f1e3a}.tq:hover span{text-decoration:underline;text-underline-offset:3px}" +
    ".tq b{flex:none;font-weight:400;color:#c8431c;transition:transform .2s var(--e)}.tq:hover b{transform:translateX(2px)}" +
    ".tc{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.tc button{min-height:34px;padding:6px 12px;border:1px solid #d5d2d2;border-radius:999px;" +
    "background:#fff;font-size:13.5px;font-weight:500;line-height:1.3;text-align:left;color:#282828;transition:border-color .16s,background .16s}" +
    ".tc button:hover{border-color:#0f1e3a;background:#f7f7f7}" +
    ".tx{position:absolute;top:6px;right:6px;width:36px;height:36px;border:0;border-radius:50%;padding:0;background:none;color:#6b6b6b;display:grid;place-items:center}" +
    ".tx:hover{background:#f2f2f2;color:#282828}.tx::after{content:'';position:absolute;inset:-4px}" +
    ".t.m{right:92px;bottom:calc(30px + env(safe-area-inset-bottom,0px) + var(--lift,0px));width:auto;max-width:calc(100vw - 116px);height:44px;padding:0 2px 0 16px;" +
    "border-radius:22px;display:flex;align-items:center;gap:2px}.t.m[hidden]{display:none}.m .te,.m .tc,.m .tq b{display:none}" +
    ".m .tq{display:block;min-width:0;font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.m .tx{position:relative;top:0;right:0;flex:none}" +
    "@keyframes i{from{opacity:0;transform:translateY(8px)}}" +
    "@media (max-width:639px){.f{inset:0;width:auto;height:100vh;height:100dvh;border-radius:0;transform:translateY(32px)}.f.on~.l{visibility:hidden}}" +
    "@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}";
  var X = "<svg viewBox='0 0 16 16' width='16' height='16' aria-hidden='true'><path d='M4 4l8 8M12 4l-8 8' stroke='currentColor' stroke-width='1.7' stroke-linecap='round'/></svg>";
  var HTML = "<div class='t' role='group' aria-label='Suggested question' hidden><button class='tx' type='button' aria-label='Dismiss'>" + X + "</button>" +
    "<p class='te'>Ask Accops</p><button class='tq' type='button'><span></span><b aria-hidden='true'>&rarr;</b></button><div class='tc'></div></div>" +
    "<div class='f' aria-hidden='true'></div>" +
    "<button class='l' type='button' aria-label='Ask Accops' aria-expanded='false'>" +
    "<svg class='o' viewBox='0 0 24 24' width='26' height='26' aria-hidden='true'><path d='M5 18.5V8a3 3 0 013-3h8a3 3 0 013 3v5a3 3 0 01-3 3H9z' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linejoin='round'/><path d='M9.5 10.5h5M9.5 13h3' stroke='#ff9a76' stroke-width='1.8' stroke-linecap='round'/></svg>" +
    "<svg class='c' viewBox='0 0 24 24' width='24' height='24' aria-hidden='true'><path d='M7 10l5 5 5-5' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg></button>";

  function mount(c) {
    var host = D.createElement("div");
    host.setAttribute("data-accops-chat", "");
    var root = host.attachShadow({ mode: "closed" });
    root.innerHTML = "<style>" + CSS + "</style>" + HTML;
    D.body.appendChild(host);
    var q = function (s) { return root.querySelector(s); };
    var btn = q(".l"), tz = q(".t"), tq = q(".tq"), tc = q(".tc"), wrap = q(".f");
    var frame = null, opened = false, shown = false, lock = null, timer = null;

    function open(qa) {
      hideT();
      if (!frame) {
        frame = D.createElement("iframe");
        frame.src = base + "/embed?page=" + encodeURIComponent(page) + (qa ? "&q=" + encodeURIComponent(qa) : "");
        frame.title = "Ask Accops";
        frame.setAttribute("allow", "");
        frame.setAttribute("referrerpolicy", "strict-origin");
        wrap.appendChild(frame);
      }
      opened = true;
      wrap.className = "f on";
      wrap.removeAttribute("aria-hidden");
      btn.setAttribute("aria-expanded", "true");
      if (W.innerWidth < 640) { lock = D.documentElement.style.overflow; D.documentElement.style.overflow = "hidden"; }
      both("chat_opened", qa);
      setTimeout(function () { if (opened) { frame.focus(); frame.contentWindow.postMessage({ t: "focus" }, base); } }, 230);
    }
    function close() {
      if (!opened) return;
      opened = false;
      wrap.className = "f";
      wrap.setAttribute("aria-hidden", "true");
      btn.setAttribute("aria-expanded", "false");
      if (lock !== null) { D.documentElement.style.overflow = lock; lock = null; }
      both("chat_closed");
      btn.focus({ preventScroll: true });
    }
    btn.addEventListener("click", function () { if (opened) close(); else open(); });

    // The bridge: only our iframe's window, only our origin; replies go to that origin, never "*".
    W.addEventListener("message", function (e) {
      if (!frame || e.source !== frame.contentWindow || e.origin !== base) return;
      var m = e.data;
      if (!m || typeof m !== "object") return;
      if (m.t === "ready") frame.contentWindow.postMessage({ t: "init", visitor_id: vid, consent: consent() }, base);
      else if (m.t === "event" && ok(EV, m.name)) track(m.name, ok(ID, m.qa_id), ok(SRC, m.source));
      else if (m.t === "close") close();
      else if (m.t === "cta" && typeof m.url === "string") {
        track("talk_to_sales_clicked");
        // A #anchor on this page: close and scroll there. An https URL was opened by the widget's own link (a new
        // tab from a real click, so no popup blocker); there is nothing to do here but count it.
        var el = /^#[\w-]{1,64}$/.test(m.url) && D.getElementById(m.url.slice(1));
        if (el) { close(); el.scrollIntoView({ behavior: still() ? "auto" : "smooth", block: "start" }); }
      }
    });
    D.addEventListener("keydown", function (e) { if (e.key === "Escape") { if (opened) close(); else if (shown) dismiss(); } });

    // Rise above the page's own bottom bar (the LP's sticky mobile CTA) while it is on screen.
    var av = attr("avoid"), raf = 0;
    function lift() {
      raf = 0;
      var el = av && D.querySelector(av), h = 0, r;
      if (el) { r = el.getBoundingClientRect(); if (r.height && r.top < W.innerHeight) h = Math.round(W.innerHeight - r.top); }
      host.style.setProperty("--lift", h + "px");
    }
    var soon = function () { if (!raf) raf = W.requestAnimationFrame(lift); };
    if (av) {
      W.addEventListener("scroll", soon, { passive: true });
      W.addEventListener("resize", soon);
      D.addEventListener("transitionend", soon, true);
      lift();
    }

    // Teaser: after N s of visible time, counted only once the visitor scrolls or moves the pointer; once a session;
    // never while a form field has focus or #talk is in view (and it hides if either happens); a dismissal lasts the
    // session, or 30 days with consent. It never takes focus; Esc dismisses it. Desktop: a card above the launcher with
    // the page's top question + 2 chips; under 640 px: a one-line pill beside the launcher, never an overlay.
    var T = c.teaser, after = attr("teaser");
    after = after === null ? T && T.after_s : +after;
    var chips = (c.chips || []).filter(function (x) { return x && ok(ID, x.id) && typeof x.label === "string"; }).slice(0, 2);
    function dismissed() { return !!get("td") || Date.now() - (+get("td", 1) || 0) < 30 * DAY; }
    function hideT() { if (timer) { clearInterval(timer); timer = null; } if (shown) { shown = false; tz.hidden = true; } }
    function dismiss() { both("popup_dismissed", T.qa_id); put("td", consent() ? String(Date.now()) : "1", consent()); hideT(); }
    function pick(id) { both("popup_clicked", id); open(id); }
    if (T && ok(ID, T.qa_id) && typeof T.label === "string" && after > 0 && !get("ts") && !dismissed()) {
      var engaged = false, seen = 0, talkIn = false, talk = D.getElementById("talk");
      var engage = function () { engaged = true; };
      W.addEventListener("scroll", engage, { passive: true, once: true });
      W.addEventListener("pointermove", engage, { passive: true, once: true });
      if (talk && W.IntersectionObserver) new W.IntersectionObserver(function (x) { talkIn = x[0].isIntersecting; if (talkIn) hideT(); }).observe(talk);
      var busy = function () { var f = D.activeElement; return talkIn || !!(f && f.matches && f.matches("input,textarea,select,[contenteditable]")); };
      D.addEventListener("focusin", function () { if (shown && busy()) hideT(); });
      q(".tq span").textContent = T.label;
      tq.addEventListener("click", function () { pick(T.qa_id); });
      chips.forEach(function (x) {
        var b = D.createElement("button");
        b.type = "button";
        b.textContent = x.label;
        b.addEventListener("click", function () { pick(x.id); });
        tc.appendChild(b);
      });
      q(".tx").addEventListener("click", dismiss);
      timer = setInterval(function () {
        if (opened) return hideT();
        if (!engaged || D.visibilityState !== "visible") return;
        seen += 250;
        if (seen >= after * 1000 && !busy()) {
          clearInterval(timer);
          timer = null;
          put("ts", "1");
          tz.className = W.innerWidth < 640 ? "t m" : "t";
          tz.hidden = false;
          shown = true;
          both("popup_shown", T.qa_id);
        }
      }, 250);
    }
  }

  function start() {
    W.fetch(base + "/api/web/config?page=" + encodeURIComponent(page), { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) { if (c && c.enabled === true) mount(c); })
      .catch(function () { });
  }
  function idle() { if (W.requestIdleCallback) W.requestIdleCallback(start, { timeout: 3000 }); else setTimeout(start, 1); }
  if (D.readyState === "complete") idle(); else W.addEventListener("load", idle);
})(window, document);
