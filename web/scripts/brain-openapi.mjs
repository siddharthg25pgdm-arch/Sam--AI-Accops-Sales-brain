// Writes docs/sales-brain-openapi.json from lib/brain.ts (the route serves the same object).
// usage (from web/): node scripts/brain-openapi.mjs      lib/brain.check.mjs fails when the copy is stale.
import { createJiti } from "jiti";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": web } });
const B = await jiti.import("../lib/brain.ts"), { openapi } = B;
if (process.argv.includes("--md")) {   // the data dictionary tables in docs/SALES-BRAIN-PLATFORM.md
  for (const [n, cols] of [["sam_v1_assets", B.ASSET_COLS], ["sam_v1_families", B.FAMILY_COLS], ["sam_v1_changes", B.CHANGE_COLS], ["sam_v1_public_assets", B.PUBLIC_COLS]]) {
    console.log(`\n#### ${n}\n\n| Column | Type | Meaning |\n|---|---|---|`);
    // Same nullability rule as the OpenAPI schema: booleans and arrays are never null.
    for (const c of cols) console.log(`| \`${c.name}\` | ${c.type}${c.nullable === false || c.type === "boolean" || c.type === "string[]" ? "" : ", nullable"} | ${c.doc.replace(/\|/g, "/")} |`);
  }
  process.exit(0);
}
const out = new URL("../../docs/sales-brain-openapi.json", import.meta.url);
fs.writeFileSync(out, JSON.stringify(openapi(), null, 2) + "\n");
console.log(`wrote ${fileURLToPath(out)}`);
