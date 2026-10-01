// Run: node web/lib/redact.check.mjs - the 1 Oct 2026 key leak must never recur.
import assert from "node:assert";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import path from "node:path";
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": web } });
const KEY = "sk-proj-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0";
process.env.OPENAI_API_KEY = `${KEY}\n${KEY}\n${KEY}`; // pasted three times, as it happened
process.env.LLM_PROVIDER = "openai-compatible"; process.env.OPENAI_COMPAT_BASE_URL = "https://api.groq.com/openai/v1";
process.env.OPENAI_COMPAT_API_KEY = "gsk_" + "Z9y8X7w6V5u4T3s2R1q0P9o8"; process.env.OPENAI_COMPAT_MODEL = "openai/gpt-oss-120b";
const { redact, cleanKey } = await jiti.import("./redact.ts");
const { tiers, keyProblems } = await jiti.import("./agent-openai.ts");
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
// 1. a malformed key is refused, not sent, and the reason never contains it
// the same key pasted three times is unambiguous: used once, no problem reported
ok(tiers().some(t => t.provider === "openai" && t.key === KEY), "the same key pasted three times is used once");
ok(keyProblems().length === 0, "no problem for a repeated identical key");
// two DIFFERENT values together are refused, and the reason never contains either
process.env.OPENAI_API_KEY = `${KEY}
sk-proj-${"Z".repeat(30)}`;
ok(!tiers().some(t => t.provider === "openai" && t.base.includes("api.openai.com")), "two different keys do not become a tier");
ok(keyProblems().length === 1 && /contains 2 separate values/.test(keyProblems()[0]) && !keyProblems()[0].includes("sk-"), `reason given without the key: ${keyProblems()}`);
ok(cleanKey(`  ${KEY}  `, "X").key === KEY, "surrounding whitespace is trimmed");
// 2. the exact production error message is scrubbed
const leaked = `Headers.append: "Bearer ${KEY}\n${KEY}" is an invalid header value.`;
ok(!redact(leaked).includes("sk-proj") && !redact(leaked).includes(KEY.slice(10)), `fetch header error scrubbed: ${redact(leaked)}`);
ok(!redact(new Error(leaked)).includes("sk-proj"), "Error objects are scrubbed");
ok(!redact({ tiers: [{ error: leaked }] }).includes("sk-proj"), "nested JSON is scrubbed");
ok(!redact("auth gsk_Z9y8X7w6V5u4T3s2R1q0P9o8 failed").includes("gsk_Z9y8"), "configured Groq key scrubbed");
ok(redact("Bearer abc.def-123 rejected") === "Bearer [redacted] rejected", "any Bearer token scrubbed");
ok(redact("gpt-6-luna returned 429: rate limit") === "gpt-6-luna returned 429: rate limit", "ordinary errors untouched");
console.log(`redact.check: ${n} assertions passed`);
