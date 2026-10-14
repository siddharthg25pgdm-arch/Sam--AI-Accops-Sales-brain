// DOM rendering for the live and ended screens. Server text only ever enters the page as text nodes.
export const $ = id => document.getElementById(id);

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter(k => k != null && k !== false && k !== ''));
  return el;
}

// Skip re-rendering identical data, so cards only animate in when they actually change.
const same = (el, data) => { const sig = JSON.stringify(data ?? null); if (el.dataset.sig === sig) return true; el.dataset.sig = sig; return false; };

const SPEAKER = { rep: 'Accops', customer: 'Customer' };
const STATUS = { done: 'Captured', partial: 'Partly captured', open: 'Still open' };

export function renderAlerts(alerts) {
  if (!same($('alerts'), alerts)) $('alerts').replaceChildren(...alerts.map(a => h('p', { class: 'alert' }, a)));
}

export function renderAsk(list, labels) {
  if (same($('ask'), list)) return;
  $('ask').replaceChildren(...(list.length ? list.map(a => h('article', { class: 'card ask' },
    h('span', { class: 'eyebrow' }, labels[a.key] ?? a.key),
    h('p', { class: 'question' }, a.question),
    a.why && h('p', { class: 'why' }, a.why),
  )) : [h('p', { class: 'empty' }, 'Listening. What to ask next shows up here as the customer talks.')]));
}

const battleCard = (c, open) => h('article', { class: 'card battle' },
  h('div', { class: 'battle-head' },
    h('span', { class: 'eyebrow' }, c.trigger || 'Battlecard'),
    h('span', { class: c.shareable ? 'tag public' : 'tag' }, c.shareable ? 'Shareable' : 'Internal'),
    /^https?:\/\//i.test(c.link || '') && h('button', { type: 'button', class: 'btn sm', onclick: () => open(c.link) }, 'Open', h('span', { 'aria-hidden': 'true' }, '↗'))),
  h('p', { class: 't' }, c.title),
  c.brief && h('p', { class: 'brief' }, c.brief),
);

export function renderCards(cards, open) {
  $('cards-block').hidden = !cards.length;
  if (same($('cards'), cards)) return;
  $('cards').replaceChildren(...cards.map(c => battleCard(c, open)));
}

// Assist: "What do I say next?" and "Ask SAM…". Web links open in the browser, http(s) only.
const httpUrl = u => { try { const x = new URL(u); return ['https:', 'http:'].includes(x.protocol) ? x.href : null; } catch { return null; } };
const label = s => String(s || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

/** r: null | { mode: 'next'|'search', question?, loading?, error?, data? } */
export function renderAssist(r, open, close) {
  const out = $('assist-out');
  out.hidden = !r;
  if (!r) return out.replaceChildren();
  const head = h('div', { class: 'ao-head' },
    h('span', { class: r.mode === 'search' ? 'eyebrow q' : 'eyebrow' }, r.mode === 'search' ? `“${r.question}”` : 'Say next'),
    !r.loading && h('button', { type: 'button', class: 'x', title: 'Close', 'aria-label': 'Close', onclick: close }, '×'));
  if (r.loading) return out.replaceChildren(head, h('p', { class: 'ao-wait' }, h('span', { class: 'spinner sm', 'aria-hidden': 'true' }),
    r.mode === 'search' ? 'Searching SAM and the web…' : 'Thinking about your next line…'));
  if (r.error) return out.replaceChildren(head, h('p', { class: 'err' }, r.error));
  const d = r.data || {}, cards = Array.isArray(d.cards) ? d.cards.slice(0, 4) : [], web = d.web?.answer ? d.web : null;
  const say = d.say?.line ? d.say : null;
  const parts = [head];
  if (say) parts.push(h('article', { class: 'card say' },
    say.intent && h('span', { class: 'tag intent' }, label(say.intent)),
    h('p', { class: 'line' }, say.line),
    say.why && h('p', { class: 'why' }, say.why)));
  if (cards.length) parts.push(h('div', { class: 'cards' }, ...cards.map(c => battleCard(c, open))));
  if (web) {
    const sources = (Array.isArray(web.sources) ? web.sources : []).slice(0, 5);
    parts.push(h('article', { class: 'card web' },
      h('span', { class: 'eyebrow web-label' }, 'From the web — check before sharing'),
      h('p', { class: 'answer' }, web.answer),
      sources.length > 0 && h('ul', { class: 'sources' }, ...sources.map(s => {
        const u = httpUrl(s?.url), name = s?.title || (u ? new URL(u).host : '');
        return h('li', {}, u ? h('button', { type: 'button', class: 'link', title: u, onclick: () => open(u) }, name, h('span', { 'aria-hidden': 'true' }, ' ↗')) : h('span', {}, name));
      }))));
  }
  if (!say && !cards.length && !web) parts.push(h('p', { class: 'empty' }, r.mode === 'search' ? 'SAM found nothing for that.' : 'No suggestion right now. Try again in a moment.'));
  out.replaceChildren(...parts);
}

export function renderQual(framework, qual, selected, onSelect) {
  const done = framework.filter(f => qual[f.key]?.status === 'done').length;
  $('q-count').textContent = `${done} of ${framework.length}`;
  $('qual').replaceChildren(...framework.map(f => {
    const v = qual[f.key] ?? {}, s = STATUS[v.status] ? v.status : 'open';
    return h('button', {
      type: 'button', class: 'qi', 'data-s': s, 'aria-expanded': String(selected === f.key),
      title: v.value ? `${f.label}: ${v.value}` : `${f.label}: ${STATUS[s].toLowerCase()}`,
      onclick: () => onSelect(selected === f.key ? null : f.key),
    }, h('i', { class: 'ic', role: 'img', 'aria-label': STATUS[s] }), h('span', { class: 'lab' }, f.label));
  }));
  const f = framework.find(x => x.key === selected), d = $('q-detail');
  d.hidden = !f;
  if (!f) return;
  const v = qual[f.key] ?? {};
  d.replaceChildren(
    h('div', { class: 'qd-head' }, h('b', {}, f.label), h('span', {}, STATUS[v.status] ?? STATUS.open)),
    v.value ? h('p', { class: 'v' }, v.value) : h('p', { class: 'v muted' }, f.hint ? `Find out: ${f.hint}` : 'Not covered yet.'),
    v.evidence && h('blockquote', {}, `“${v.evidence}”`),
  );
}

export function renderTranscript(segs) {
  const list = $('t-list'), atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.replaceChildren(...segs.slice(-60).map(s => h('li', { 'data-ch': s.channel, 'data-id': s.id }, h('b', {}, SPEAKER[s.channel] ?? s.channel), s.text)));
  if (atEnd) list.scrollTop = list.scrollHeight;
  const last = segs.at(-1);
  $('t-last').textContent = last ? `${SPEAKER[last.channel] ?? ''}: ${last.text}` : 'Nothing yet';
}

export function renderEnded(summary, meta) {
  const score = Math.max(0, Math.min(100, Math.round(Number(summary.deal_score) || 0)));
  $('score').textContent = score;
  $('ring').style.setProperty('--p', score);
  $('ring').dataset.band = score >= 70 ? 'good' : score >= 40 ? 'mid' : 'low';
  $('ended-company').textContent = meta.company;
  $('ended-meta').textContent = [meta.duration, meta.flow, meta.detected].filter(Boolean).join(' · ');
  $('overview').textContent = summary.overview || 'SAM returned no overview for this call.';
  const steps = (summary.next_steps ?? []).map(s => typeof s === 'string' ? s : s?.text ?? s?.step ?? '').filter(Boolean);
  $('steps-block').hidden = !steps.length;
  $('next-steps').replaceChildren(...steps.map(s => h('li', {}, s)));
  $('email-subj').textContent = summary.follow_up_email?.subject ?? '';
  $('email-body').textContent = summary.follow_up_email?.body ?? '';
}
