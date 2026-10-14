// Screens and call flow: Sign in -> Start call -> Live -> Ending -> Ended (+ Settings).
// Audio is captured in a hidden window (capture.js); this page asks for it and gets levels, clips and status back.
import { $, h, renderAlerts, renderAsk, renderCards, renderQual, renderTranscript, renderEnded, renderAssist } from './view.js';
import { createUploader, createQuality } from './uploader.js';

const S = { screen: null, server: '', user: null, visible: true, muted: false, deal: null, call: null, ended: null, quality: 'green',
  micApp: null, micPlatform: null, auto: true, starting: false };
const FLOW = { sent: 'Summary emailed to you', failed: 'Summary email not sent' };
const ASSIST = { cooldownMs: 3000 };
const PLATFORM = { 'phone-link': 'Phone Link', teams: 'Teams', zoom: 'Zoom', meet: 'Google Meet', whatsapp: 'WhatsApp', webex: 'Webex', slack: 'Slack', browser: 'Browser' };

// ---------- helpers
const val = id => $(id).value.trim() || undefined;
const host = u => { try { return new URL(u).host; } catch { return u; } };
const fmtDur = ms => {
  const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60) % 60, hrs = Math.floor(s / 3600), ss = String(s % 60).padStart(2, '0');
  return hrs ? `${hrs}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
const fmtLen = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s} sec call` : `${Math.round(s / 60)} min call`; };
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
const newestCards = list => list.filter((x, i) => list.findIndex(y => y.title === x.title && y.link === x.link) === i).slice(0, 3);
const cleanErr = e => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
const log = (level, msg) => sam.log(level, msg);
function err(id, msg) { $(id).textContent = msg || ''; $(id).hidden = !msg; }
function busy(id, label) { const b = $(id); b.dataset.label ??= b.textContent; b.textContent = label; b.disabled = true; }
function idle(id) { const b = $(id); b.textContent = b.dataset.label ?? b.textContent; b.disabled = false; }
let toastT;
function toast(msg, ms = 0) {
  clearTimeout(toastT);
  $('toast').textContent = msg || ''; $('toast').hidden = !msg;
  if (msg && ms) toastT = setTimeout(() => { $('toast').hidden = true; }, ms);
}

// ---------- navigation
const ENTER = {};
function go(screen) {
  if (S.call && !['live', 'ending', 'ended'].includes(screen)) return; // a running call can only be ended
  S.screen = screen;
  document.body.dataset.screen = screen;
  for (const el of document.querySelectorAll('main > section[data-screen]')) el.hidden = el.dataset.screen !== screen;
  $('foot-start').hidden = screen !== 'start';
  $('foot-live').hidden = screen !== 'live';
  $('foot-ended').hidden = screen !== 'ended';
  $('foot-settings').hidden = screen !== 'settings';
  $('btn-settings').hidden = !['signin', 'start'].includes(screen);
  $('rec').hidden = screen !== 'live';
  $('sync').hidden = !['live', 'ending'].includes(screen);
  if (!S.call) { $('bar-name').textContent = 'SAM Live'; $('bar-sub').textContent = ''; }
  if (screen !== 'live') toast();
  document.querySelector('main').scrollTop = 0;
  ENTER[screen]?.();
  syncCapture();
}

// ---------- audio: previewed on Start (meters) while the window is visible, captured for real while Live.
// The capture window answers every 'run' with a 'state'; levels that arrive after we stopped wanting audio are ignored.
const CAP = { on: false, micId: '', state: null, waiters: [], flushed: null };
function syncCapture(force = false) {
  const on = S.screen === 'live' || S.starting || (S.screen === 'start' && S.visible), micId = localStorage.mic || '';
  if (!force && on === CAP.on && (!on || micId === CAP.micId)) return;
  CAP.on = on; CAP.micId = micId;
  if (!on) { CAP.state = null; for (const ch of ['rep', 'customer']) meter(ch, -120); }
  sam.capture({ cmd: 'run', on, micId });
}
/** Resolves with the capture state once the devices are open (or with whatever we have after 8 s). */
function capReady() {
  if (CAP.state?.running) return Promise.resolve(CAP.state);
  return new Promise(r => { CAP.waiters.push(r); setTimeout(() => r(CAP.state), 8000); });
}
sam.onCapture(m => {
  if (m.type === 'state') {
    if (!CAP.on) return;
    CAP.state = m;
    audioHint(m.errors);
    fillMics(m.mics);
    for (const w of CAP.waiters.splice(0)) w(m);
  } else if (m.type === 'level') {
    if (CAP.on) { meter('rep', m.rep); meter('customer', m.customer); }
  } else if (m.type === 'utt') {
    const c = S.call;
    if (!c?.uploader) return;
    c.lastSpeech = Date.now();
    c.uploader.push({ channel: m.channel, tMs: m.at - c.started, durationMs: m.durationMs, wav: m.wav });
  } else if (m.type === 'flushed') {
    CAP.flushed?.();
  } else if (m.type === 'mic') {
    if (S.screen !== 'live') return;
    if (m.state === 'recovering') toast('Microphone changed. Reconnecting…');
    else if (m.state === 'ok') toast('Microphone reconnected', 2500);
    else toast("Microphone lost. Check it's plugged in, or pick another in Windows sound settings.");
  } else if (m.type === 'health') {
    const c = S.call;
    if (!c) return;
    c.customerSilent = m.customerSilent;
    renderHealth();
  }
});
function meter(ch, db) {
  const v = `scaleX(${Math.max(0, Math.min(1, (db + 60) / 45))})`; // -60 dBFS empty, -15 dBFS full
  $(`lvl-${ch}`).style.transform = v; $(`mlvl-${ch}`).style.transform = v;
}
function audioHint(errors = {}) {
  const msgs = [];
  if (errors.rep) msgs.push(`Microphone unavailable (${errors.rep.name || errors.rep.message}). Check Windows Settings › Privacy › Microphone.`);
  if (errors.customer) msgs.push(`Call audio unavailable (${errors.customer.message || errors.customer.name}).`);
  $('audio-hint').textContent = msgs.join(' ') || "Call audio is everything this PC plays, so the customer's side of any call app.";
  $('audio-hint').classList.toggle('warn', msgs.length > 0);
}
function fillMics(list = []) {
  const mics = list.filter(m => m.deviceId !== 'default');
  if (localStorage.mic && mics.length && !mics.some(m => m.deviceId === localStorage.mic)) localStorage.removeItem('mic'); // unplugged
  $('mic').replaceChildren(h('option', { value: '' }, 'Default microphone'), ...mics.map(m => h('option', { value: m.deviceId }, m.label || 'Microphone')));
  $('mic').value = localStorage.mic || '';
}
$('mic').onchange = () => { localStorage.mic = $('mic').value; syncCapture(); };

// ---------- sign in
ENTER.signin = () => { $('signin-server').textContent = host(S.server); $('signin-id').focus(); };
$('signin-form').onsubmit = async e => {
  e.preventDefault();
  const id = $('signin-id').value.trim(), pw = $('signin-pw').value;
  if (!id || !pw) return err('signin-err', 'Enter your SAM login ID and password.');
  busy('signin-btn', 'Signing in…');
  const r = await sam.login(id, pw);
  idle('signin-btn');
  if (!r.ok) return err('signin-err', r.status === 0 ? `Can't reach ${host(S.server)}. Check your connection.`
    : r.status === 401 || r.status === 403 ? "That login ID and password don't match." : r.error || `Sign-in failed (${r.status}).`);
  $('signin-pw').value = ''; err('signin-err');
  S.user = r.user; go('start');
};
function signedOut(msg) {
  sam.signOut(); S.user = null;
  go('signin'); err('signin-err', msg || 'Your session ended. Sign in again.');
}

// ---------- start call
ENTER.start = () => { checkResume(); };
let dealSeq = 0, dealTimer, dealList = [], active = -1;
$('company').addEventListener('input', () => { pickDeal(null); queueDeals(); });
$('company').addEventListener('focus', queueDeals);
$('company').addEventListener('blur', () => setTimeout(closeDeals, 120));
$('company').addEventListener('keydown', e => {
  if ($('deals').hidden || !dealList.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + dealList.length) % dealList.length; drawDeals();
  } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pickDeal(dealList[active]); }
  else if (e.key === 'Escape') closeDeals();
});
function queueDeals() {
  clearTimeout(dealTimer);
  dealTimer = setTimeout(async () => {
    const seq = ++dealSeq;
    const r = await sam.api('GET', `/api/live/deals?q=${encodeURIComponent($('company').value.trim())}`);
    if (seq !== dealSeq || document.activeElement !== $('company') || S.deal) return;
    if (r.status === 401) return signedOut();
    dealList = ((r.ok && r.data?.deals) || []).slice(0, 8); active = -1; drawDeals();
  }, 160);
}
function drawDeals() {
  $('deals').hidden = !dealList.length;
  $('company').setAttribute('aria-expanded', String(dealList.length > 0));
  $('deals').replaceChildren(...dealList.map((d, i) => h('li', {
    role: 'option', 'aria-selected': String(i === active), onmousedown: e => { e.preventDefault(); pickDeal(d); },
  }, h('b', {}, d.company), h('span', {}, [d.contact_name, d.last_meeting_at ? `last call ${fmtDate(d.last_meeting_at)}` : 'no calls yet'].filter(Boolean).join(' · ')))));
}
function closeDeals() { $('deals').hidden = true; $('company').setAttribute('aria-expanded', 'false'); }
function pickDeal(d) {
  S.deal = d || null;
  if (d) {
    $('company').value = d.company; $('c-name').value = d.contact_name || ''; $('c-email').value = d.contact_email || '';
    closeDeals();
    $('deal-note').textContent = `Existing deal${d.contact_name ? ` with ${d.contact_name}` : ''}. Qualification carries over from the last call.`;
  }
  $('deal-note').hidden = !d;
  $('contact').hidden = !!d;
}
function resetStart() {
  for (const id of ['company', 'c-name', 'c-title', 'c-email', 'm-title']) $(id).value = '';
  pickDeal(null); err('start-err');
}

$('start-form').onsubmit = async e => {
  e.preventDefault();
  const company = val('company');
  if (!company) { err('start-err', 'Add the company you are calling.'); return $('company').focus(); }
  busy('start-btn', 'Starting…');
  const failed = st => !st?.running || (st.errors.rep && st.errors.customer);
  if (failed(CAP.state)) { CAP.state = null; syncCapture(true); } // retries if the preview failed earlier
  const st = await capReady();
  if (failed(st)) { idle('start-btn'); return err('start-err', "SAM Live can't hear this PC yet. See Audio above."); }
  const body = S.deal ? { deal_id: S.deal.id } : { company, contact_name: val('c-name'), contact_email: val('c-email'), contact_title: val('c-title') };
  if (val('m-title')) body.title = val('m-title');
  body.platform = S.micPlatform || 'manual';
  const r = await sam.api('POST', '/api/live/meetings', body);
  idle('start-btn');
  if (r.status === 401) return signedOut();
  if (!r.ok || !r.data?.meeting?.id) return err('start-err', r.status === 0 ? "Can't reach SAM. Check your connection and try again." : r.data?.error || `Couldn't start the call (${r.status}).`);
  err('start-err');
  beginCall({ meeting: r.data.meeting, framework: r.data.framework, company: S.deal?.company ?? company, contact: S.deal?.contact_name ?? val('c-name'), platform: body.platform });
};

// ---------- auto mode: a meeting or Phone Link call took the mic -> the call starts with no form; "Who's this?" later
let autoBusy = false;
async function autoStart(e) {
  if (!S.auto || !S.user || S.call || autoBusy) return;
  autoBusy = true; S.starting = true;
  syncCapture(); // open the devices while the meeting is created
  try {
    log('info', `auto-starting a call (${e.platform})`);
    const r = await sam.api('POST', '/api/live/meetings', { platform: e.platform, auto_started: true });
    if (r.status === 401) return signedOut();
    if (!r.ok || !r.data?.meeting?.id || S.call) {
      if (S.call) return;
      log('warn', `auto-start failed (${r.status})`);
      go('start');
      return err('start-err', `${e.app} call detected, but SAM couldn't start it${r.status === 0 ? " (offline)" : ''}. Start it here.`);
    }
    beginCall({ meeting: r.data.meeting, framework: r.data.framework, company: '', contact: '', platform: e.platform, auto: true });
  } finally { S.starting = false; autoBusy = false; syncCapture(); }
}

// ---------- live
function beginCall({ meeting, framework, company, contact, segments = [], resumed = false, platform = meeting.platform ?? null, auto = !!meeting.auto_started }) {
  const started = resumed ? Date.parse(meeting.started_at) || Date.now() : Date.now();
  const c = S.call = {
    meeting, company, contact, started, lastSpeech: Date.now(), platform, auto, editing: false,
    framework: Array.isArray(framework) ? framework : [],
    qual: { ...(meeting.qualification || {}) },
    ask: Array.isArray(meeting.suggestions) ? meeting.suggestions.slice(0, 3) : [],
    cards: newestCards(Array.isArray(meeting.battlecards) ? [...meeting.battlecards].reverse() : []), // stored oldest first
    alerts: [], segments: [...segments].sort((a, b) => a.t_ms - b.t_ms), selected: null,
    quality: createQuality(), released: null, autoEnd: null, customerSilent: false, healthDismissed: false, assist: null, echoDrops: 0,
  };
  c.uploader = createUploader({
    send: u => sam.upload(meeting.id, u.channel, u.tMs, u.durationMs, u.wav),
    onResult: data => onResult(c, data),
    onStatus: s => { if (S.call === c) syncStatus(s); },
  });
  saveLive(c);
  setMute(false);
  sam.setLive(true);
  sam.capture({ cmd: 'call', on: true, platform: platform || '' }); // fresh VADs; clips carry their wall-clock time, so t_ms = at - started
  log('info', `call ${resumed ? 'resumed' : 'started'} (meeting ${meeting.id})`);
  c.timer = setInterval(tick, 1000); tick();
  setHeader(c);
  $('transcript').open = false;
  for (const id of ['ask', 'cards', 'alerts']) delete $(id).dataset.sig;
  $('ask-q').value = '';
  go('live');
  renderLive(); renderAssistNow(); renderHealth(); renderReleased(); renderCaller();
  syncStatus({ pending: 0 });
}
const saveLive = c => { localStorage.live = JSON.stringify({ id: c.meeting.id, framework: c.framework, company: c.company, contact: c.contact, platform: c.platform, auto: c.auto }); };
function setHeader(c) {
  $('bar-name').textContent = c.company || (PLATFORM[c.platform] ? `${PLATFORM[c.platform]} call` : 'Call');
  $('bar-sub').textContent = c.contact || '';
}

// "Who's this?": an auto-started call has no company. The rep can fill it in any time; PATCH files the call on that deal.
function renderCaller() {
  const c = S.call;
  $('caller').hidden = !c?.auto;
  if (!c?.auto) return;
  $('caller-plat').textContent = PLATFORM[c.platform] ?? 'Call';
  $('caller-plat').hidden = !c.platform;
  $('caller-name').textContent = c.company || "Who's this?";
  $('caller-sub').textContent = c.company ? [c.contact, c.title].filter(Boolean).join(' · ') : 'Add the company so SAM files the call';
  $('caller-btn').setAttribute('aria-expanded', String(c.editing));
  $('caller-form').hidden = !c.editing;
}
$('caller-btn').onclick = () => {
  const c = S.call;
  if (!c) return;
  c.editing = !c.editing;
  if (c.editing) {
    $('cf-company').value = c.company || ''; $('cf-name').value = c.contact || ''; $('cf-title').value = c.title || ''; $('cf-email').value = c.email || '';
    err('cf-err');
  }
  renderCaller();
  if (c.editing) $('cf-company').focus();
};
$('cf-cancel').onclick = () => { if (S.call) { S.call.editing = false; renderCaller(); } };
$('caller-form').onsubmit = async e => {
  e.preventDefault();
  const c = S.call;
  if (!c) return;
  const body = Object.fromEntries([['company', 'cf-company'], ['contact_name', 'cf-name'], ['contact_title', 'cf-title'], ['contact_email', 'cf-email']]
    .map(([k, id]) => [k, val(id)]).filter(([, v]) => v));
  if (!body.company && !c.company) return err('cf-err', 'Add the company first.');
  if (!Object.keys(body).length) { c.editing = false; return renderCaller(); }
  busy('cf-save', 'Saving…');
  const r = await sam.api('PATCH', `/api/live/meetings/${encodeURIComponent(c.meeting.id)}`, body);
  idle('cf-save');
  if (S.call !== c) return;
  if (r.status === 401) return err('cf-err', 'Your SAM session ended. End the call and sign in again.');
  if (!r.ok) return err('cf-err', r.status === 0 ? "Can't reach SAM. Try again in a moment." : r.data?.error || `Couldn't save (${r.status}).`);
  const d = r.data?.deal ?? {};
  c.company = d.company || body.company || c.company;
  c.contact = d.contact_name || body.contact_name || c.contact;
  c.title = d.contact_title || body.contact_title || c.title;
  c.email = d.contact_email || body.contact_email || c.email;
  c.editing = false;
  log('info', 'caller details saved');
  saveLive(c); setHeader(c); renderCaller();
};
function onResult(c, data) {
  if (S.call !== c) return;
  if (data?.segment?.text) { c.segments.push(data.segment); c.segments.sort((a, b) => a.t_ms - b.t_ms); }
  if (data?.dropped === 'echo') c.echoDrops++; // the server heard the customer's words on the rep channel
  if (Array.isArray(data?.removed_segment_ids) && data.removed_segment_ids.length) {
    const gone = new Set(data.removed_segment_ids.map(String));
    c.segments = c.segments.filter(s => !gone.has(String(s.id)));
    log('info', `server removed ${gone.size} echo line(s) from the transcript`);
  }
  const ins = data?.insight;
  if (ins) {
    for (const [k, v] of Object.entries(ins.qualification || {})) if (v) c.qual[k] = v;
    if (Array.isArray(ins.ask_next)) c.ask = ins.ask_next.slice(0, 3);
    if (ins.battlecards?.length) c.cards = newestCards([...ins.battlecards, ...c.cards]); // server sends only cards not shown yet
    c.alerts = Array.isArray(ins.alerts) ? ins.alerts.slice(0, 2) : [];
  }
  renderLive();
}
function renderLive() {
  const c = S.call, labels = Object.fromEntries(c.framework.map(f => [f.key, f.label]));
  renderAlerts(c.alerts);
  renderAsk(c.ask, labels);
  renderCards(c.cards, url => sam.open(url));
  renderQualNow();
  renderTranscript(c.segments);
}
function renderQualNow() {
  const c = S.call;
  renderQual(c.framework, c.qual, c.selected, key => {
    c.selected = key; renderQualNow();
    if (key) $('q-detail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}
$('transcript').addEventListener('toggle', () => {
  if (!$('transcript').open) return;
  $('t-list').scrollTop = $('t-list').scrollHeight;
  $('transcript').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});
function tick() {
  const c = S.call;
  if (!c) return;
  $('timer').textContent = fmtDur(Date.now() - c.started);
  setQuality(c.quality.level());
  // "Call ended?" left unanswered: end once the meeting app is still off the mic and nobody spoke for autoEndMs.
  if (c.released && S.screen === 'live' && Date.now() - Math.max(c.released.at, c.lastSpeech) >= c.released.autoEndMs) {
    log('info', 'auto-ending: the call app left the mic and the call has been silent');
    return endCall();
  }
  renderAutoEnd();
  if (c.autoEnd && S.screen === 'live' && Date.now() >= c.autoEnd.until) {
    log('info', `auto mode: ${c.autoEnd.app} left the mic, ending the call`);
    endCall();
  }
}
function renderAutoEnd() {
  const a = S.call?.autoEnd;
  $('auto-end').hidden = !a;
  if (!a) return;
  $('ae-n').textContent = String(Math.max(0, Math.ceil((a.until - Date.now()) / 1000)));
  $('ae-sub').textContent = `${a.app} has let go of the microphone.`;
}
$('ae-keep').onclick = () => { const c = S.call; if (c) { c.autoEnd = null; c.keepListening = true; renderAutoEnd(); log('info', 'auto end cancelled: keep listening'); } };

// Header pill: green / yellow / red from upload round trips and queue depth (see QUALITY), plus queue text.
let lastStatus = { pending: 0 };
function syncStatus(s) {
  lastStatus = s;
  const c = S.call;
  if (c) c.quality.note(s);
  const state = s.auth ? 'auth' : s.failing ? 'retry' : s.pending > 2 ? 'busy' : 'ok', el = $('sync');
  el.dataset.state = state;
  setQuality(c ? c.quality.level() : 'green');
}
function setQuality(q) {
  const s = lastStatus, el = $('sync'), state = el.dataset.state;
  S.quality = q;
  el.dataset.q = q;
  el.textContent = { auth: 'Signed out', retry: `Offline · ${s.pending}` }[state] ?? (q === 'yellow' ? (s.pending > 2 ? `Slow · ${s.pending}` : 'Slow') : s.pending > 2 ? `${s.pending}` : '');
  el.title = {
    auth: 'Your SAM session ended. Clips are kept; end the call and sign in again.',
    retry: `Can't reach SAM. ${s.pending} clip${s.pending === 1 ? '' : 's'} waiting; retrying automatically.`,
  }[state] ?? (q === 'yellow' ? 'Connection to SAM is slow. Transcripts may lag.' : s.pending > 2 ? `Sending ${s.pending} clips to SAM` : 'Connected to SAM');
  el.setAttribute('aria-label', el.title);
  syncAssistButton();
}
// One place for mute, so the track, the button and the next call's preview always agree.
function setMute(m) {
  S.muted = m;
  sam.capture({ cmd: 'mute', on: m });
  $('mute').setAttribute('aria-pressed', String(m));
  $('mute').querySelector('span').textContent = m ? 'Muted' : 'Mic on';
}
$('mute').onclick = () => setMute(!S.muted);

let endArm;
$('end').onclick = () => {
  const b = $('end');
  if (!b.dataset.confirm) {
    b.dataset.confirm = '1'; b.textContent = 'Confirm end';
    endArm = setTimeout(() => { delete b.dataset.confirm; b.textContent = 'End call'; }, 3000);
    return;
  }
  clearTimeout(endArm); delete b.dataset.confirm; b.textContent = 'End call';
  endCall();
};

// ---------- assist: "What do I say next?" and "Ask SAM…"
let assistSeq = 0, cooldownT = null;
function syncAssistButton() {
  const c = S.call, b = $('assist-next'), bad = S.quality === 'red';
  const disabled = !c || bad || c.assist?.loading || c.cooldown;
  b.disabled = !!disabled;
  b.title = bad ? "Can't reach SAM right now" : c?.cooldown ? 'One moment…' : 'One line to say next, from what was said so far';
  b.classList.toggle('loading', !!c?.assist?.loading && c.assist.mode === 'next');
  $('ask-q').disabled = !c || bad;
  $('ask-q').placeholder = bad ? 'Offline: Ask SAM is paused' : 'Ask SAM…';
}
function renderAssistNow() {
  const c = S.call;
  renderAssist(c?.assist ?? null, url => sam.open(url), () => { if (S.call) { S.call.assist = null; $('ask-q').value = ''; renderAssistNow(); } });
  syncAssistButton();
}
async function assist(question) {
  const c = S.call;
  if (!c || S.quality === 'red' || c.assist?.loading) return;
  const seq = ++assistSeq, mode = question ? 'search' : 'next';
  c.assist = { mode, question, loading: true };
  renderAssistNow();
  $('assist-out').scrollIntoView({ block: 'nearest' });
  const r = await sam.api('POST', `/api/live/meetings/${encodeURIComponent(c.meeting.id)}/assist`, question ? { question } : {});
  if (S.call !== c || seq !== assistSeq) return;
  c.assist = r.ok ? { mode, question, data: r.data } : {
    mode, question,
    error: r.status === 409 ? 'This call has already ended.' : r.status === 0 ? "Can't reach SAM. Try again in a moment."
      : r.status === 401 ? 'Your SAM session ended. End the call and sign in again.'
      : r.data?.error || `SAM couldn't answer (${r.status}).`,
  };
  if (mode === 'next') { // a short cooldown so a nervous double-tap doesn't burn two model calls
    c.cooldown = true; clearTimeout(cooldownT);
    cooldownT = setTimeout(() => { c.cooldown = false; syncAssistButton(); }, ASSIST.cooldownMs);
  }
  renderAssistNow();
}
$('assist-next').onclick = () => assist();
$('ask-form').onsubmit = e => {
  e.preventDefault();
  const q = $('ask-q').value.trim();
  if (q) assist(q.slice(0, 300));
};

// ---------- call detection + call-audio health
sam.onDetector(e => {
  if (e.type === 'started') return autoStart(e); // main only sends these in auto mode
  if (e.type === 'using') {
    S.micApp = e.apps[0] ?? S.micApp; S.micPlatform = e.platforms?.[0] ?? null;
    const c = S.call;
    if (c && (!c.platform || c.platform === 'manual') && S.micPlatform) { c.platform = S.micPlatform; saveLive(c); setHeader(c); renderCaller(); renderHealth(); sam.capture({ cmd: 'call', on: true, platform: c.platform }); }
    return;
  }
  const c = S.call;
  if (!c) return;
  // auto mode: count down from the moment the app lets go, end at 0 unless it comes back or the rep keeps listening.
  // manual mode: ask "Call ended?" once it has been gone for the grace period.
  if (e.type === 'releasing' && S.auto && !c.keepListening) c.autoEnd = { until: Date.now() + (Number(e.graceMs) || 15000), app: e.app };
  if (e.type === 'released' && !S.auto) c.released = { at: Date.now(), app: e.app, autoEndMs: Number(e.autoEndMs) || 300000 };
  if (e.type === 'back') { c.released = null; c.autoEnd = null; c.keepListening = false; }
  renderReleased(); renderAutoEnd();
});
function renderReleased() {
  const r = S.call?.released;
  $('call-ended').hidden = !r;
  if (r) $('ce-sub').textContent = `${r.app} has let go of the microphone.`;
}
$('ce-keep').onclick = () => { if (S.call) { S.call.released = null; renderReleased(); } };
$('ce-end').onclick = () => { if (S.call) { S.call.released = null; endCall(); } };
function renderHealth() {
  const c = S.call;
  $('health').hidden = !(c?.customerSilent && !c.healthDismissed);
  $('health-sub').textContent = c?.platform === 'phone-link'
    ? 'Phone Link may be playing the call on your phone. In Phone Link, turn on “Use your PC for call audio”.'
    : `Is ${S.micApp || 'Teams'} playing on a different speaker than Windows' default?`;
}
$('health-x').onclick = () => { if (S.call) { S.call.healthDismissed = true; renderHealth(); } };

// ---------- ending
async function endCall() {
  const c = S.call;
  if (!c || S.screen === 'ending') return;
  const flushed = new Promise(r => { CAP.flushed = r; setTimeout(r, 3000); });
  sam.capture({ cmd: 'call', on: false }); // the capture window sends what is still in its VADs, then 'flushed'
  go('ending'); // stops capture (after the flush: the capture window handles commands in order)
  ending('Saving the last few seconds', '');
  await flushed;
  CAP.flushed = null;
  finish(c, await c.uploader.drain(20000));
}
async function finish(c, unsent) {
  ending('Writing your summary', unsent ? `${unsent} clip${unsent === 1 ? '' : 's'} didn't reach SAM; the summary uses everything that did.` : 'This takes a few seconds.');
  const r = await sam.api('POST', `/api/live/meetings/${encodeURIComponent(c.meeting.id)}/end`);
  if (!r.ok) {
    $('ending-retry').onclick = () => finish(c, c.uploader.pending());
    return ending("Couldn't finish the call", r.status === 0 ? "SAM can't be reached. The call stays open; try again once you're online." : r.data?.error || `SAM returned an error (${r.status}).`, true);
  }
  clearInterval(c.timer);
  setMute(false);
  sam.setLive(false);
  localStorage.removeItem('live');
  log('info', `call ended (meeting ${c.meeting.id}, ${c.segments.length} lines, ${c.echoDrops ?? 0} echo clips dropped by SAM)`);
  S.call = null;
  S.ended = { id: c.meeting.id, email: r.data?.summary?.follow_up_email };
  const det = r.data?.summary?.detected, found = !c.company && det?.company;
  renderEnded(r.data?.summary || {}, { company: c.company || det?.company || 'Unknown caller', detected: found ? 'Company detected from the call' : '',
    duration: fmtLen(Date.now() - c.started), flow: FLOW[String(r.data?.flow_status).split(':')[0]] });
  resetStart(); // the next call (New call, tray, meeting notification) must not inherit this customer
  go('ended');
}
function ending(msg, sub, failed = false) {
  $('ending-msg').textContent = msg; $('ending-sub').textContent = sub;
  $('ending-actions').hidden = !failed;
  document.querySelector('.working .spinner').hidden = failed;
}

// ---------- resume a call the app lost (crash, restart, sleep)
async function checkResume() {
  $('resume').hidden = true;
  let saved;
  try { saved = JSON.parse(localStorage.live || 'null'); } catch { saved = null; }
  if (!saved?.id || S.call) return;
  const r = await sam.api('GET', `/api/live/meetings/${encodeURIComponent(saved.id)}`);
  const m = r.data?.meeting ?? r.data;
  if (r.status === 404 || (r.ok && m?.status && m.status !== 'live')) return localStorage.removeItem('live');
  if (!r.ok || !m?.id || S.screen !== 'start') return;
  $('resume-name').textContent = saved.company || 'an unknown caller';
  $('resume').hidden = false;
  $('resume-go').onclick = () => beginCall({ meeting: m, framework: r.data.framework ?? saved.framework, company: saved.company || m.deal?.company || '', contact: saved.contact || m.deal?.contact_name || '',
    segments: r.data.segments ?? m.segments ?? [], resumed: true, platform: saved.platform ?? m.platform ?? null, auto: saved.auto ?? !!m.auto_started });
  $('resume-end').onclick = () => {
    const c = S.call = { meeting: m, company: saved.company, started: Date.parse(m.started_at) || Date.now(), uploader: { pending: () => 0 }, segments: [] };
    go('ending'); finish(c, 0);
  };
}

// ---------- ended
$('copy-email').onclick = async () => {
  const e = S.ended?.email;
  if (!e) return;
  await sam.copy(`Subject: ${e.subject ?? ''}\n\n${e.body ?? ''}`);
  $('copy-email').textContent = 'Copied';
  setTimeout(() => { $('copy-email').textContent = 'Copy'; }, 1600);
};
$('open-sam').onclick = () => S.ended && sam.openMeeting(S.ended.id);
$('new-call').onclick = () => go('start');

// ---------- settings
ENTER.settings = async () => {
  const st = await sam.state();
  $('server').value = st.server; $('opacity').value = st.opacity; $('version').textContent = st.version;
  $('invisible').checked = st.invisible;
  $('auto').checked = st.auto;
  $('who').textContent = st.user ? `Signed in as ${st.user.id}` : 'Not signed in';
  $('sign-out').hidden = !st.user;
  err('server-err');
};
$('server-form').onsubmit = async e => {
  e.preventDefault();
  try {
    const origin = await sam.setServer($('server').value);
    if (origin !== S.server) { S.server = origin; S.user = null; }
    $('server-save').textContent = 'Saved';
    setTimeout(() => { $('server-save').textContent = 'Save'; }, 1400);
    ENTER.settings();
  } catch (x) {
    err('server-err', /Invalid URL/i.test(cleanErr(x)) ? 'Enter a full address, like https://sam-accops.vercel.app' : cleanErr(x));
  }
};
$('opacity').oninput = e => sam.setOpacity(e.target.value);
$('invisible').onchange = async e => { e.target.checked = await sam.setInvisible(e.target.checked); };
$('auto').onchange = async e => { S.auto = e.target.checked = await sam.setAuto(e.target.checked); };
$('sign-out').onclick = () => { sam.signOut(); S.user = null; go('signin'); };
$('settings-done').onclick = () => go(S.user ? 'start' : 'signin');
$('btn-settings').onclick = () => go('settings');
for (const b of document.querySelectorAll('[data-go]')) b.onclick = () => go(b.dataset.go);
$('btn-min').onclick = () => sam.window('minimize');
$('btn-close').onclick = () => sam.window('hide');

// ---------- boot
sam.onNav(to => { if (to === 'start' && !S.call) go(S.user ? 'start' : 'signin'); });
sam.onVisible(v => { S.visible = v; syncCapture(); });
window.addEventListener('error', e => log('error', `${e.message} @ ${String(e.filename).split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', e => log('error', `unhandled: ${e.reason?.message || e.reason}`));
const st = await sam.state();
S.server = st.server; S.user = st.user; S.auto = st.auto;
go(S.user ? 'start' : 'signin');
