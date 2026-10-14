/** Speech to text for SAM Live through POST {base}/audio/transcriptions: OpenAI gpt-transcribe first
 *  (LIVE_STT_MODEL), then Groq whisper-large-v3-turbo (LIVE_STT_FALLBACK_MODEL) on any error or timeout.
 *  LIVE_STT_LANGUAGE defaults to en. Providers and order: lib/live/llm.ts. */
import { redact } from "../redact";
import { firstAnswer, legs, type Leg } from "./llm";
import { mockOn, mockTranscribe } from "./mock";

/** Biases recognition toward Accops' names and the market's vocabulary. The models read it as preceding
 *  text, so it is written as a sentence, not a bare list. */
export const VOCAB = "Accops call about HySecure, HyWorks, HyID, HyLabs, HyDesk, ZTNA, VDI, DaaS, MFA, SSO, Citrix, NetScaler, "
  + "Omnissa, VMware Horizon, AVD, Azure Virtual Desktop, Zscaler, Nutanix, RBI, SEBI, IRDAI, DPDP, ISO 27001.";

async function once(l: Leg, wav: Uint8Array, timeoutMs: number): Promise<string> {
  const form = new FormData();
  form.set("model", l.model);
  form.set("file", new Blob([wav as BlobPart], { type: "audio/wav" }), "utterance.wav");
  form.set("language", process.env.LIVE_STT_LANGUAGE || "en");
  form.set("prompt", VOCAB);
  // Whisper on Groq: temperature 0 for the most literal reading. OpenAI's transcribe models: not sent.
  if (!l.p.openai) form.set("temperature", "0");
  const r = await fetch(`${l.p.base}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${l.p.key}` }, body: form,
    signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(redact(`${r.status}: ${(await r.text()).slice(0, 200)}`));
  return String((await r.json()).text ?? "");
}

/** Raw transcription of one utterance (a WAV) and the model that made it. Throws NoModel when no provider
 *  answered (`unconfigured` when there is none). Use clean() on the text. */
export async function transcribe(wav: Uint8Array, at: { meetingId: string; channel: string }): Promise<{ text: string; model: string }> {
  if (mockOn()) return { text: mockTranscribe(at.meetingId, at.channel), model: "mock" };
  const { value, model } = await firstAnswer("stt", legs("stt"), Date.now() + 25_000, (l, ms) => once(l, wav, ms));
  return { text: value, model };
}

// What Whisper writes for silence, breath or line noise. Compared after lowercasing and trimming punctuation.
const HALLUCINATIONS = new Set(["thank you", "thank you very much", "thanks", "thanks for watching", "thank you for watching",
  "thanks for listening", "thank you for listening", "please subscribe", "like and subscribe", "subscribe", "you", "bye", "bye bye",
  "i'll see you next time", "see you next time", "see you in the next video", "so", "uh", "um", "hmm", "oh",
  "subtitles by the amaraorg community", "music", "applause"]);
const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const VOCAB_WORDS = new Set(words(VOCAB));

/** "" for nothing worth keeping: empty or punctuation, a known silence hallucination, the same short phrase
 *  looping, or the vocabulary prompt echoed back (Whisper does that on silence when given a prompt).
 *  ponytail: a phrase list; Whisper's verbose_json no_speech_prob is the upgrade if these slip through. */
export function clean(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!/[\p{L}\p{N}]/u.test(t)) return "";
  const bare = t.toLowerCase().replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "").replace(/[.!?,]+/g, "").replace(/\s+/g, " ");
  if (HALLUCINATIONS.has(bare)) return "";
  if (/^(.{2,40}?)(?:[\s,.!?]+\1){3,}[\s.!?]*$/i.test(t)) return "";
  // Five or more words, all from the prompt: an echo. A rep naming three competitors in a row is not.
  const w = words(t);
  if (w.length >= 5 && w.every(x => VOCAB_WORDS.has(x))) return "";
  return t;
}
