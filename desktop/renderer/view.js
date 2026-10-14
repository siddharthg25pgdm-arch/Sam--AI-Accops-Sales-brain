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

export function renderCards(cards, open) {
  $('cards-block').hidden = !cards.length;
  if (same($('cards'), cards)) return;
  $('cards').replaceChildren(...cards.map(c => h('article', { class: 'card battle' },
    h('div', { class: 'battle-head' },
      h('span', { class: 'eyebrow' }, c.trigger || 'Battlecard'),
      h('span', { class: c.shareable ? 'tag public' : 'tag' }, c.shareable ? 'Shareable' : 'Internal'),
      /^https?:\/\//i.test(c.link || '') && h('button', { type: 'button', class: 'btn sm', onclick: () => open(c.link) }, 'Open', h('span', { 'aria-hidden': 'true' }, '↗'))),
    h('p', { class: 't' }, c.title),
    c.brief && h('p', { class: 'brief' }, c.brief),
  )));
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
  list.replaceChildren(...segs.slice(-60).map(s => h('li', { 'data-ch': s.channel }, h('b', {}, SPEAKER[s.channel] ?? s.channel), s.text)));
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
  $('ended-meta').textContent = [meta.duration, meta.flow].filter(Boolean).join(' · ');
  $('overview').textContent = summary.overview || 'SAM returned no overview for this call.';
  const steps = (summary.next_steps ?? []).map(s => typeof s === 'string' ? s : s?.text ?? s?.step ?? '').filter(Boolean);
  $('steps-block').hidden = !steps.length;
  $('next-steps').replaceChildren(...steps.map(s => h('li', {}, s)));
  $('email-subj').textContent = summary.follow_up_email?.subject ?? '';
  $('email-body').textContent = summary.follow_up_email?.body ?? '';
}
