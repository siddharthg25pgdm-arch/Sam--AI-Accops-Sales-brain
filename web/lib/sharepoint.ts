/** SharePoint sync for SAM: keeps the file registry current, never touches file bodies.
 *
 *  Siddharth's shape, deliberately: SAM maps where documents live and hands out links. Cards are
 *  built from files he downloads and passes over, so nothing here downloads content. That also keeps
 *  the rule in design section 2 true by construction - a private file's bytes never leave SharePoint.
 *
 *  Auth is app-only (client credentials) because this runs unattended on Vercel with no user present.
 *  That needs the Entra app registration with Sites.Selected granted on both sites; until those env
 *  vars exist every function here degrades to a clear "not configured" rather than throwing. */

const GRAPH = "https://graph.microsoft.com/v1.0";
const DOC_EXT = new Set(["pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls", "txt", "md", "rtf"]);
/** This tenant z-prefixes dead folders so they sort to the bottom: zArchive, zzzArchive,
 *  "zCase Studies (Archive_DONOTUSE)". Treat that convention as the exclusion rule. */
const DEAD = /(z*archive|do ?not ?use|donotuse|obsolete|deprecated|backup|(^|[ _/(-])(old|wip|draft|drafts|temp|tmp|raw)([ _/)-]|$))/i;

export type SyncRow = {
  drive_id: string; scope: string; root_folder: string; delta_link: string | null;
  subscription_id: string | null; expires_at: string | null; client_state: string | null;
};

function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
export function configured() {
  return Boolean(process.env.SP_TENANT_ID && process.env.SP_CLIENT_ID && process.env.SP_CLIENT_SECRET && sb());
}

async function rest(path: string, init: RequestInit = {}) {
  const c = sb();
  if (!c) throw new Error("supabase not configured");
  const r = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init, cache: "no-store",
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`supabase ${path} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

/** App-only token. Cached in module scope: it lives ~1h and a warm lambda reuses it. */
let cachedToken: { value: string; expires: number } | null = null;
export async function token(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const tenant = process.env.SP_TENANT_ID, id = process.env.SP_CLIENT_ID, secret = process.env.SP_CLIENT_SECRET;
  if (!tenant || !id || !secret) throw new Error("SP_TENANT_ID / SP_CLIENT_ID / SP_CLIENT_SECRET not set");
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default" }),
  });
  if (!r.ok) throw new Error(`token ${r.status} ${await r.text()}`);
  const j = await r.json();
  cachedToken = { value: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function graph(url: string): Promise<Record<string, unknown>> {
  const t = await token();
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url.startsWith("http") ? url : `${GRAPH}${url}`, {
      headers: { Authorization: `Bearer ${t}` }, cache: "no-store",
    });
    // Graph throttles with 429 and means the Retry-After it sends. Honour it rather than hammering.
    if ((r.status === 429 || r.status >= 500) && attempt < 3) {
      const wait = Number(r.headers.get("retry-after") ?? 2) * 1000;
      await new Promise(res => setTimeout(res, Math.min(wait, 20_000)));
      continue;
    }
    if (!r.ok) throw new Error(`graph ${r.status} ${(await r.text()).slice(0, 300)}`);
    return r.json();
  }
}

export async function syncRows(): Promise<SyncRow[]> {
  return (await rest("sam_sharepoint_sync?select=*")) as SyncRow[];
}

type DriveItem = {
  id: string; name?: string; size?: number; webUrl?: string; eTag?: string; cTag?: string;
  createdDateTime?: string; lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName?: string } };
  parentReference?: { path?: string; driveId?: string };
  file?: { mimeType?: string }; folder?: unknown; deleted?: unknown;
};

/** One incremental pass over a drive. Returns counts and the next delta cursor.
 *
 *  Delta enumerates the WHOLE library (the Company drive holds ~60k items), so scope filtering
 *  happens here on parentReference.path rather than by asking Graph for a subtree - there is no
 *  delta endpoint scoped to a folder. */
export async function syncDrive(row: SyncRow): Promise<{ upserts: number; deletes: number; scanned: number; delta: string | null }> {
  const prefix = `root:/${row.root_folder}`;
  let url = row.delta_link ?? `${GRAPH}/drives/${row.drive_id}/root/delta?$top=200`;
  const upserts: Record<string, unknown>[] = [];
  const deletes: string[] = [];
  let scanned = 0, delta: string | null = null;

  for (;;) {
    const page = await graph(url) as { value?: DriveItem[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
    for (const it of page.value ?? []) {
      scanned++;
      // A deleted item still carries parentReference, so scope-filter it the same way and let the
      // registry decide - a file that leaves scope by being moved must also stop being cited.
      const raw = decodeURIComponent(it.parentReference?.path ?? "");
      const cut = raw.indexOf("root:/");
      const path = cut < 0 ? "" : raw.slice(cut);
      const inScope = path === prefix || path.startsWith(prefix + "/");
      if (it.deleted) { if (inScope) deletes.push(it.id); continue; }
      if (!inScope || it.folder || !it.file || !it.name) continue;

      const folder = path.slice(prefix.length).replace(/^\//, "");
      const ext = (it.name.split(".").pop() ?? "").toLowerCase();
      const dead = DEAD.test(`/${row.root_folder}/${folder}/${it.name}`);
      upserts.push({
        item_id: it.id, drive_id: row.drive_id, scope: row.scope, folder, filename: it.name, ext,
        size_bytes: it.size ?? 0, web_url: it.webUrl ?? "", created_at: it.createdDateTime ?? null,
        modified_at: it.lastModifiedDateTime ?? null, modified_by: it.lastModifiedBy?.user?.displayName ?? null,
        etag: it.eTag ?? null, ctag: it.cTag ?? null, deleted: false, deleted_at: null,
        suggest_ingest: !dead && DOC_EXT.has(ext),
        skip_reason: dead ? "archive/draft folder" : DOC_EXT.has(ext) ? null : "not a document",
        last_synced: new Date().toISOString(),
      });
    }
    const next = page["@odata.nextLink"];
    if (!next) { delta = page["@odata.deltaLink"] ?? null; break; }
    url = next;
  }

  for (let i = 0; i < upserts.length; i += 200) {
    await rest("sam_sharepoint_files?on_conflict=item_id", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(upserts.slice(i, i + 200)),
    });
  }
  // Soft delete, never a row drop: SAM citing a document that no longer exists is the failure that
  // destroys trust, and keeping the tombstone lets the catalogue explain a disappearance.
  for (const id of deletes) {
    await rest(`sam_sharepoint_files?item_id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", body: JSON.stringify({ deleted: true, deleted_at: new Date().toISOString() }),
    });
  }
  await rest(`sam_sharepoint_sync?drive_id=eq.${encodeURIComponent(row.drive_id)}`, {
    method: "PATCH",
    body: JSON.stringify({ delta_link: delta, last_run: new Date().toISOString(),
      last_result: `${upserts.length} upserts, ${deletes.length} deletes, ${scanned} scanned` }),
  });
  return { upserts: upserts.length, deletes: deletes.length, scanned, delta };
}

/** Create or renew the change subscription for a drive. Graph caps drive subscriptions at ~3 days,
 *  so this is called nightly; renewal is a PATCH, and a subscription Graph has forgotten 404s -
 *  in that case create a fresh one rather than leaving the drive unwatched. */
export async function ensureSubscription(row: SyncRow, notificationUrl: string): Promise<{ id: string; expires: string; created: boolean }> {
  const t = await token();
  const expires = new Date(Date.now() + 2.5 * 24 * 3600 * 1000).toISOString();
  const clientState = row.client_state ?? process.env.SP_CLIENT_STATE ?? "";

  if (row.subscription_id) {
    const r = await fetch(`${GRAPH}/subscriptions/${row.subscription_id}`, {
      method: "PATCH", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expirationDateTime: expires }),
    });
    if (r.ok) {
      await rest(`sam_sharepoint_sync?drive_id=eq.${encodeURIComponent(row.drive_id)}`, {
        method: "PATCH", body: JSON.stringify({ expires_at: expires }) });
      return { id: row.subscription_id, expires, created: false };
    }
    if (r.status !== 404) throw new Error(`renew ${r.status} ${(await r.text()).slice(0, 200)}`);
  }

  const r = await fetch(`${GRAPH}/subscriptions`, {
    method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      changeType: "updated",           // drive resources only support "updated"; it covers create/modify/delete
      notificationUrl, expirationDateTime: expires, clientState,
      resource: `/drives/${row.drive_id}/root`,
    }),
  });
  if (!r.ok) throw new Error(`subscribe ${r.status} ${(await r.text()).slice(0, 300)}`);
  const sub = await r.json();
  await rest(`sam_sharepoint_sync?drive_id=eq.${encodeURIComponent(row.drive_id)}`, {
    method: "PATCH", body: JSON.stringify({ subscription_id: sub.id, expires_at: expires, client_state: clientState }) });
  return { id: sub.id, expires, created: true };
}
