/** LIVE_MOCK=1: speech-to-text plays a scripted discovery call and the insight and summary "models" answer
 *  with keyword rules over the transcript, so desktop -> API -> Supabase -> dashboard runs locally with no
 *  Groq key. The replies are JSON text, so the real parse, merge and battlecard paths still run.
 *  Off in production whatever the env says. */
import { namedEntities } from "../cards";
import { COMPETITORS, FRAMEWORK, type Field, type Qualification } from "./framework";

export function mockOn(): boolean {
  return process.env.LIVE_MOCK === "1" && process.env.VERCEL_ENV !== "production";
}

/** A bank CIO on Citrix: ~1,200 users, RBI audit pressure, renewal in March, also looking at Omnissa. */
export const SCRIPT: { channel: "rep" | "customer"; text: string }[] = [
  { channel: "rep", text: "Hi Rajesh, thanks for making the time today. Before I show anything, what prompted you to look at alternatives right now?" },
  { channel: "customer", text: "Sure. The main trigger is our last RBI inspection. They flagged that unmanaged devices can reach the core banking network through our remote access, and we have to close that before the next audit." },
  { channel: "rep", text: "That makes sense. What are you running today for remote access and virtual desktops?" },
  { channel: "customer", text: "We're on Citrix Virtual Apps with NetScaler for remote access, and the new licence pricing is almost double what we paid three years ago." },
  { channel: "rep", text: "Got it. Roughly how many users are on it, and what kind of users are they?" },
  { channel: "customer", text: "About 1,200 users. Around 900 are branch and operations staff, and roughly 150 vendor engineers need access to specific servers." },
  { channel: "rep", text: "And which use cases matter most for you?" },
  { channel: "customer", text: "Mostly branch staff on thin clients, work from home for the operations team, and the vendors. Disaster recovery is on the list too." },
  { channel: "rep", text: "You mentioned the audit. Which regulations are you being measured against?" },
  { channel: "customer", text: "RBI's cyber security framework mainly, and the IT outsourcing directions for the vendor access piece. Our CISO also wants us aligned with ISO 27001." },
  { channel: "rep", text: "Who else is involved in the decision on your side?" },
  { channel: "customer", text: "I own the evaluation with my infrastructure head, but the CISO has to sign off on security and the final approval goes to our MD." },
  { channel: "rep", text: "Is there budget set aside for this, or does it depend on the business case?" },
  { channel: "customer", text: "We have budget for the renewal, so if the alternative costs less it's an easy conversation, but I can't share the exact number yet." },
  { channel: "rep", text: "Fair enough. Are you evaluating anyone else besides us?" },
  { channel: "customer", text: "We're also looking at Omnissa Horizon, since some of the team have used VMware before." },
  { channel: "rep", text: "And what timeline are you working towards?" },
  { channel: "customer", text: "We need something live before the March renewal, so a decision by end of January." },
  { channel: "rep", text: "Understood. What worries you most about moving off Citrix?" },
  { channel: "customer", text: "My concern is migration. We can't have branch downtime during business hours, and our users are used to the Citrix workflow." },
  { channel: "rep", text: "Would a two-week proof of concept with fifty branch users help?" },
  { channel: "customer", text: "How does your pricing compare for 1,200 concurrent users? And do you support MFA for the vendor access?" },
  { channel: "rep", text: "We do, with HyID. I'll send the HySecure and HyWorks material today and set up the technical session for Thursday." },
  { channel: "customer", text: "A proof of concept works for us, so let's do the technical session next Thursday with my infrastructure head." },
];

// One counter per meeting and channel, per process: the dev server is one process.
const g = globalThis as unknown as { __samLiveMock?: Map<string, number> };
export function mockTranscribe(meetingId: string, channel: string): string {
  const seen = (g.__samLiveMock ??= new Map());
  const k = `${meetingId}:${channel}`, i = seen.get(k) ?? 0;
  seen.set(k, i + 1);
  return SCRIPT.filter(l => l.channel === channel)[i]?.text ?? "";
}

const said = (t: string) => t.split("\n").map(l => l.match(/^(Accops|Customer): (.*)$/)).filter(m => m !== null).map(m => ({ who: m[1], text: m[2] }));
const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean);
const HEDGE = /\b(can't share|cannot share|not sure|don't know|depends|maybe|not yet|tbd)\b/i;
const OBJECTIONS: [RegExp, string][] = [[/\b(migrat\w*|downtime|disrupt\w*)\b/i, "migration downtime"], [/\b(pric\w*|cost\w*|expensive|double)\b/i, "price"],
  [/\b(latency|slow|performance)\b/i, "performance"], [/\b(workflow|retrain\w*|used to)\b/i, "user change"]];

/** The rules both mock replies share: the first customer sentence that cues a field answers it (each
 *  sentence answers one field); the value is its first clause, the evidence the whole sentence. */
function analyse(text: string) {
  const cust = said(text).filter(l => l.who === "Customer"), custText = cust.map(l => l.text).join(" ");
  const qualification: Qualification = {}, used = new Set<string>();
  for (const f of FRAMEWORK) {
    const s = cust.flatMap(l => sentences(l.text)).find(x => !used.has(x) && f.cue.test(x));
    if (!s) continue;
    used.add(s);
    const value = s.split(/,\s+(?:and|but|so|since)\s+|;\s+/)[0].replace(/[.!?]+$/, "").slice(0, 140);
    qualification[f.key] = { status: HEDGE.test(s) ? "partial" : "done", value, evidence: s } satisfies Field;
  }
  return {
    qualification, custText,
    competitors: namedEntities(custText).filter(e => COMPETITORS.has(e)),
    objections: OBJECTIONS.filter(([re]) => re.test(custText)).map(([, label]) => label),
    questions: cust.flatMap(l => sentences(l.text)).filter(s => s.endsWith("?")),
  };
}

export function mockInsightReply(tail: string): string {
  const a = analyse(tail);
  const open = FRAMEWORK.filter(f => a.qualification[f.key]?.status !== "done").slice(0, 3);
  return JSON.stringify({
    qualification: a.qualification,
    ask_next: open.map(f => ({ key: f.key, question: f.question, why: `Not covered yet: ${f.hint.toLowerCase()}.` })),
    customer_questions: a.questions, competitors: a.competitors, objections: a.objections,
    alerts: a.competitors.filter(c => c !== "Citrix").map(c => `${c} is in the running`),
  });
}

export function mockSummaryReply(text: string, ctx: { rep: string; company: string; contact: string | null }): string {
  const a = analyse(text), q = a.qualification, v = (k: string) => q[k]?.value;
  const rep = said(text).filter(l => l.who === "Accops").flatMap(l => sentences(l.text));
  const next = [v("next_step"), ...rep.filter(s => /\b(I'll|I will|we'll|we will)\b/i.test(s))].filter((s): s is string => Boolean(s));
  const hi = ctx.contact?.split(" ")[0] ?? "there";
  return JSON.stringify({
    overview: [`Discovery call with ${ctx.contact ?? "the customer"} at ${ctx.company}.`, v("need") && `Why now: ${v("need")}.`,
      v("current_solution") && `Today: ${v("current_solution")}.`, v("next_step") && `Agreed: ${v("next_step")}.`].filter(Boolean).join(" "),
    pains: a.custText ? sentences(a.custText).filter(s => /\b(flagged|double|concern|can't|unmanaged)\b/i.test(s)).slice(0, 3) : [],
    qualification: q, objections: a.objections, competitors: a.competitors, next_steps: next.slice(0, 4),
    follow_up_email: {
      subject: `${ctx.company}: next steps from today's call`,
      body: [`Hi ${hi},`, "", "Thank you for the time today. What I heard matters most:",
        ...[v("need"), v("current_solution"), v("users")].filter(Boolean).map(x => `- ${x}`), "",
        ...(next.length ? ["Next steps:", ...next.slice(0, 3).map(x => `- ${x}`), ""] : []), "Best regards,", ctx.rep].join("\n"),
    },
    // No deal_score: readSummary then scores the merged qualification, so a short second call on a
    // well-qualified deal does not read as a cold one.
    risks: [...a.competitors.filter(c => c !== "Citrix").map(c => `Also evaluating ${c}`), ...(q.budget?.status !== "done" ? ["Budget not confirmed"] : [])],
  });
}
