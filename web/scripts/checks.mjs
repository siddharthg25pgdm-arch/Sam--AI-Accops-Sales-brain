// Every lib/*.check.mjs, one after another (they share globals, so never in one process).
// usage (from web/): node scripts/checks.mjs
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const lines = s => s.trim().split(/\r?\n/);
let bad = 0;
for (const f of readdirSync(new URL("../lib", import.meta.url)).filter(f => f.endsWith(".check.mjs")).sort()) {
  const r = spawnSync(process.execPath, [`lib/${f}`], { cwd: web, encoding: "utf8" });
  if (r.status !== 0) { bad++; console.log(`FAIL ${f}\n${lines(`${r.stdout}${r.stderr}`).slice(-15).join("\n")}`); }
  else console.log(`ok   ${f}: ${lines(r.stdout).at(-1)}`);
}
process.exit(bad ? 1 : 0);
