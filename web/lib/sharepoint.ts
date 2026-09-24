/** SharePoint change tracking for SAM. Read-only with respect to SharePoint, by design.
 *
 *  SAM is a tracker and an ingestion pipeline, never an editor. Nothing in this file creates, moves,
 *  renames or deletes anything in SharePoint, and nothing downloads file content. It maintains SAM's
 *  own registry of where documents live, so answers can hand out links. Siddharth downloads the
 *  documents he wants carded and passes the files over - that is what keeps the rule in design
 *  section 2 true by construction: a private file's bytes never leave SharePoint.
 *
 *  Changes arrive from a Power Automate flow running on Siddharth's own connection, so there is no
 *  Entra app registration and no IT approval anywhere in this path. */

const DOC_EXT = new Set(["pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls", "txt", "md", "rtf"]);
/** This tenant z-prefixes dead folders so they sort to the bottom: zArchive, zzzArchive,
 *  "zCase Studies (Archive_DONOTUSE)". Treat that convention as the exclusion rule. */
const DEAD = /(z*archive|do ?not ?use|donotuse|obsolete|deprecated|backup|(^|[ _/(-])(old|wip|draft|drafts|temp|tmp|raw)([ _/)-]|$))/i;

export type IncomingFile = {
  event?: "created" | "modified" | "deleted";
  itemId: string; driveId?: string; scope?: string;
  name?: string; folder?: string; webUrl?: string; size?: number;
  /** SharePoint list item id, the integer the create/modify trigger exposes as {Id}. Recorded so
   *  deletions - which carry only this, never the Graph id - can match a row exactly. */
  listItemId?: number | string;
  created?: string; modified?: string; modifiedBy?: string; etag?: string; cTag?: string;
};

/** Tag vocabulary. Mirrors prototype/sp_tags.py - keep the two in step when either changes.
 *  Tags come from the folder and the filename, never from reading the document, so a tag here
 *  means "the library says so". Carding can add or correct them later from the text. */
const TYPE_FOLDER: [string, string][] = [
  ["zcase studies", "Case Study"], ["paid media_case studies", "Case Study"],
  ["presentations", "Deck"], ["videos", "Video"], ["whitepapers", "Whitepaper"],
  ["brochures & datasheets", "Brochure"], ["ebooks", "eBook"], ["competition", "Competitive"],
  ["gartner reading material", "Analyst Report"], ["3rd party reports", "Analyst Report"],
  ["accops featured in reports", "Analyst Report"], ["company certifications", "Certification"],
  ["accops brand files", "Brand"], ["roadshows", "Event"], ["event", "Event"],
  ["tech solution documents", "Solution Brief"], ["product editions", "Product Info"],
];
const TYPE_NAME: [RegExp, string][] = [
  [/case stud|casestudy|success story/i, "Case Study"],
  [/battlecard|battle card|\bvs\b|comparison|compete/i, "Competitive"],
  [/white ?paper/i, "Whitepaper"], [/brochure|datasheet|data sheet/i, "Brochure"],
  [/\bdeck\b|presentation|\bppt\b/i, "Deck"], [/ebook/i, "eBook"], [/webinar/i, "Webinar"],
  [/roadshow|event|summit|conference|expo/i, "Event"], [/pricing|price list|quotation/i, "Pricing"],
  [/proposal|\brfp\b|\brfi\b/i, "Proposal"], [/solution brief|solution overview/i, "Solution Brief"],
  [/report|survey|magic quadrant|forrester|gartner/i, "Analyst Report"],
  [/certificate|certification|iso\b|soc ?2/i, "Certification"],
  [/roadmap/i, "Roadmap"], [/faq/i, "FAQ"], [/\bdemo\b/i, "Demo"],
];
const INDUSTRY: [RegExp, string][] = [
  [/bfsi|bank|nbfc|financial|insurance|capital|co-?operative/i, "BFSI"],
  [/pharma|healthcare|hospital|life science|medical/i, "Pharma / Healthcare"],
  [/government|govt|psu|defence|defense|atomic|municipal|police/i, "Government"],
  [/manufactur|industry 4|textile|cable|automotive|plant|factory/i, "Manufacturing"],
  [/it\/ites|ites|bpo|it services|system integrator|\bgcc\b/i, "IT / ITeS"],
  [/education|university|college|school|campus|\biit\b/i, "Education"],
  [/retail|e-?commerce|d2c|logistics/i, "E-commerce / Retail"],
  [/media|entertainment|broadcast|\bdth\b|news/i, "Media"], [/telecom|telco/i, "Telecom"],
];
const PRODUCT: [RegExp, string][] = [
  [/hysecure/i, "HySecure"], [/hyid/i, "HyID"], [/hyworks/i, "HyWorks"], [/hylabs/i, "HyLabs"],
  [/hydesk/i, "HyDesk"], [/\bztna\b/i, "ZTNA"], [/\bmfa\b|multi-?factor|2fa/i, "MFA"],
  [/\bvdi\b|virtual desktop/i, "VDI"], [/\bdaas\b|desktop as a service/i, "DaaS"],
  [/bioauth|biometric/i, "BioAuth"], [/nutanix/i, "Nutanix"], [/thin ?client/i, "Thin Client"],
  [/browser isolation|\brbi\b/i, "Browser Isolation"],
];
const COMPETITOR: [RegExp, string][] = [
  [/citrix/i, "Citrix"], [/vmware|horizon/i, "VMware"], [/omnissa/i, "Omnissa"],
  [/forcepoint/i, "Forcepoint"], [/sonicwall/i, "SonicWall"], [/fortinet/i, "Fortinet"],
  [/\bawtg?\b|amazon workspace|\bwsp\b/i, "AWS WorkSpaces"],
  [/azure virtual desktop|\bavd\b/i, "Azure Virtual Desktop"],
  [/array networks/i, "Array Networks"], [/\bthinprint\b/i, "ThinPrint"],
];

function match(pairs: [RegExp, string][], text: string): string[] {
  const out: string[] = [];
  for (const [re, tag] of pairs) if (re.test(text) && !out.includes(tag)) out.push(tag);
  return out;
}

export type Tags = {
  asset_type: string[]; industry: string[]; product: string[]; competitor: string[];
  team: string; status: "active" | "archived";
};

/** Scope roots, as Power Automate reports them. The trigger's {Path} is LIBRARY-relative
 *  ("Shared Documents/Sales/Sales Collateral/Competition/..."), while the registry stores folders
 *  relative to the scope root ("Competition/..."), because sp_seed_registry.py builds them from
 *  Graph's item hierarchy. Two sources, two meanings, one column - so normalise on the way in or
 *  the same folder arrives under two names and the catalogue facets split in half. */
const SCOPE_ROOTS: Record<string, string[]> = {
  sales: ["Shared Documents/Sales/Sales Collateral", "Sales/Sales Collateral"],
  marketing: ["Shared Documents/Marketing 2.0", "Marketing 2.0"],
};

/** Strip the scope root and any surrounding slashes, so a Power Automate {Path} and a Graph-derived
 *  path both land on the same value. Case-insensitive: SharePoint paths are not case-stable. */
export function scopeRelative(path: string, scope = "sales"): string {
  let p = (path ?? "").replace(/^\/+|\/+$/g, "");
  for (const root of SCOPE_ROOTS[scope] ?? []) {
    if (p.toLowerCase() === root.toLowerCase()) return "";
    if (p.toLowerCase().startsWith(root.toLowerCase() + "/")) {
      p = p.slice(root.length + 1);
      break;
    }
  }
  return p.replace(/^\/+|\/+$/g, "");
}

export function tagsFor(folder: string, filename: string, scope = "sales"): Tags {
  const hay = `${folder} ${filename}`;
  const top = (folder.split("/")[0] ?? "").toLowerCase();
  const fromFolder = TYPE_FOLDER.find(([prefix]) => top.startsWith(prefix))?.[1];
  // Folder wins - it is a deliberate filing decision - but a case-study deck filed under
  // Presentations should still say Case Study, so filename tags are appended rather than ignored.
  const asset_type = [...(fromFolder ? [fromFolder] : []), ...match(TYPE_NAME, filename)]
    .filter((t, i, a) => a.indexOf(t) === i);
  return {
    asset_type: asset_type.length ? asset_type : ["Other"],
    industry: match(INDUSTRY, hay),
    product: match(PRODUCT, hay),
    competitor: match(COMPETITOR, hay),
    team: scope === "marketing" ? "Marketing" : "Sales",
    status: DEAD.test(`/${folder}/${filename}`) ? "archived" : "active",
  };
}

function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
export function configured() { return Boolean(sb()); }

async function rest(path: string, init: RequestInit = {}) {
  const c = sb();
  if (!c) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const r = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init, cache: "no-store",
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`supabase ${path} ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}

/** Tombstone a deleted file. Soft delete only: the row survives so the catalogue can explain a
 *  disappearance, and because SAM citing a document that no longer exists is worse than SAM
 *  missing one.
 *
 *  Deletion is the hardest case, because SharePoint's "When a file is deleted" trigger returns only
 *  `id, name, filenameWithExtension, deletedBy, timeDeleted, isFolder` - no webUrl, and crucially no
 *  Graph {Identifier}. The file is gone, so there is no live link to hand back. Its `id` is the
 *  SharePoint LIST ITEM id, an integer, which is a different identifier space from `item_id`
 *  (the Graph driveItem id). Matching item_id against it would match nothing, every time.
 *
 *  So three keys, most reliable first:
 *    1. list_item_id - exact, but only present on rows the modify flow has already touched, because
 *       Graph's delta does not return it and the seeded 874 therefore lack it.
 *    2. (folder, filename) - verified unique across all 874 seeded rows.
 *    3. filename alone - deliberately NOT used. 58 rows share a filename with another row and one
 *       name repeats 35 times, so this could tombstone 35 live documents in a single call.
 *
 *  Every path is guarded by a count check before the write. PostgREST updates every row a filter
 *  matches, so an over-broad filter is a mass deletion; refusing anything but an exact single match
 *  turns that into a logged no-op. An unmatched delete is usually a move - it arrives as
 *  delete-in-old plus create-in-new, and the create re-adds the file correctly. */
async function applyDelete(f: IncomingFile): Promise<string> {
  const stamp = { deleted: true, deleted_at: new Date().toISOString() };
  const mark = async (filter: string, how: string) => {
    const rows = (await rest(`sam_sharepoint_files?${filter}&select=item_id,deleted`)) as
      { item_id: string; deleted: boolean }[] | null;
    if (!rows || rows.length !== 1) return null;              // 0 = unknown, >1 = ambiguous; never guess
    if (rows[0].deleted) return `already deleted (${how})`;
    await rest(`sam_sharepoint_files?item_id=eq.${encodeURIComponent(rows[0].item_id)}`, {
      method: "PATCH", body: JSON.stringify(stamp),
    });
    return `marked deleted by ${how}`;
  };

  const listItemId = num(f.listItemId);
  if (listItemId != null) {
    const hit = await mark(`list_item_id=eq.${listItemId}`, "list_item_id");
    if (hit) return hit;
  }
  const name = f.name ?? "";
  if (name) {
    const folder = scopeRelative(f.folder ?? "", f.scope ?? "sales");
    const hit = await mark(
      `folder=eq.${encodeURIComponent(folder)}&filename=eq.${encodeURIComponent(name)}`,
      "folder+filename");
    if (hit) return hit;
  }
  // Deliberately no filename-only fallback. Say so loudly instead: the nightly re-seed is the
  // backstop, and a wrongly-kept row is recoverable where a wrongly-tombstoned one is not.
  return `no match, left alone (name=${name || "?"}, listItemId=${f.listItemId ?? "?"})`;
}

/** Power Automate sends "" for an absent number, and "" into a bigint is a 22P02 that fails the
 *  whole row. Anything not a real number becomes null. */
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The item_id of the row this notification is about, or null if the file is new to SAM.
 *  Same key order as applyDelete: list_item_id is exact, (folder, filename) is unique across all
 *  874 seeded rows, and there is deliberately no filename-only fallback. */
async function findRow(listItemId: number | null, folder: string, filename: string): Promise<string | null> {
  const one = async (filter: string) => {
    const rows = (await rest(`sam_sharepoint_files?${filter}&select=item_id&limit=2`)) as { item_id: string }[] | null;
    return rows && rows.length === 1 ? rows[0].item_id : null;
  };
  if (listItemId != null) {
    const hit = await one(`list_item_id=eq.${listItemId}`);
    if (hit) return hit;
  }
  if (!filename) return null;
  return await one(`folder=eq.${encodeURIComponent(folder)}&filename=eq.${encodeURIComponent(filename)}`);
}

/** Record one change in SAM's registry. Touches nothing in SharePoint. */
export async function applyChange(f: IncomingFile): Promise<string> {
  if (!configured()) return "skipped: supabase not configured";

  if (f.event === "deleted") return await applyDelete(f);

  const folder = scopeRelative(f.folder ?? "", f.scope ?? "sales");
  const name = f.name ?? "";
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const t = tagsFor(folder, name, f.scope ?? "sales");
  const listItemId = num(f.listItemId);

  // Power Automate's {Identifier} is NOT the Graph driveItem id. The first real notification, on
  // 7 September 2026, sent "Shared%2bDocuments%252fSales%252f..." - a URL-encoded PATH. Keying on it
  // would insert a second row for a file already in the registry, so match the seeded row first by
  // list_item_id, then by (folder, filename), exactly as deletion does. Only fall back to whatever
  // the trigger called an identifier when the file is genuinely new.
  const existing = await findRow(listItemId, folder, name);
  const itemId = existing ?? f.itemId;

  await rest("sam_sharepoint_files?on_conflict=item_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{
      item_id: itemId, drive_id: f.driveId ?? "", scope: f.scope ?? "sales", folder, filename: name,
      // Fills in as the modify flow sees each file; this is what makes deletion an exact match later.
      list_item_id: listItemId,
      // The trigger sends "" for a file with no size, and "" into a bigint is 22P02, which killed the
      // whole upsert after the 202 had already been returned - a silent failure by construction.
      ext, size_bytes: num(f.size) ?? 0, web_url: f.webUrl ?? "",
      created_at: f.created ?? null, modified_at: f.modified ?? null, modified_by: f.modifiedBy ?? null,
      etag: f.etag ?? null, ctag: f.cTag ?? null, deleted: false, deleted_at: null,
      asset_type: t.asset_type, industry: t.industry, product: t.product, competitor: t.competitor,
      team: t.team, status: t.status,
      suggest_ingest: t.status === "active" && DOC_EXT.has(ext),
      skip_reason: t.status === "archived" ? "archive/draft folder" : DOC_EXT.has(ext) ? null : "not a document",
      last_synced: new Date().toISOString(),
    }]),
  });
  return `upserted [${t.asset_type.join(", ")}]`;
}

export type RegistryRow = {
  item_id: string; filename: string; folder: string; web_url: string; ext: string;
  created_at: string | null; modified_at: string | null; modified_by: string | null;
  asset_type: string[]; industry: string[]; product: string[]; competitor: string[];
  status: string; deleted: boolean;
  /** Only ever written by the Power Automate flow - the seed cannot produce it, because Graph's
   *  delta does not return the SharePoint list item id. So a non-null value here is proof that a
   *  real notification arrived and the trigger's field mapping is correct. */
  list_item_id: number | null;
  /** Set to now() only by applyChange, so a value newer than the backfill proves a real
   *  notification arrived. The seed and the backfill both leave it at their own run time. */
  last_synced: string | null;
  /** False for logos, shortcuts and anything in an archive folder - things a rep would never send. */
  suggest_ingest: boolean;
};

/** Registry read for the catalogue and the reconcile report. */
export async function registry(scope = "sales", limit = 2000): Promise<RegistryRow[]> {
  if (!configured()) return [];
  return (await rest(`sam_sharepoint_files?scope=eq.${scope}&deleted=is.false&select=*&limit=${limit}&order=modified_at.desc`)) as RegistryRow[];
}

/** One asset card: what a document SAYS, written by Claude Enterprise from the real text.
 *
 *  client_actual is in the table and deliberately NOT in this type. It holds real customer names,
 *  and everything that reads a CardRow ends up in an Asset, a JSON response or a model prompt.
 *  Nothing in the answer path needs it, so it is not selected - which is a stronger guarantee than
 *  remembering to strip it later. Query the table directly if a human needs it. */
export type CardRow = {
  source: string; filename: string; title: string; asset_type: string; industry: string;
  client: string; products: string[]; competitors: string[]; personas: string[]; regulations: string[];
  key_problem: string; key_outcomes: string[]; brief: string; use_for: string;
  publish_year: string | null; expired: boolean; expiry_date: string | null;
  stale_risk: string; superseded_by: string; visibility: string; internal_reason: string;
  public_url: string; confidence: number; needs_human: string; batch: string;
  /** The registry row this card was written for, bound by load_cards.py. Survives a rename, which
   *  the filename does not - see allAssets(). Null when no single live row could be resolved. */
  item_id: string | null;
};

const CARD_COLS = "source,filename,title,asset_type,industry,client,products,competitors,personas," +
  "regulations,key_problem,key_outcomes,brief,use_for,publish_year,expired,expiry_date,stale_risk," +
  "superseded_by,visibility,internal_reason,public_url,confidence,needs_human,batch,item_id";

/** Every asset card. Explicit column list rather than select=*, so client_actual cannot arrive by
 *  accident when someone adds a column later. */
export async function cardRows(limit = 2000): Promise<CardRow[]> {
  if (!configured()) return [];
  return (await rest(`sam_asset_cards?select=${CARD_COLS}&limit=${limit}&order=source`)) as CardRow[];
}

export type CardingQueueRow = {
  item_id: string; filename: string; folder: string; web_url: string;
  modified_at: string | null; modified_by: string | null;
  reason: "uncarded" | "changed_since_card" | "renamed"; card_updated_at: string | null;
};

/** Files that need a card written or re-checked: the sam_carding_queue view (docs/supabase-sam-carding-queue.sql).
 *  Newest change first, so a carding session starts with what just moved. */
export async function cardingQueue(reason?: string, limit = 2000): Promise<CardingQueueRow[]> {
  if (!configured()) return [];
  const f = reason ? `reason=eq.${encodeURIComponent(reason)}&` : "";
  return (await rest(`sam_carding_queue?${f}select=*&order=modified_at.desc.nullslast&limit=${limit}`)) as CardingQueueRow[];
}

export type SyncRow ={ scope: string; last_run: string | null; last_result: string | null };

/** When deletions were last reconciled.
 *
 *  The Power Automate delete trigger does not fire on a non-admin connection (verified 7 September
 *  2026: zero runs against the modify flow's five, identical config). So deletions are caught by
 *  `prototype/sp_reconcile.py`, which runs on the delegated Azure CLI login and cannot run on
 *  Vercel - no Python, no az session. That makes "how long since it last ran" a real number a human
 *  has to watch, rather than a detail. A stale reconcile means SAM may still be citing files that
 *  have been deleted, which section 3 of the task doc calls the worst failure available. */
export async function syncStatus(scope = "sales"): Promise<SyncRow | null> {
  if (!configured()) return null;
  const rows = (await rest(`sam_sharepoint_sync?scope=eq.${scope}&select=scope,last_run,last_result`)) as SyncRow[] | null;
  return rows?.[0] ?? null;
}

/* ---------------------------------------------------------------------------------------------
 * Deletion reconcile from a Power Automate snapshot.
 *
 * The delete trigger never fires without site-collection-admin, and sp_reconcile.py's Graph walk is
 * blocked by Conditional Access. What still works is Siddharth's own SharePoint connection in Power
 * Automate, so a daily flow lists every file under the scope root ("Get files (properties only)",
 * nested, paginated) and POSTs the list here. Rows whose list item id is missing from it are gone.
 *
 * The danger is the one sp_reconcile.py already walked into on 8 September: a listing that FAILED
 * looks exactly like "everything was deleted", and it reported 874 of 874 rows to tombstone. So a
 * snapshot has to prove it is whole before absence is allowed to mean anything, and every guard
 * below refuses rather than guesses. Soft delete only, list_item_id only (exact, stable across
 * rename and move - never filename), and a row that reappears is restored.
 * ------------------------------------------------------------------------------------------- */

export type SnapshotFile = { id?: number | string; name?: string; path?: string; isFolder?: boolean | string };
export type Snapshot = {
  scope?: string; mode?: "report" | "write";
  /** Set by the flow only when "Get files" ran with pagination on. Absent or false = refuse. */
  complete?: boolean;
  /** length() of the raw listing inside the flow, before it was serialised. A mismatch means the
   *  body was truncated on the way here. */
  count?: number;
  files?: SnapshotFile[];
};
export type SnapRow = { item_id: string; list_item_id: number | null; folder: string; filename: string; deleted: boolean };
export type SnapshotDiff = {
  refused: string | null;
  listed: number; live: number; matched: number; unverifiable: number;
  tombstone: SnapRow[]; restore: SnapRow[]; unknown: SnapshotFile[];
};

const truthy = (v: unknown) => v === true || v === "true" || v === "True";
/** At least this share of live rows must be present in the snapshot, by count and by id. */
const MIN_SHARE = 0.9;

/** Pure: what a snapshot would change, or why it must not be trusted. No IO - the check exercises it. */
export function diffSnapshot(rows: SnapRow[], snap: Snapshot): SnapshotDiff {
  const raw = Array.isArray(snap.files) ? snap.files : [];
  const files = raw.filter(f => !truthy(f.isFolder));
  const ids = new Set<number>();
  let badIds = 0;
  for (const f of files) {
    const n = num(f.id);
    if (n == null) badIds++; else ids.add(n);
  }
  const live = rows.filter(r => !r.deleted);
  const checkable = live.filter(r => r.list_item_id != null);
  const tombstone = checkable.filter(r => !ids.has(r.list_item_id!));
  const restore = rows.filter(r => r.deleted && r.list_item_id != null && ids.has(r.list_item_id));
  const known = new Set(rows.map(r => r.list_item_id).filter((n): n is number => n != null));
  const out: SnapshotDiff = {
    refused: null, listed: ids.size, live: live.length, matched: checkable.length - tombstone.length,
    // Rows with no list item id can never be proven gone, so they are never tombstoned here.
    unverifiable: live.length - checkable.length,
    tombstone, restore,
    // In SharePoint but not in the registry: files the change flow missed. Reported, not added.
    unknown: files.filter(f => { const n = num(f.id); return n != null && !known.has(n); }),
  };
  const refuse = (why: string) => ({ ...out, refused: why });
  if (!Array.isArray(snap.files)) return refuse("no files array");
  if (!files.length) return refuse("snapshot lists 0 files - a failed listing, not an empty library");
  if (!truthy(snap.complete)) return refuse("snapshot not marked complete (pagination must be on in the flow)");
  if (snap.count == null || Number(snap.count) !== raw.length) {
    return refuse(`count ${snap.count ?? "missing"} does not match ${raw.length} items received - truncated or unverifiable`);
  }
  if (badIds) return refuse(`${badIds} file(s) have no numeric list item id - the flow's field mapping is wrong`);
  if (ids.size < MIN_SHARE * live.length) {
    return refuse(`snapshot lists ${ids.size} files but the registry has ${live.length} live - under ${MIN_SHARE * 100}%, so assume a partial listing`);
  }
  if (checkable.length && out.matched < MIN_SHARE * checkable.length) {
    return refuse(`only ${out.matched} of ${checkable.length} live rows found by id - more than ${Math.round((1 - MIN_SHARE) * 100)}% would be tombstoned, so assume the wrong folder or library`);
  }
  return out;
}

const brief = (r: SnapRow) => ({ item_id: r.item_id, list_item_id: r.list_item_id, folder: r.folder, filename: r.filename });

/** Diff a snapshot against the registry and, in write mode with every guard passed, apply it.
 *
 *  sam_sharepoint_sync is stamped on every run: last_result always (so a refusal is visible on the
 *  dashboard), last_run only when deletions were actually applied. last_run drives the "deletions
 *  not checked in 36 hours" banner, and a report-mode or refused run has not removed a single dead
 *  link - stamping it would be the green-but-broken signal this project keeps getting caught by. */
export async function applySnapshot(snap: Snapshot) {
  const scope = snap.scope || "sales";
  const mode = snap.mode === "write" ? "write" : "report";
  const rows = (await rest(`sam_sharepoint_files?scope=eq.${encodeURIComponent(scope)}` +
    `&select=item_id,list_item_id,folder,filename,deleted&limit=5000`)) as SnapRow[];
  const d = diffSnapshot(rows ?? [], snap);
  const now = new Date().toISOString();

  let applied = false;
  if (!d.refused && mode === "write") {
    const idList = (xs: SnapRow[]) => xs.map(r => r.list_item_id).join(",");
    if (d.tombstone.length) {
      await rest(`sam_sharepoint_files?scope=eq.${encodeURIComponent(scope)}&deleted=is.false&list_item_id=in.(${idList(d.tombstone)})`, {
        method: "PATCH", body: JSON.stringify({ deleted: true, deleted_at: now }),
      });
    }
    if (d.restore.length) {
      await rest(`sam_sharepoint_files?scope=eq.${encodeURIComponent(scope)}&deleted=is.true&list_item_id=in.(${idList(d.restore)})`, {
        method: "PATCH", body: JSON.stringify({ deleted: false, deleted_at: null }),
      });
    }
    applied = true;
  }

  const result = d.refused
    ? `snapshot ${mode} REFUSED: ${d.refused}`
    : `snapshot ${mode}: ${d.tombstone.length} ${applied ? "tombstoned" : "would tombstone"}, ` +
      `${d.restore.length} ${applied ? "restored" : "would restore"}, ${d.listed} listed, ${d.unknown.length} unknown`;
  await rest(`sam_sharepoint_sync?scope=eq.${encodeURIComponent(scope)}`, {
    method: "PATCH", body: JSON.stringify(applied ? { last_run: now, last_result: result } : { last_result: result }),
  });

  return {
    ok: !d.refused, mode, applied, refused: d.refused, result,
    listed: d.listed, live: d.live, matched: d.matched, unverifiable: d.unverifiable,
    tombstone_count: d.tombstone.length, tombstone: d.tombstone.slice(0, 100).map(brief),
    restore_count: d.restore.length, restore: d.restore.slice(0, 100).map(brief),
    unknown_count: d.unknown.length, unknown: d.unknown.slice(0, 50),
  };
}
