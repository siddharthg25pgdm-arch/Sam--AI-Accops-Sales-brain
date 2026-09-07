import { resolveCaller, unauthorized } from "@/lib/apiauth";
import { daily } from "@/lib/metrics";
import { registry } from "@/lib/sharepoint";
import { ready } from "@/lib/registry-cache";
import { allAssets, assetLink } from "@/lib/cards";

export const maxDuration = 60;

/** CSV escaping: quote everything, double any embedded quote. Asset titles contain commas and
 *  apostrophes routinely, and a half-escaped CSV corrupts silently in Excel rather than erroring. */
const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csv = (rows: unknown[][]) => rows.map(r => r.map(cell).join(",")).join("\r\n");

/** GET /api/v1/export?set=metrics|assets|gaps  -> text/csv
 *
 *  Exists because the first thing anyone does with a number a manager likes is put it in a deck,
 *  and retyping it from a dashboard is how numbers get transcribed wrong. */
export async function GET(req: Request) {
  const who = await resolveCaller(req); if (!who) return unauthorized();
  const set = new URL(req.url).searchParams.get("set") ?? "metrics";

  let rows: unknown[][];
  let name: string;

  if (set === "assets") {
    await ready();
    rows = [["title", "type", "industry", "products", "visibility", "link", "year", "path"]];
    for (const a of allAssets()) {
      rows.push([a.title, a.asset_type, a.industry, (a.products ?? []).join("; "),
        a.visibility, assetLink(a) ?? "", a.file?.year ?? "", a.file?.path ?? ""]);
    }
    name = "sam-assets";
  } else if (set === "gaps") {
    const reg = await registry("sales", 5000);
    rows = [["folder", "filename", "type", "industry", "modified", "owner", "ingestable"]];
    for (const r of reg.filter(x => !x.deleted && x.status === "active")) {
      rows.push([r.folder, r.filename, (r.asset_type ?? []).join("; "), (r.industry ?? []).join("; "),
        r.modified_at ?? "", r.modified_by ?? "", r.suggest_ingest ? "yes" : "no"]);
    }
    name = "sam-registry";
  } else {
    const d = await daily(90);
    rows = [["day", "channel", "queries", "users", "sessions", "gaps", "zero_results",
             "catalogue_opens", "feedback_total", "feedback_helpful", "p50_ms", "p95_ms", "max_ms"]];
    for (const r of d) {
      rows.push([r.day, r.channel, r.queries, r.users, r.sessions, r.gaps, r.zero_results,
        r.catalogue_opens, r.feedback_total, r.feedback_helpful, r.latency_p50, r.latency_p95, r.latency_max]);
    }
    name = "sam-metrics";
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + csv(rows), {   // BOM so Excel reads UTF-8 rather than mangling names
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${stamp}.csv"`,
    },
  });
}
