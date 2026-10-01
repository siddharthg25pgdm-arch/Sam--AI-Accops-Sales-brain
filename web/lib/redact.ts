/** Scrub secrets out of any text SAM shows, logs or stores.
 *
 *  Why this exists: on 1 Oct 2026 an OPENAI_API_KEY pasted three times (newline-separated) made
 *  fetch() throw `Headers.append: "Bearer sk-..." is an invalid header value`, and /api/v1/provider
 *  returned that message - the full key - in its JSON. Error text from fetch, providers and SDKs can
 *  carry request headers, so every error string is passed through here before it leaves the server
 *  or reaches sam_events. Belt and braces: the configured key values themselves, plus key-shaped
 *  patterns for anything not configured here. */

const PATTERNS: RegExp[] = [
  /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{16,}/g, // OpenAI
  /\bgsk_[A-Za-z0-9]{16,}/g,                            // Groq
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,                       // Anthropic
  /\bsb_secret_[A-Za-z0-9_-]{16,}/g,                    // Supabase secret keys
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
  /(Bearer\s+)[^\s"',;]+/gi,
];

const SECRET_ENV = ["OPENAI_API_KEY", "OPENAI_COMPAT_API_KEY", "ANTHROPIC_API_KEY", "SUPABASE_SERVICE_KEY",
  "SP_WEBHOOK_SECRET", "SAM_SESSION_SECRET", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "CRON_SECRET"];

export function redact(text: unknown): string {
  let s = typeof text === "string" ? text : text instanceof Error ? text.message : (() => { try { return JSON.stringify(text); } catch { return String(text); } })();
  for (const name of SECRET_ENV) {
    for (const part of (process.env[name] ?? "").split(/\s+/)) if (part.length >= 8) s = s.split(part).join("[redacted]");
  }
  for (const re of PATTERNS) s = s.replace(re, (m, bearer) => (typeof bearer === "string" && /^Bearer/i.test(bearer) ? `${bearer}[redacted]` : "[redacted]"));
  return s;
}

/** A key as pasted into Vercel: trimmed, and refused (with a reason that never contains the key) if it
 *  is not a single token - e.g. pasted twice, or with a label or a line break inside. */
export function cleanKey(raw: string | undefined, name: string): { key: string | null; problem: string | null } {
  if (!raw) return { key: null, problem: null };
  const v = raw.trim();
  if (!v) return { key: null, problem: `${name} is empty` };
  const parts = v.split(/\s+/);
  if (parts.length > 1) return { key: null, problem: `${name} contains ${parts.length} separate values (pasted more than once or with spaces/line breaks). It must be exactly one key on one line.` };
  return { key: v, problem: null };
}
