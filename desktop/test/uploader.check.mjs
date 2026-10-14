// Run: node desktop/test/uploader.check.mjs - per-channel order, retry/backoff, drops, drain.
import assert from 'node:assert';
import { createUploader, createQuality, QUALITY } from '../renderer/uploader.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const results = [], waits = [], statuses = [];
const script = { c1: [503, 0, 200], c2: [200], c3: [413], c4: [200], r1: [200], r2: [401, 200] }; // per-item responses, in turn
const sent = [];
const up = createUploader({
  send: async item => {
    sent.push(item.id);
    const s = script[item.id].shift();
    if (s === 0) throw new Error('offline');
    return { ok: s === 200, status: s, data: { segment: { text: item.id } } };
  },
  onResult: (data, item) => results.push(item.id),
  onStatus: s => statuses.push(s),
  sleep: ms => { waits.push(ms); return Promise.resolve(); },
});
for (const id of ['c1', 'c2', 'c3', 'c4']) up.push({ id, channel: 'customer' });
for (const id of ['r1', 'r2']) up.push({ id, channel: 'rep' });
ok(await up.drain(2000) === 0, 'everything settles');

const cust = results.filter(r => r[0] === 'c');
ok(cust.join() === 'c1,c2,c4', `customer results stay in order, 413 dropped: ${cust}`);
ok(results.filter(r => r[0] === 'r').join() === 'r1,r2', 'rep results in order after a 401 retry');
ok(sent.filter(s => s === 'c1').length === 3, 'c1 retried after 503 and a network error');
ok(sent.indexOf('c2') > sent.lastIndexOf('c1'), 'c2 waited for c1 (no overtaking)');
ok(sent.indexOf('r1') < sent.lastIndexOf('c1'), 'rep channel did not wait for the stuck customer channel');
ok([...waits].sort().join() === '1000,1000,2000', `backoff 1 s then 2 s for c1, 1 s for r2: ${waits}`);
ok(statuses.some(s => s.failing) && statuses.some(s => s.auth), 'failing and auth states were reported');
const last = statuses.at(-1);
ok(last.pending === 0 && !last.failing && !last.auth && last.dropped === 1, `final status clean with one drop: ${JSON.stringify(last)}`);

ok(statuses.filter(s => s.rttMs !== undefined).length === 5 && statuses.every(s => s.rttMs === undefined || s.rttMs >= 0), 'each accepted clip reports its round trip once');

// ---- connection-quality pill (fake clock)
const q = createQuality(), lv = [];
const at = (t, s) => lv.push(`${t / 1000}s:${q.note(s, t)}`);
at(0, { pending: 0, rttMs: 2500 });                     // healthy
at(1000, { pending: 1 });
at(2000, { pending: 1, rttMs: QUALITY.yellowRttMs + 1 }); // one slow clip
at(3000, { pending: 4 });                                // backlog building
at(4000, { pending: 4, failing: true });                 // network down
at(9000, { pending: 9, failing: true });
at(12000, { pending: 1, rttMs: 3000 });                  // back: red clears at once...
ok(lv.join(' ') === '0s:green 1s:green 2s:yellow 3s:yellow 4s:red 9s:red 12s:yellow', `escalates at once: ${lv.join(' ')}`);
ok(q.level(9000 + QUALITY.calmMs - 1) === 'yellow' && q.level(9000 + QUALITY.calmMs) === 'green', '...but stays yellow until calmMs after the last trouble, then green');
ok(createQuality().note({ pending: QUALITY.redQueue }, 0) === 'red' && createQuality().note({ auth: true }, 0) === 'red', 'a long queue or a lost session is red');
ok(createQuality().note({ rttMs: QUALITY.redRttMs }, 0) === 'red', 'a very slow round trip is red');

console.log(`uploader.check: ${n} assertions passed`);
