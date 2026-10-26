// Builds web/public/embed.js (the loader the LP's script tag loads) from scripts/embed.src.js: esbuild minify, ES2019.
// usage (from web/): node scripts/build-embed.mjs
// The first line records the source's sha256, so web-widget.check can prove the served file is this source's build
// without needing esbuild itself. esbuild is not a web/ dependency (no npm install here): set ESBUILD=<path to the
// esbuild package dir>, or it is taken from node_modules or the npx cache (`npx esbuild --version` once fills it).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));

/** esbuild from $ESBUILD, web/node_modules, or the newest copy in the npx cache. */
export function findEsbuild() {
  const req = createRequire(path.join(web, "package.json"));
  if (process.env.ESBUILD) return req(process.env.ESBUILD);
  try { return req("esbuild"); } catch { /* not installed here */ }
  const npx = path.join(process.env.LOCALAPPDATA ?? path.join(process.env.HOME ?? "", ".npm"), process.env.LOCALAPPDATA ? "npm-cache/_npx" : "_npx");
  const found = (existsSync(npx) ? readdirSync(npx) : []).map(d => path.join(npx, d, "node_modules/esbuild"))
    .filter(d => existsSync(path.join(d, "package.json")))
    .map(d => ({ d, v: JSON.parse(readFileSync(path.join(d, "package.json"), "utf8")).version.split(".").map(Number) }))
    .sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1] || b.v[2] - a.v[2]);
  if (!found.length) throw new Error("esbuild not found: set ESBUILD=<dir> or run `npx esbuild --version` once");
  return req(found[0].d);
}

/** Line endings normalised, so a CRLF checkout (Windows autocrlf) hashes the same. */
export const srcHash = src => createHash("sha256").update(src.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const src = readFileSync(path.join(web, "scripts/embed.src.js"), "utf8");
  const { code } = findEsbuild().transformSync(src, { minify: true, target: "es2019", legalComments: "none" });
  const out = `/* Ask Accops loader. Built from scripts/embed.src.js sha256:${srcHash(src)} by scripts/build-embed.mjs; edit the source. */\n${code}`;
  writeFileSync(path.join(web, "public/embed.js"), out);
  console.log(`public/embed.js: ${out.length} B, ${gzipSync(out, { level: 9 }).length} B gzip (budget 5120)`);
}
