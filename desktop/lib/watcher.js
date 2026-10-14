// Spots meeting apps via `tasklist` so SAM Live can offer to start listening.
import { execFile } from 'node:child_process';

// Lower-case image names. New Teams is ms-teams.exe, classic Teams.exe; Zoom meetings run in Zoom.exe
// (CptHost.exe while sharing); Webex Meetings runs atmgr.exe during a meeting.
export const APPS = {
  Teams: ['ms-teams.exe', 'teams.exe'],
  Zoom: ['zoom.exe', 'cpthost.exe'],
  Webex: ['webex.exe', 'ciscocollabhost.exe', 'atmgr.exe', 'webexmta.exe'],
};

/** Meeting apps present in `tasklist /fo csv /nh` output. */
export function meetingApps(csv) {
  const names = new Set(csv.split(/\r?\n/).map(l => (l.match(/^"([^"]+)"/)?.[1] ?? '').toLowerCase()));
  return Object.keys(APPS).filter(a => APPS[a].some(n => names.has(n)));
}

/** Feed tasklist snapshots; onAppear fires once per run of an app and re-arms when the app exits. */
export function appearances(onAppear) {
  let seen = new Set();
  return csv => {
    const now = new Set(meetingApps(csv));
    for (const a of now) if (!seen.has(a)) onAppear(a);
    seen = now;
  };
}

export function watchMeetingApps(onAppear, everyMs = 20000) {
  const feed = appearances(onAppear);
  const tick = () => execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true }, (err, out) => { if (!err) feed(out); });
  tick();
  return setInterval(tick, everyMs);
}
