# Ingestion roots and pipeline hardening

**26 October 2026. Branch `claude/ingestion-folders` (worktree `~/sam-accops-ingest`), not pushed, not merged.**
Two jobs: (1) add a second SharePoint folder to SAM, `Sales/Other Sales Tools/2025_Sales Enablement`, designed as
a list of folders rather than a one-off; (2) audit ingestion and maintenance for ways an answer can end up wrong or
invented, and fix the cheap ones with a check.

Evidence was gathered read-only: Supabase REST reads (registry, cards, passages, views, run log), the two Power
Automate flow definitions, and a SharePoint folder listing through the flow connector. No database writes, no
migrations, no flow edits.

---

## 1. Findings, ranked by impact

| # | Finding | Evidence (26 Oct 2026) | Fix | Status |
|---|---|---|---|---|
| 1 | **Cards whose file was archived or deleted still answered.** The families view keeps "cards with no live file", which includes a card whose own registry row is in an archive folder or deleted. | 25 cards are bound to archived rows. 9 of them were eligible (6 answerable today), e.g. *Polycab case study* (in `zCase Studies (Archive_DONOTUSE)`), *About Accops V1 2025*, *CXO Goa Event June 2026* (`_archieve(d)`), five 2022 Gartner Peer Insights reviews. Deleted: 0 today, but no rule stopped one. Passages of such a card were served to SAM Live. | `eligibility()` + SQL mirror: card bound to a **deleted** row is out (beats a pin) and its passages are never served; bound to an **archived** row is out unless pinned. `family-parity.mjs` against today's view: exactly these 9 differ. | **Done** (cards.ts, registry-cache.ts, passages.ts; SQL part 3). family.check +8, passages.check +1 |
| 2 | **Card figures that are not in their own document.** | `card_grounding.py` over 384 cards vs local text: **57 of 1,609 figures (3.5%) in 41 cards** not found. Confirmed error: *Cloud vs On-premise Cost Comparison* said "sized for about **20,000** users"; the deck's own totals give **2,000** (Rs 8,61,10,150 / Rs 43,055.08). Cross-document carry-overs: *Turbo performance comparison* (benchmark figures from a sibling deck, stated on the card), *DaaS Calculator v2.3* (2026 offers from "newer pricing"). *Economic Times 2021* article: 7 of 7 figures read from the page image (card says so). The rest are the carder's own counts ("24 capabilities", "about 65 logos"). | New `prototype/card_grounding.py` (unit restatements and rounding count as backed); added to the nightly gate (skill copy). The TCO card corrected in `batch-11.json`. | **Done**; self-check ok. Card fix loads on the next `load_cards.py` |
| 3 | **Passages lost chart and table values.** The passage builder dropped every bare 1-3 digit line as a page number. | Turbo benchmark "258" (Mbps, OpenVPN) is in six documents' text and in none of their passages. The grounding audit against passages reads 109 unbacked (6.9%) vs 57 (3.5%) against the text. | A bare number is dropped only when it is the page/slide's own number (±2). `EXTRACTOR` bumped to `@2`: the next nightly run rebuilds all passages once (dry run: 362 docs, 12,762 passages, was 12,728). | **Done**; build_passages self-check +1 |
| 4 | **An edit hidden behind a rename was never re-carded, and nobody was told.** Queue precedence is renamed-before-changed, and the skill leaves "renamed" for a human. | The two *Partner Bootcamp 4Hour 2026* decks: edited 9 Oct, carded 26 Sep / 5 Oct, queue said "renamed" from 13 Oct; 12+ nights of `carding: warn` in sam_ops_runs. The digest's Needs a look only shows failed/refused jobs, so it never appeared there. (Sources re-pointed today in 582b1b7, so tonight they show as changed_since_card.) | `carding_prep.py`: renamed + modified after the card → re-carded in place (`card_source` = the bound card); pure rename skipped. Digest: any file waiting > 3 days to be carded goes to Needs a look. | **Done**; carding_prep self-check +2, digest.check +2 |
| 5 | **A missed change notification left a card stale for good.** Nothing compared SharePoint's modified date with the registry's after the fact. | The snapshot listed only id/name/path. The change flow is a 1-minute poll; a missed run is silent. | The snapshot (once the flow sends `Modified`) brings `modified_at` / filename / folder forward for any file edited or renamed after the registry last heard, which re-queues it for carding. Capped at 200 per run; the digest no longer calls such a snapshot "clean". | **Done** in code; needs the PA field change (section 3) |
| 6 | **Registry reads capped at 1,000 rows in the card loader.** `limit=5000` returns at most 1,000 (PostgREST max-rows). | Registry is 880 rows today; the new folder takes it past 1,000. Cards bound to rows after the 1,000th would silently lose their binding. | `load_cards.py` and `build_passages.py` page every read (`rest_all`). | **Done**; load_cards self-check +1. Proposed: page `family-parity.mjs` too (limit=1000) |
| 7 | **Bulk-copied folder dates would make old files eligible.** Uncarded files use their modified year. | In 2025_Sales Enablement nearly every file shows LastModified 2026-01-15 09:43:26 (one bulk copy). A 2020 case study there would be "2026". | `sam_ingest_roots.trust_file_dates = false` for that root: only a year read from the body counts. | **Done** (TS + SQL part 3) |
| 8 | **33 answerable documents have no file in the library and no link.** | 33 unbound `inventory/*` cards (laptop copies re-carded 6 Oct) are answerable with no SharePoint file and no public URL, so a rep is told a filename they cannot find, and deletion can never reach them. Some may be in the new folder under another name (e.g. *Private Bank Case Study - VDI-ZTNA-MFA*). | Re-run the count after the new folder is ingested; bind the ones that turn up, then decide the rest: exclude as "no file in the library" or keep. | **Proposed** (Siddharth decides) |
| 9 | **Company figures contradict each other across answerable cards.** | Customer count in answerable cards: 1000+ (15 cards), 900+ (7), 800+ (3), 850+ (1), 600 (1). Users: "2M" (15) vs "1.6 million" (7). | One canonical company-facts entry (count, as-of date) in the core reference lists; the answer path quotes it instead of whatever deck won. | **Proposed** |
| 10 | **"Temporary" pins never expire.** | 10 pins by "claude (6 Oct)", reason "Temporary - pending the technical content manager's old-assets review", 20 days old; 7 of the 9 answerable undated cards answer only because of them. | A digest line for pins older than 30 days whose reason says temporary. | **Proposed** |
| 11 | **The nightly job can stall on git.** Step 1 is `git pull --ff-only`; other agents push to main. If a night's push fails and main moves, every later night stops. | Not observed yet. The run would log `failed`, which the digest does show. | Use `git pull --rebase` for the carding job (it only commits `corpus/cards/*.json`). Clarified in the skill copy that only gate-passing card files are committed (load_cards loads every batch nightly, so a committed-unloaded card heals next night). | Text **done**; pull change **proposed** |
| 12 | "NeedUpdate-" files would answer. | The new folder has *NeedUpdate-Accops Banking Short Deck_jan 2025.pptx* (74 MB). | `needs? ?update` added to the archive-folder rule (TS + sp_tags.py). No current row matches. | **Done** |
| 13 | Laptop off, carding does not run. | Verified in code: carding/carding_prep with no run for 30 h → digest line (the digest flow runs in Power Automate, not on the laptop). | Already covered; finding 4's 3-day queue alert adds the backlog view. Moving carding off the laptop stays proposed (architecture doc). | Verified |
| 14 | Smaller checks, all clean | Cards git vs DB 384 = 384; passages older than their card's carded_at: 0; files modified after their passages were built: 0; duplicate card titles: 0; live rows without list_item_id: 0; card tags outside core.terms: 1 (competitor "Aspect"). 40 stems appear in 80 active rows (twins and copies, merged by design). 31 carded documents have no publish_year (9 answerable: 2 by modified year 2024, 7 by the temporary pins). | - | - |

---

## 2. Multi-root design

**A root** is one SharePoint folder SAM reads, with everything under it. Roots live in a table,
`sam_ingest_roots` (key, label, library_path, onedrive_folder, trust_file_dates, enabled). Every registry row gets
`root` (default `sales-collateral`); `folder` keeps its meaning, the path inside its root. `scope` stays `sales`
(it is the team, and every view already filters on it), so the carding queue, families view, v1 brain views,
digest and admin pages include a new root's files with no change.

Until the table exists, or if it cannot be read, the web code and carding_prep fall back to today's one root, so
Sales Collateral can never be stopped by the table. A disabled root's changes and snapshot files are ignored; its
existing rows are left as they are.

### Every place the single root was assumed

| Place | Before | Now |
|---|---|---|
| Change route (`applyChange`, `applyDelete`) | `scopeRelative()` with hard-coded prefixes; a path outside them was stored as a Sales Collateral folder | `rootOf(path, roots)`: longest enabled root wins; outside every root → ignored and logged. Row lookup is `(root, folder, filename)` |
| Snapshot route | One diff, one 90% coverage guard over the whole listing | Split by root, one diff and guard per root: one root's failed listing refuses that root only. Body-level guards (paging incomplete, truncated, page cap, bad ids) still refuse all. Moves between roots are re-filed, not tombstoned. Files the registry never saw are added when the flow sends their URL (`item_id = li:<list item id>`, `last_synced` = the file's own date so change-flow liveness is untouched). `last_run` is stamped only when no root was refused, so the 36-hour banner keeps firing for a broken root |
| Snapshot flow filter | `FileDirRef` = Sales Collateral | Add the new folder to the same filter (section 3) |
| Change trigger | One folder | One flow per root (a copy, section 3) |
| `sam_sharepoint_sync` | One row per scope | Unchanged: per-root outcome is in `last_result` (" \| root: ...") and `sam_ops_runs.details.roots` |
| `carding_prep.py` | `%USERPROFILE%\OneDrive - Accops...\Company - Sales Collateral` | Each row's root → `onedrive_folder`; a root not on the laptop is skipped with that reason |
| Registry → answer location | "file, in Competition/VDI" | Non-default roots name themselves: "file, in Other Sales Tools/2025_Sales Enablement/Industries/Banking" |
| web_url | Graph / flow `{Link}` | Seeded rows use SharePoint's `EncodedAbsUrl` (a real URL, not constructed). Office files then open by direct path rather than `Doc.aspx`; `safeLink()` unchanged |
| Families / eligibility | modified year stands in for an undated file | Not for a root with `trust_file_dates = false` |
| Digest | Change list and "0 unknown" | Unchanged text format; root detail appended; missed edits and stuck files raise Needs a look |
| Admin counts | "878 tracked" | Still one total. **Proposed:** a per-root split on the System tab (group by `root`) |
| Card source `sharepoint/<filename>`, `corpus/sharepoint/<filename>` | Flat by filename | **Known limit, unchanged:** the same filename in two roots is treated as one document (consistent with today's dedupe). After seeding, check with the query in section 3 step 7 |

### The new folder, as seen on 26 Oct 2026

Same site and library as Sales Collateral (list `4675d6a1-...`). Top level: `Industries/` (12 industry folders, each
with Case studies, Short PPT, Cheat sheets, Discovery doc, Use Cases, Brochures, Raw verbatim, playbooks),
`Key Case Studies by Vijender/` (5 industries, docx drafts + PDFs), `Technical solutions/` (16 use-case folders),
plus a few loose files (*Sales Playbook for Pharma & Hospitals*, *Content Creation_0201.xlsx*, *Sales Knowledgebase
Universe.xlsx*, a 57 MB SKO deck). Only part of the tree was listed; the exact count comes from the report-mode
snapshot (section 3 step 3), where it appears as "N outside every root". Estimate: 150-300 files.

Default policy applied (same as today): internal unless a verified public link; pre-2024 excluded unless exempt or
pinned; archive/WIP/raw/NeedUpdate folders and files excluded. `Raw verbatim for content creation` folders are
excluded by the existing "raw" rule.

**What the card schema handles badly for sales tools** (rules added to the skill copy):
- Playbooks, cheat sheets, discovery docs, quick-reference cards: no "Playbook" label in core.terms → "Sales Tool".
- Spreadsheets (calculators, trackers): only cell labels are extracted; passages skip them. Card as "Sales Tool",
  never quote a figure from a cell. *Content Creation* and *Sales Knowledgebase Universe* are internal trackers,
  probably not answer material: Siddharth may want them excluded.
- Industry *Critical Infra / Utilities* has no core.terms label: left empty (stored as Cross-industry) and logged.
- Dates: the folder name (2025_) and the copy dates are not a year; many playbooks will have no year in the body and
  will be "year unknown" until Siddharth pins or a year is added.
- Same case study in two places: four files here duplicate files in Sales Collateral's `zCase Studies
  (Archive_DONOTUSE)` (Kalupur Bank, 3rd largest Public Bank, South India Bank, Deutsche Bank). They merge by
  filename, so the Deutsche Bank study (2024) becomes answerable again through its live copy here. One folder says
  "do not use", the other "key case study": Siddharth should pick.
- Verbatim docs (*Bank Verbatim*, *Verbatium by Vijender*) are raw customer quotes: carding keeps real names in
  `client_actual` only, as for every card.

---

## 3. Approval block

Order matters: the code writes `sam_sharepoint_files.root`, so **apply the SQL before deploying the branch**.

1. **SQL** - apply `docs/supabase-sam-ingest-roots.sql` (project `iwqhayuoxnrhqzozznes`): table `sam_ingest_roots`
   with two rows (`sales-enablement` **disabled**), column `root` (default backfills all 880 rows), index, and the
   `sam_asset_families` view replaced with the two new rules (deleted/archived cards; untrusted dates).
   Then from `web/`: `node scripts/family-parity.mjs` → expect **0 differences** (before the SQL, against today's view,
   the branch shows exactly the 9 of finding 1).
2. **Deploy** the branch (merge to main). `node scripts/checks.mjs` passes on the branch (13 suites), and the four
   Python self-checks pass. Copy `ops/nightly-carding/SKILL.md` over `~/.claude/skills/sam-nightly-carding/SKILL.md`.
   The first nightly run after merge rebuilds all passages once (extractor @2) and loads the corrected TCO card.
3. **Power Automate, "SAM - daily SharePoint snapshot"** (`7fe4a4f0-301a-43b3-8c47-928752f4f822`), three edits:
   - `Init_next` value:
     ```
     _api/web/lists(guid'4675d6a1-a0a9-487e-a1e5-9c817b5ba763')/items?$select=ID,FileLeafRef,FileDirRef,FSObjType,EncodedAbsUrl,Created,Modified,File_x0020_Size,Editor/Title&$expand=Editor&$orderby=ID&$top=5000
     ```
   - `Keep_sales_collateral` (Filter array) condition, advanced mode:
     ```
     @or(equals(item()?['FileDirRef'], '/sites/Company/Shared Documents/Sales/Sales Collateral'), startsWith(item()?['FileDirRef'], '/sites/Company/Shared Documents/Sales/Sales Collateral/'), equals(item()?['FileDirRef'], '/sites/Company/Shared Documents/Sales/Other Sales Tools/2025_Sales Enablement'), startsWith(item()?['FileDirRef'], '/sites/Company/Shared Documents/Sales/Other Sales Tools/2025_Sales Enablement/'))
     ```
   - `Select_files` map: keep `id`, `name`, `path`, `isFolder`; add
     `"url": "@item()?['EncodedAbsUrl']"`, `"modified": "@item()?['Modified']"`, `"created": "@item()?['Created']"`,
     `"size": "@item()?['File_x0020_Size']"`, `"editor": "@item()?['Editor']?['Title']"`.
   - Leave `Post_snapshot_to_SAM` as it is, but for the first test set `"mode": "report"`, run the flow manually,
     and read the HTTP response: expect `sales-collateral` with 878 listed, 0 tombstoned, a `missed edits` count
     near 0 (if it is in the hundreds, the date formats differ: stop and tell Claude), and "N outside every root" =
     the new folder's file count. Then set `"mode": "write"` again. If `$expand=Editor` errors, drop `Editor/Title`
     and `$expand=Editor` and the `editor` key: it is optional.
4. **Siddharth's OneDrive step** (below), then confirm the folder name it created; if it is not
   `Company - 2025_Sales Enablement`, update `sam_ingest_roots.onedrive_folder`.
5. **Enable the root**: `update sam_ingest_roots set enabled = true where key = 'sales-enablement';`
6. **Power Automate, the change trigger**: open "SAM - Sales Collateral changed" (`75e43d49-a5ba-4acd-878c-f710617dfdae`)
   → Save As "SAM - 2025_Sales Enablement changed" → in the copy, trigger *Folder* =
   `/Shared Documents/Sales/Other Sales Tools/2025_Sales Enablement` → Save → Turn on. Nothing else changes (the
   server works out the root from `{Path}`; the copy already carries the secret).
7. **Seed and check**: the next 02:00 snapshot (or a manual run in write mode) adds the folder's files ("N added").
   Then: `select root, count(*), count(*) filter (where suggest_ingest) from sam_sharepoint_files where not deleted group by root;`
   and for filename collisions across roots:
   `select lower(filename), array_agg(root) from sam_sharepoint_files where not deleted and status='active' group by 1 having count(distinct root) > 1;`
8. **First carding of the backlog** in a supervised Claude session: `carding_prep.py --limit 40`, a few batches,
   commit after each (the nightly 15/night would take weeks; until carded those files do not answer, by design).

### Only Siddharth can do

1. Approve the folder and the default policy above (internal unless public link; pre-2024 rule; archive, WIP, raw,
   NeedUpdate out).
2. In SharePoint (Company site → Documents → Sales → Other Sales Tools), select **2025_Sales Enablement** →
   **Add shortcut to My files**. Then in File Explorer under *OneDrive - Accops Systems Private Limited*, right-click
   the new shortcut folder → **Always keep on this device**. Check there is disk space: some decks are 57-74 MB.
3. Decide: the 33 laptop-only cards with no file in the library (finding 8); the 10 "temporary" pins (finding 10);
   pin *About Accops V1 2025* and *CXO Goa Event June 2026* back if they should still answer (they are in archive
   folders, finding 1); the archived-vs-key case study conflict (section 2); whether the two tracker spreadsheets
   should be excluded.
4. Give one canonical customer count and user count with an as-of date (finding 9).

---

## 4. Maintenance contract

What every channel (web app, website bot, WhatsApp, Teams, SAM Live) can rely on.

| When (IST) | Job | Writes | Alerts when it does not happen or goes wrong | Who fixes |
|---|---|---|---|---|
| Within ~1 min of a change | One "... changed" flow per root → `/api/channels/sharepoint` | Registry row (root, folder, link, dates); outside every root → ignored | Digest: no change written for 96 h *and* the last snapshot was not clean (unknown files or missed edits) | Claude (flow), Siddharth (connection) |
| 02:00 | Snapshot flow → `/snapshot` | Per root: tombstone, restore, re-file moves, add unseen files, bring missed edits forward | Run goes red (409) on any refusal; `snapshot` job refused → digest; deletions not applied for 36 h → digest | Claude |
| 07:00 | Nightly carding (laptop) | Cards (git + DB), passages; gate includes grounding | No run for 30 h → digest; any file waiting > 3 days → digest; `failed` → digest | Claude; Siddharth if the laptop was off |
| 08:00 | Health cron + rollup | Counts, metrics | No run for 30 h → digest | Claude |
| 08:30 | Morning digest (Power Automate) | Email | Its own silence (no email) | Siddharth notices; Claude fixes |
| On demand | `card_grounding.py --db`, `family-parity.mjs`, `checks.mjs` | Nothing | A rate above the last audit (3.5% vs text) or any parity difference | Claude |

**Invariants the core guarantees to channels:** a document whose file was deleted never answers and is never
quoted; a document in an archive folder answers only if an admin pinned it; a year comes from the document body or
from trustworthy file dates, never from a copy date or filename; one root's broken listing never deletes another
root's files; every figure on a new card was checked against its own file at carding time.

**Adding a folder later:** one `sam_ingest_roots` row (disabled), the snapshot filter's two extra terms, a copy of the
change flow, Siddharth's OneDrive shortcut, then enable the row and card the backlog (steps 3-8).

---

## Branch contents

| Commit | What |
|---|---|
| 41f95b2 | Roots table + `root` column (SQL), `rootOf`, per-root snapshot, NeedUpdate rule |
| de180a3 | Deleted/archived cards out, untrusted dates, location label; SQL view mirror |
| b91da89 | carding_prep roots + renamed-and-edited; paged reads in load_cards/build_passages |
| 77f9693 | `card_grounding.py`; passages keep chart/table values (extractor @2) |
| 5051420 | Digest: files waiting > 3 days |
| b4703e8 | Skill copy: renamed handling, grounding gate, sales-tools rules |
| 06a5df3 | Snapshot catches missed edits and in-place renames |
| f7db564 | TCO card: 2,000 users, not 20,000 |
