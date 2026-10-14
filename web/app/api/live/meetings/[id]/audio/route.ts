import { ownMeeting } from "@/lib/live/access";
import { maybeInsight } from "@/lib/live/insight";
import { NoModel } from "@/lib/live/llm";
import { ECHO_WINDOW_MS, isEcho } from "@/lib/live/echo";
import { addSegment, deleteSegments, findSegment, segmentsBetween } from "@/lib/live/store";
import { clean, transcribe } from "@/lib/live/stt";
import { redact } from "@/lib/redact";

// Speech-to-text (~3 s; up to 25 s with the fallback) plus, at most every 12 s, an insight (up to 11 s).
export const maxDuration = 60;
// Vercel refuses request bodies over 4.5 MB before this code runs; a 15 s utterance is ~0.5 MB.
const MAX_BYTES = 4 * 1024 * 1024;
const int = (v: string | null) => (v !== null && /^\d{1,9}$/.test(v) ? Number(v) : null);
const isWav = (b: Uint8Array) => b.byteLength > 44 && new TextDecoder().decode(b.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(b.subarray(8, 12)) === "WAVE";

/** POST /api/live/meetings/:id/audio?channel=rep|customer&t_ms=&duration_ms=   body: one utterance, raw audio/wav
 *  -> {segment:{id, channel, t_ms, text, model} | null, dropped?: "echo", removed_segment_ids?: number[], insight?}.
 *  segment is null when nothing worth keeping was said; dropped:"echo" when a rep utterance is the customer's
 *  speech picked up by the mic (lib/live/echo.ts); removed_segment_ids = rep segments a customer utterance
 *  showed to be such echoes, now deleted. insight is present only when one ran. A failed insight never fails
 *  the upload. A retried upload (same channel and t_ms) gets the stored segment back without a second
 *  transcription. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const got = await ownMeeting(req, params);
  if (got instanceof Response) return got;
  const { m } = got;
  if (m.status !== "live") return Response.json({ error: "This call has ended." }, { status: 409 });
  const q = new URL(req.url).searchParams;
  const channel = q.get("channel"), t_ms = int(q.get("t_ms")), duration_ms = int(q.get("duration_ms"));
  if (channel !== "rep" && channel !== "customer") return Response.json({ error: "channel must be rep or customer." }, { status: 400 });
  if (t_ms === null) return Response.json({ error: "t_ms must be the utterance's start, in whole milliseconds from the start of the call." }, { status: 400 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return Response.json({ error: "At most 4 MB per utterance." }, { status: 413 });
  const wav = new Uint8Array(await req.arrayBuffer());
  if (wav.byteLength > MAX_BYTES) return Response.json({ error: "At most 4 MB per utterance." }, { status: 413 });
  if (!isWav(wav)) return Response.json({ error: "Send one utterance as audio/wav (RIFF/WAVE)." }, { status: 415 });

  const dup = await findSegment(m.id, channel, t_ms);
  if (dup) return Response.json({ segment: { id: dup.id, channel: dup.channel, t_ms: dup.t_ms, text: dup.text } });
  let heard: { text: string; model: string };
  try {
    heard = await transcribe(wav, { meetingId: m.id, channel });
  } catch (e) {
    if (e instanceof NoModel && e.unconfigured) return Response.json({ error: "Speech-to-text is not configured on the server." }, { status: 503 });
    console.error("live stt failed", redact(e));
    return Response.json({ error: "Speech-to-text failed. Keep the audio and retry." }, { status: 502 });
  }
  const text = clean(heard.text);
  if (!text) return Response.json({ segment: null });
  // Store first, then look for echoes on the other channel: of a rep and a customer upload racing each
  // other, whichever stores second sees the first.
  const seg = await addSegment({ meeting_id: m.id, channel, t_ms, duration_ms, text });
  const other = channel === "rep" ? "customer" : "rep";
  const near = (await segmentsBetween(m.id, other, t_ms - ECHO_WINDOW_MS - 16_000, t_ms + (duration_ms ?? 0) + ECHO_WINDOW_MS))
    .filter(o => channel === "rep" ? isEcho(seg, o) : isEcho(o, seg));
  if (channel === "rep" && near.length) {
    await deleteSegments(m.id, [seg.id]);
    return Response.json({ segment: null, dropped: "echo" });
  }
  const removed = near.map(o => o.id);
  await deleteSegments(m.id, removed);
  const insight = await maybeInsight(m.id);
  return Response.json({ segment: { id: seg.id, channel: seg.channel, t_ms: seg.t_ms, text: seg.text, model: heard.model },
    ...(removed.length ? { removed_segment_ids: removed } : {}), ...(insight ? { insight } : {}) });
}
