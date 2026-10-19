# TASK: turn on the daily SharePoint snapshot flow

**Written 25 September 2026.** Closes the deletions gap (sam-how-it-works section 3, gap 3).

## What exists

- **Endpoint** `POST /api/channels/sharepoint/snapshot` (`web/app/api/channels/sharepoint/snapshot/route.ts`,
  logic in `diffSnapshot()` / `applySnapshot()` in `web/lib/sharepoint.ts`). Live only after the branch is
  merged and Vercel deploys. Until then the flow would get a 404.
- **Flow** `SAM - daily SharePoint snapshot`, id `7fe4a4f0-301a-43b3-8c47-928752f4f822`, environment
  "Accops Systems Private Limited". **Stopped.** Daily at 02:00 India Standard Time:
  1. `Page_through_library` (Do until `next` is empty): `Send an HTTP request to SharePoint`
     `GET _api/web/lists(guid'4675d6a1-...')/items?$select=ID,FileLeafRef,FileDirRef,FSObjType&$orderby=ID&$top=5000`,
     keep rows whose `FileDirRef` is `/sites/Company/Shared Documents/Sales/Sales Collateral` or under it,
     then follow `odata.nextLink`. ID-ordered paging is the list-view-threshold-safe way to read the
     whole library (~14.2k items, 3 pages on 19 Oct 2026).
  2. `Select`: `{ id: ID, name: FileLeafRef, path: FileDirRef minus "/sites/Company/" + "/", isFolder: FSObjType = 1 }`.
  3. `HTTP` POST to the endpoint with `mode: "write"`, `complete: empty(next)` (true only when paging reached
     the last page), `count: length(Select)`, `files`.
  It uses the same SharePoint connection as the working "changed" flow.

  **Why not `Get files (properties only)`** (the original step 1): from 1 Oct 2026 it silently dropped the
  283 oldest files (list item IDs 8394-9933, created Jul 2021 - Apr 2022) while still reporting Succeeded.
  The <90% guard refused every night (409), 16 failures in a row, and Power Automate suspended the flow.
  Replaced 19 Oct 2026; first report run: 878 listed, 878 matched, 0 tombstone, 0 unknown.

## Needs Siddharth: paste the secret (1 minute)

The flow was created with the placeholder `PASTE_SP_WEBHOOK_SECRET_HERE` in the HTTP body. Claude was not
allowed to copy the secret into it, which is the right call for a credential.

1. Open the flow **SAM - daily SharePoint snapshot**, then **Edit**.
2. Open the existing flow **SAM - Sales Collateral changed** (`75e43d49-...`) in a second tab, open its
   **Notify SAM** HTTP action, and copy the `secret` value from the body.
3. In the snapshot flow, open **Post snapshot to SAM** and replace `PASTE_SP_WEBHOOK_SECRET_HERE` with it.
4. While in the designer, open **Get files** and check that **Limit Entries to Folder** shows
   `/Shared Documents/Sales/Sales Collateral` and **Include Nested Items** is **Yes**. The definition was
   written by hand, so this confirms the designer read the parameters the same way.
5. **Save.** Leave the flow **off** until the endpoint is deployed.

## After the deploy (orchestrator or Siddharth)

1. Turn the flow on and **Run** it once manually. It is in report mode: nothing is written except
   `sam_sharepoint_sync.last_result`.
2. Read the result in the run history (the HTTP action's output body) or with
   `select last_result from sam_sharepoint_sync where scope='sales'`:
   - `listed` should be about 876 (it counts files only; folders are dropped).
   - `tombstone_count` should be small, and every entry in `tombstone` should be a file that really is gone
     from SharePoint. Spot-check two by opening the folder.
   - `unknown_count` = files in SharePoint the change flow never recorded. Worth a look, not an error.
   - A **409** means a guard refused (empty, not marked complete, count mismatch, pagination cap, under 90%
     of live rows, or more than 10% missing by id). The message says which. Nothing was written.
3. Only when two runs look right, change `"mode": "report"` to `"mode": "write"` in the HTTP body and save.
   From then on each run stamps `sam_sharepoint_sync.last_run`, which clears the dashboard's
   "deletions not checked" banner. Report-mode runs deliberately do **not** stamp `last_run`, because they
   remove nothing.
