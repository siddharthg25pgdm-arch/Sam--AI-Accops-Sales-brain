// Writes docs/sales-brain-openapi.json from lib/brain.ts (the route serves the same object).
// usage (from web/): node scripts/brain-openapi.mjs      lib/brain.check.mjs fails when the copy is stale.
import { createJiti } from "jiti";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": web } });
const { openapi } = await jiti.import("../lib/brain.ts");
const out = new URL("../../docs/sales-brain-openapi.json", import.meta.url);
fs.writeFileSync(out, JSON.stringify(openapi(), null, 2) + "\n");
console.log(`wrote ${fileURLToPath(out)}`);
