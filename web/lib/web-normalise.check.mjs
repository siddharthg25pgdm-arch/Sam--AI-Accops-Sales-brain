// Run: node web/lib/web-normalise.check.mjs - the q_hash rules of plan 2.4 (repeat blocking and the shared cache depend on them).
import assert from "node:assert";
import { createHash } from "node:crypto";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import path from "node:path";
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": web } });
const { normalise, qHash } = await jiti.import("./web/normalise.ts");
let n = 0; const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++; };

eq(normalise("  Why did my CITRIX renewal go UP?! "), "why did my citrix renewal go up", "case, punctuation, trim");
eq(normalise("ＨｙＳｅｃｕｒｅ　vs\tCitrix\n\nNetScaler"), "hysecure vs citrix netscaler", "NFKC full-width + whitespace collapse");
eq(normalise("hy​secure‍﻿ pri\u0007ce"), "hysecure price", "zero-width and control characters removed, not spaced");
eq(normalise("“Zero trust” isn’t ‘magic’"), normalise("\"Zero trust\" isn't 'magic'"), "smart quotes = straight quotes");
eq(normalise("vdi/daas, (cost) -> $5"), "vdi daas cost 5", "punctuation and symbols become spaces");
eq(normalise("café naïve"), "café naïve", "letters with accents kept");
eq(normalise("?!...  "), "", "only punctuation -> empty");
eq(normalise("a ".repeat(400)).length, 499, "cut at 500 then trimmed");
eq(Array.from(normalise("\u{20000}".repeat(600))).length, 500, "cut counts code points");
eq(qHash("Citrix renewal?", "citrix-lp"), createHash("sha256").update("citrix renewal|citrix-lp").digest("hex"), "q_hash = sha256(normalise(q)|group)");
eq(qHash("CITRIX   renewal", "citrix-lp"), qHash("citrix renewal!", "citrix-lp"), "same question, same hash");
assert.notStrictEqual(qHash("citrix renewal", "citrix-lp"), qHash("citrix renewal", "general"), "group is part of the hash"); n++;
console.log(`web-normalise.check: ${n} assertions passed`);
