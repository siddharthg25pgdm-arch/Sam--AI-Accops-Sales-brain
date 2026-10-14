// Screens and call flow: Sign in -> Start call -> Live -> Ending -> Ended (+ Settings).
import { $, h, renderAlerts, renderAsk, renderCards, renderQual, renderTranscript, renderEnded } from './view.js';
import { startCapture, microphones } from './capture.js';
import { Vad, encodeWav, rmsDb } from './audio-core.js';
import { createUploader } from './uploader.js';

const S = { screen: null, server: '', user: null, visible: true, muted: false, deal: null, call: null, ended: null };
const FLOW = { sent: 'Summary emailed to you', failed: 'Summary email not sent' };

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
function err(id, msg) { $(id).textContent = msg || ''; $(id).hidden = !msg; }
function busy(id, label) { const b = $(id); b.dataset.label ??= b.textContent; b.textContent = label; b.disabled = true; }
function idle(id) { const b = $(id); b.textContent = b.dataset.label ?? b.textContent; b.disabled = false; }

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
  document.querySelector('main').scrollTop = 0;
  ENTER[screen]?.();
  syncCapture();
}

// ---------- audio: previewed on Start (meters) while the window is visible, captured for real while Live
// capGen: a capture can still be starting (awaiting getDisplayMedia) when it is stopped; its mic frames
// already flow, so stopping must silence it at once, and a capture that resolves after being stopped is dropped.
let capP = null, cap = null, capGen = 0;
function syncCapture() {
  const want = S.screen === 'live' || (S.screen === 'start' && S.visible);
  if (want && !capP) {
    const gen = ++capGen;
    capP = startCapture({ micId: localStorage.mic || '', onFrame: (ch, x) => { if (gen === capGen) onFrame(ch, x); } }).then(c => {
      if (gen === capGen) { cap = c; c.setMuted(S.muted); audioHint(c.errors); fillMics(); }
      return c;
    }, e => {
      if (gen === capGen) { capP = null; audioHint({ rep: e, customer: e }); }
      return null;
    });
  } else if (!want && capP) stopCapture();
}
function stopCapture() {
  capGen++;
  const p = capP; capP = null; cap = null;
  p?.then(c => c?.stop());
  for (const ch of ['rep', 'customer']) meter(ch, -120);
}
function onFrame(ch, x) {
  meter(ch, rmsDb(x));
  const c = S.call;
  if (c?.vads) for (const u of c.vads[ch].push(x)) send(c, ch, u);
}
const send = (c, channel, u) => c.uploader.push({ channel, tMs: c.offset + u.startMs, durationMs: u.durationMs, wav: encodeWav(u.samples) });
function meter(ch, db) {
  const v = `scaleX(${Math.max(0, Math.min(1, (db + 60) / 45))})`; // -60 dBFS empty, -15 dBFS full
  $(`lvl-${ch}`).style.transform = v; $(`mlvl-${ch}`).style.transform = v;
}
function audioHint(errors) {
  const msgs = [];
  if (errors.rep) msgs.push(`Microphone unavailable (${errors.rep.name || cleanErr(errors.rep)}). Check Windows Settings › Privacy › Microphone.`);
  if (errors.customer) msgs.push(`Call audio unavailable (${cleanErr(errors.customer)}).`);
  $('audio-hint').textContent = msgs.join(' ') || "Call audio is everything this PC plays, so the customer's side of any call app.";
  $('audio-hint').classList.toggle('warn', msgs.length > 0);
}
async function fillMics() {
  const mics = (await microphones()).filter(m => m.deviceId !== 'default');
  $('mic').replaceChildren(h('option', { value: '' }, 'Default microphone'), ...mics.map(m => h('option', { value: m.deviceId }, m.label || 'Microphone')));
  $('mic').value = mics.some(m => m.deviceId === localStorage.mic) ? localStorage.mic : '';
}
$('mic').onchange = () => { localStorage.mic = $('mic').value; stopCapture(); syncCapture(); };

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
  syncCapture(); // retries if the preview failed earlier
  const c = await capP;
  if (!c || (c.errors.rep && c.errors.customer)) { idle('start-btn'); return err('start-err', "SAM Live can't hear this PC yet. See Audio above."); }
  const body = S.deal ? { deal_id: S.deal.id } : { company, contact_name: val('c-name'), contact_email: val('c-email'), contact_title: val('c-title') };
  if (val('m-title')) body.title = val('m-title');
  const r = await sam.api('POST', '/api/live/meetings', body);
  idle('start-btn');
  if (r.status === 401) return signedOut();
  if (!r.ok || !r.data?.meeting?.id) return err('start-err', r.status === 0 ? "Can't reach SAM. Check your connection and try again." : r.data?.error || `Couldn't start the call (${r.status}).`);
  err('start-err');
  beginCall({ meeting: r.data.meeting, framework: r.data.framework, company: S.deal?.company ?? company, contact: S.deal?.contact_name ?? val('c-name') });
};

// ---------- live
function beginCall({ meeting, framework, company, contact, segments = [], resumed = false }) {
  const started = resumed ? Date.parse(meeting.started_at) || Date.now() : Date.now();
  const c = S.call = {
    meeting, company, contact, started,
    framework: Array.isArray(framework) ? framework : [],
    qual: { ...(meeting.qualification || {}) },
    ask: Array.isArray(meeting.suggestions) ? meeting.suggestions.slice(0, 3) : [],
    cards: newestCards(Array.isArray(meeting.battlecards) ? [...meeting.battlecards].reverse() : []), // stored oldest first
    alerts: [], segments: [...segments].sort((a, b) => a.t_ms - b.t_ms), selected: null,
    offset: resumed ? Math.max(0, Date.now() - started) : 0, // t_ms is counted from the meeting start
    vads: { rep: new Vad(), customer: new Vad() },
  };
  c.uploader = createUploader({
    send: u => sam.upload(meeting.id, u.channel, u.tMs, u.durationMs, u.wav),
    onResult: data => onResult(c, data),
    onStatus: syncStatus,
  });
  localStorage.live = JSON.stringify({ id: meeting.id, framework: c.framework, company, contact });
  setMute(false);
  sam.setLive(true);
  c.timer = setInterval(tick, 1000); tick();
  $('bar-name').textContent = company; $('bar-sub').textContent = contact || '';
  $('transcript').open = false;
  for (const id of ['ask', 'cards', 'alerts']) delete $(id).dataset.sig;
  go('live');
  renderLive();
  syncStatus({ pending: 0 });
}
function onResult(c, data) {
  if (S.call !== c) return;
  if (data?.segment?.text) { c.segments.push(data.segment); c.segments.sort((a, b) => a.t_ms - b.t_ms); }
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
function tick() { if (S.call) $('timer').textContent = fmtDur(Date.now() - S.call.started); }
function syncStatus(s) {
  const state = s.auth ? 'auth' : s.failing ? 'retry' : s.pending > 2 ? 'busy' : 'ok', el = $('sync');
  el.dataset.state = state;
  el.textContent = { ok: '', busy: `${s.pending}`, retry: `Offline · ${s.pending}`, auth: 'Signed out' }[state];
  el.title = {
    ok: 'Synced with SAM', busy: `Sending ${s.pending} clips to SAM`,
    retry: `Can't reach SAM. ${s.pending} clip${s.pending === 1 ? '' : 's'} waiting; retrying automatically.`,
    auth: 'Your SAM session ended. Clips are kept; end the call and sign in again.',
  }[state];
  el.setAttribute('aria-label', el.title);
}
// One place for mute, so the track, the button and the next call's preview always agree.
function setMute(m) {
  S.muted = m; cap?.setMuted(m);
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

// ---------- ending
async function endCall() {
  const c = S.call;
  go('ending'); // stops capture
  ending('Saving the last few seconds', '');
  for (const ch of ['rep', 'customer']) for (const u of c.vads[ch].flush()) send(c, ch, u);
  c.vads = null;
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
  S.call = null;
  S.ended = { id: c.meeting.id, email: r.data?.summary?.follow_up_email };
  renderEnded(r.data?.summary || {}, { company: c.company, duration: fmtLen(Date.now() - c.started), flow: FLOW[String(r.data?.flow_status).split(':')[0]] });
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
  $('resume-name').textContent = saved.company;
  $('resume').hidden = false;
  $('resume-go').onclick = () => beginCall({ meeting: m, framework: r.data.framework ?? saved.framework, company: saved.company, contact: saved.contact, segments: r.data.segments ?? m.segments ?? [], resumed: true });
  $('resume-end').onclick = () => {
    const c = S.call = { meeting: m, company: saved.company, started: Date.parse(m.started_at) || Date.now(), uploader: { pending: () => 0 } };
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
$('sign-out').onclick = () => { sam.signOut(); S.user = null; go('signin'); };
$('settings-done').onclick = () => go(S.user ? 'start' : 'signin');
$('btn-settings').onclick = () => go('settings');
for (const b of document.querySelectorAll('[data-go]')) b.onclick = () => go(b.dataset.go);
$('btn-min').onclick = () => sam.window('minimize');
$('btn-close').onclick = () => sam.window('hide');

// ---------- boot
sam.onNav(to => { if (to === 'start' && !S.call) go(S.user ? 'start' : 'signin'); });
sam.onVisible(v => { S.visible = v; syncCapture(); });
const st = await sam.state();
S.server = st.server; S.user = st.user;
go(S.user ? 'start' : 'signin');
