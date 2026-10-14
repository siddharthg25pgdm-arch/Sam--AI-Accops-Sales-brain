// TEST ONLY. Run: node desktop/scripts/stub-server.mjs [port] - a fake SAM implementing the /api/live/* contract
// (docs/live/2026-10-14-sam-live-design.md) with canned answers. Every 3rd audio upload returns an insight.
// Test hooks: GET /__stub/state (uploads + meetings), POST /__stub/fail?n=3 (next n audio uploads answer 503),
// POST /__stub/slow-end?ms=2000 (delay /end, to see the summarising state).
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TOKEN = 'stub-token';
export const FRAMEWORK = [
  ['need', 'Need', 'pain, why now'], ['current_solution', 'Current setup', 'Citrix, Horizon, AVD, none'],
  ['users', 'Users', 'how many, which user types'], ['use_case', 'Use case', 'remote work, BYOD, contractors, DR'],
  ['compliance', 'Compliance', 'RBI, SEBI, DPDP, IRDAI, ISO'], ['budget', 'Budget', 'is money set aside'],
  ['decision_maker', 'Decision maker', 'who signs, who evaluates'], ['timeline', 'Timeline', 'when it has to be live'],
  ['competition', 'Competition', 'who else they are looking at'], ['next_step', 'Next step', 'what was agreed'],
].map(([key, label, hint]) => ({ key, label, hint }));

const DEALS = [
  { id: 'd-northwind', company: 'Northwind Bank', contact_name: 'Rahul Mehta', contact_email: 'rahul.mehta@northwindbank.example', last_meeting_at: '2026-10-03T10:30:00Z',
    qualification: { need: { status: 'done', value: 'Secure remote access for 1,200 branch and remote staff', evidence: 'we need branch staff to work from home safely' } } },
  { id: 'd-contoso', company: 'Contoso Life', contact_name: 'Priya Nair', contact_email: 'priya.nair@contosolife.example', last_meeting_at: '2026-09-22T06:00:00Z', qualification: {} },
  { id: 'd-fabrikam', company: 'Fabrikam Steel', contact_name: 'Vikram Rao', contact_email: 'vikram.rao@fabrikamsteel.example', last_meeting_at: null, qualification: {} },
];
const LINES = {
  customer: [
    'We have around twelve hundred users on Citrix today and the renewal comes up in March.',
    'Our CISO wants all of the data to stay inside India because of the RBI guidelines.',
    'Honestly the Citrix licence cost went up a lot this year, that is the main pain.',
    'Contractors and branch staff are the biggest group, a lot of them on their own laptops.',
    'The final call is with our CIO, but the infra team will run the evaluation.',
  ],
  rep: [
    'Could you walk me through how remote access works for your teams today?',
    'And roughly how many people would need access on day one?',
    'Is there a budget set aside for this in the current financial year?',
  ],
};
const INSIGHTS = [
  { qualification: { need: { status: 'done', value: 'Cut remote-access cost before the Citrix renewal', evidence: 'the Citrix licence cost went up a lot this year' },
      current_solution: { status: 'done', value: 'Citrix, about 1,200 users, renewal in March', evidence: 'twelve hundred users on Citrix today' },
      users: { status: 'partial', value: '~1,200 incl. contractors', evidence: 'around twelve hundred users' } },
    ask_next: [
      { key: 'budget', question: 'Is budget for the switch set aside this financial year, or does it ride on the Citrix renewal money?', why: 'They named cost as the pain but not who pays.' },
      { key: 'timeline', question: 'When in March does the Citrix renewal lock in?', why: 'The renewal date is the real deadline.' },
    ],
    battlecards: [{ trigger: 'Competitor · Citrix', title: 'Accops vs Citrix: 3-year TCO and migration plan', brief: 'Per-user cost comparison at 1,000+ seats, side-by-side feature parity, and the 6-week migration runbook used at two Indian banks.', link: 'https://www.accops.com/citrix-alternative', shareable: true }],
    alerts: [] },
  { qualification: { compliance: { status: 'done', value: 'RBI data localisation; data must stay in India', evidence: 'data to stay inside India because of the RBI guidelines' },
      use_case: { status: 'done', value: 'Contractors and branch staff on BYOD', evidence: 'a lot of them on their own laptops' } },
    ask_next: [
      { key: 'decision_maker', question: 'Who besides the CIO signs off, and who runs the technical evaluation?', why: 'Only the CISO has come up so far.' },
      { key: 'budget', question: 'Is the budget approved or still to be raised?', why: 'Still open.' },
    ],
    // like the real server: only cards not shown earlier in the call (the client keeps the earlier ones)
    battlecards: [{ trigger: 'Objection · data residency', title: 'RBI data-localisation checklist for HySecure', brief: 'Where every byte lives in an on-prem HySecure deployment, mapped to the RBI master direction clauses.', link: 'https://sam-accops.vercel.app/open/rbi-checklist', shareable: false }],
    alerts: ['Deadline: the Citrix renewal is in March.'] },
  { qualification: { decision_maker: { status: 'partial', value: 'CIO signs; infra team evaluates', evidence: 'The final call is with our CIO' },
      budget: { status: 'partial', value: 'Tied to the Citrix renewal budget', evidence: '' }, timeline: { status: 'done', value: 'Live before the March renewal', evidence: 'the renewal comes up in March' },
      competition: { status: 'partial', value: 'Citrix renewal is the default', evidence: '' } },
    ask_next: [{ key: 'next_step', question: 'Shall we book a technical session with the infra team next week?', why: 'Lock the evaluation before the renewal clock runs down.' }],
    battlecards: [], alerts: [] },
];

export function startStub({ port = 0 } = {}) {
  const uploads = [], meetings = new Map(), state = { failNext: 0, audioCalls: 0, endDelay: 0 };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://stub');
    const body = await new Promise(r => { const parts = []; req.on('data', d => parts.push(d)); req.on('end', () => r(Buffer.concat(parts))); });
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const json = () => { try { return JSON.parse(body.toString() || '{}'); } catch { return {}; } };
    const p = url.pathname;

    if (p === '/__stub/state') return send(200, { uploads, meetings: [...meetings.values()] });
    if (p === '/__stub/fail') { state.failNext = Number(url.searchParams.get('n') || 1); return send(200, { ok: true }); }
    if (p === '/__stub/slow-end') { state.endDelay = Number(url.searchParams.get('ms') || 0); return send(200, { ok: true }); }
    if (p === '/api/live/login' && req.method === 'POST') {
      const { id, password } = json();
      if (!id || password === 'wrong') return send(401, { error: 'Wrong login ID or password.' });
      return send(200, { token: TOKEN, user: { id: String(id).toLowerCase(), admin: false } });
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'Not signed in.' });

    if (p === '/api/live/deals' && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      return send(200, { deals: DEALS.filter(d => d.company.toLowerCase().includes(q)).map(({ qualification, ...d }) => d) });
    }
    if (p === '/api/live/meetings' && req.method === 'POST') {
      const b = json();
      const deal = b.deal_id ? DEALS.find(d => d.id === b.deal_id) : { id: randomUUID(), company: b.company, contact_name: b.contact_name, qualification: {} };
      if (!deal?.company) return send(400, { error: 'company or deal_id required' });
      const meeting = { id: randomUUID(), deal_id: deal.id, title: b.title ?? null, started_at: new Date().toISOString(), status: 'live',
        qualification: structuredClone(deal.qualification), suggestions: [], battlecards: [], segments: [], request: b };
      meetings.set(meeting.id, meeting);
      const { segments, request, status, suggestions, battlecards, ...pub } = meeting;
      return send(200, { meeting: pub, framework: FRAMEWORK });
    }
    const m = p.match(/^\/api\/live\/meetings\/([\w-]+)(\/audio|\/end)?$/), meeting = m && meetings.get(m[1]);
    if (!m) return send(404, { error: 'not found' });
    if (!meeting) return send(404, { error: 'meeting not found' });

    if (m[2] === '/audio' && req.method === 'POST') {
      const ok = body.length > 44 && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WAVE';
      const rec = { meeting: meeting.id, channel: url.searchParams.get('channel'), t_ms: Number(url.searchParams.get('t_ms')), duration_ms: Number(url.searchParams.get('duration_ms')),
        bytes: body.length, wav_ms: ok ? Math.round(body.readUInt32LE(40) / body.readUInt32LE(28) * 1000) : null, type: req.headers['content-type'], at: Date.now(), status: 200 };
      uploads.push(rec);
      if (state.failNext > 0) { state.failNext--; rec.status = 503; return send(503, { error: 'stub: injected failure' }); }
      if (!ok || !['rep', 'customer'].includes(rec.channel)) { rec.status = 400; return send(400, { error: 'expected a WAV body and channel' }); }
      const n = ++state.audioCalls, lines = LINES[rec.channel];
      const segment = { id: n, channel: rec.channel, t_ms: rec.t_ms, text: lines[(n - 1) % lines.length] };
      meeting.segments.push(segment);
      const out = { segment };
      if (n % 3 === 0) {
        const ins = structuredClone(INSIGHTS[Math.min(n / 3 - 1, INSIGHTS.length - 1)]);
        Object.assign(meeting.qualification, ins.qualification);
        ins.qualification = meeting.qualification; // the server returns the merged state
        meeting.suggestions = ins.ask_next; meeting.battlecards.push(...ins.battlecards);
        out.insight = ins;
      }
      return send(200, out);
    }
    if (m[2] === '/end' && req.method === 'POST') {
      if (state.endDelay) await new Promise(r => setTimeout(r, state.endDelay));
      meeting.status = 'ended'; meeting.ended_at = new Date().toISOString();
      const company = DEALS.find(d => d.id === meeting.deal_id)?.company ?? meeting.request.company;
      return send(200, { flow_status: 'sent', summary: {
        overview: `${company} runs about 1,200 users on Citrix and wants to cut cost before the March renewal. Data has to stay in India (RBI). The CIO signs; the infra team will evaluate. They are open to a technical session next week.`,
        pains: ['Citrix licence cost rising', 'RBI data localisation'], qualification: meeting.qualification,
        objections: ['Data residency'], competitors: ['Citrix'],
        next_steps: ['Send the Citrix vs Accops TCO sheet to Rahul by Friday', 'Book a technical session with the infra team next week', 'Share the RBI data-localisation checklist'],
        follow_up_email: { subject: `Accops and ${company}: next steps from today's call`, body: `Hi Rahul,\n\nThank you for the time today. As promised, I am attaching the 3-year cost comparison against your current Citrix setup and the RBI data-localisation checklist for HySecure.\n\nCould we set up a 45-minute technical session with your infra team next week? Tuesday or Thursday afternoon works on our side.\n\nBest regards,` },
        deal_score: 72, risks: ['Budget not yet confirmed'],
      } });
    }
    if (!m[2] && req.method === 'GET') {
      const { segments, request, ...pub } = meeting;
      return send(200, { meeting: pub, segments });
    }
    send(405, { error: 'method not allowed' });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, uploads, meetings,
    failNext: n => { state.failNext = n; }, slowEnd: ms => { state.endDelay = ms; },
    close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }),
  })));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await startStub({ port: Number(process.argv[2] || 8787) });
  console.log(`SAM stub listening on ${s.url} (login with any id; password "wrong" fails)`);
}
