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

/** Record one change in SAM's registry. Touches nothing in SharePoint. */
export async function applyChange(f: IncomingFile): Promise<string> {
  if (!configured()) return "skipped: supabase not configured";

  if (f.event === "deleted") {
    // Soft delete. A tombstone lets the catalogue explain a disappearance, and SAM citing a
    // document that no longer exists is worse than SAM missing one.
    await rest(`sam_sharepoint_files?item_id=eq.${encodeURIComponent(f.itemId)}`, {
      method: "PATCH", body: JSON.stringify({ deleted: true, deleted_at: new Date().toISOString() }),
    });
    return "marked deleted";
  }

  const folder = (f.folder ?? "").replace(/^\/+|\/+$/g, "");
  const name = f.name ?? "";
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const t = tagsFor(folder, name, f.scope ?? "sales");
  await rest("sam_sharepoint_files?on_conflict=item_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{
      item_id: f.itemId, drive_id: f.driveId ?? "", scope: f.scope ?? "sales", folder, filename: name,
      ext, size_bytes: f.size ?? 0, web_url: f.webUrl ?? "",
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
};

/** Registry read for the catalogue and the reconcile report. */
export async function registry(scope = "sales", limit = 2000): Promise<RegistryRow[]> {
  if (!configured()) return [];
  return (await rest(`sam_sharepoint_files?scope=eq.${scope}&deleted=is.false&select=*&limit=${limit}&order=modified_at.desc`)) as RegistryRow[];
}
