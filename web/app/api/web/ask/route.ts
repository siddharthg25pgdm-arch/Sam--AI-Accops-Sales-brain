import { after } from "next/server";
import { ask } from "@/lib/web/answer";

// The model call is bounded (OpenAI 6 s + Groq 4 s); the rest is a few RPCs.
export const maxDuration = 20;

/** The website chatbot's answer endpoint (plan 3.3, 6). Same-origin only, from our own /embed iframe. */
export async function POST(req: Request) {
  const r = await ask(req);
  if (r.log) after(r.log); // logging never blocks the answer
  return Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
