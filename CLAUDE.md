# Design Team · DR Dashboard

One-page dashboard of the Design Team's DRs (deliverable requests), built from the monthly
"Design Team JSR" Google Sheets plus Basecamp dates. Static site on Vercel, deployed from GitHub.

## Links and ids (no secrets here — never add any)
- Live site: https://designteam-dr.vercel.app (update `SITE` in `api/basecamp/_lib.js` if Vercel gives another URL)
- Repo: https://github.com/sml-Design-VLPL/designteam-dr (branch `main`; every push redeploys)
- Drive folder with the month sheets: `1rr6kEhm_DtRlSWPU6C6lRQheCNlaYU6D` (owner nitesh@sugarcosmetics.com)
- Basecamp account: `3985435`
- Failure alerts: nitesh@sugarcosmetics.com
- Refresh: scheduled Claude task, `CRON_TZ=Asia/Kolkata 36 10,16 * * *`
- Secrets live only in Vercel env vars (Sensitive): `BASECAMP_CLIENT_ID`, `BASECAMP_CLIENT_SECRET`, `BASECAMP_REFRESH_TOKEN`

## How the sheets are laid out (differs from the original starter kit)
- **One spreadsheet per month** in the Drive folder, titled `NN Month YYYY, Design Team JSR`
  (e.g. `11 November 2026, Design Team JSR`). A new file appears each month.
- Inside each file: **one tab per brand** — `SUGAR`, `SUGAR POP`, `QUENCH`, sometimes `Molten`.
  Brand on the site = tab name (QUENCH → "Quench").
- Header row starts with `Task`. Columns used: Task (name + Basecamp hyperlink), Assigned To, Due On, Status,
  Details (New/Adapt/Changes) → "DR types", and `DR Raised on` when present (from Nov 2026).
- A row with only a date in column A is a **day divider**: rows under it were raised that day.
- **Skipped, never published:** `Packaging` (running log, no assignees, inconsistent rows), `Incomplete DR`,
  and any tab without a `Task` header (Yacht Activation, BWA, SM Media DR…).

## How the numbers work
- `scripts/build_data.py data.js 2026-10=<xlsx> 2026-11=<xlsx> …` — months passed replace those months in
  `data.js`; months not passed are kept.
- Each month's count = every DR row in that file's brand tabs (change rounds on the same to-do each count),
  except rows raised before that month that were already Done in an earlier file (repeats in running logs).
- Status: Done → Done; WIP / KV Done / Adapts Pending → In progress; Approval Pending → In review;
  On Hold → On hold; Incomplete Brief / awaiting for DR → Waiting; Pending or blank → Not started.
  (Mapping is `normStatus` in `index.html`.)
- A DR is Done if the sheet OR Basecamp says so; created/due/closed dates come from Basecamp, sheet as fallback.
- "All months" counts each DR once (by Basecamp to-do), at its latest status.
- Counts per month as of 11 Nov 2026: Jan 360, Feb 346, Mar 365, Apr 313, May 327, Jun 275, Jul 301,
  Aug 403, Sep 365, Oct 438, Nov 92 (in progress).
- Team (full names shown on the page via `TEAM` in `index.html`; sheets use first names): Nitesh → Nitesh Luthria,
  Ankita → Ankita Kambli, Ankita S → Ankita Sarmalkar, Gaurav → Gaurav Pathade, Sachin → Sachin Bangal,
  Sandrine → Sandrine Monterio. Nisha and Cecil also appear in older rows but aren't on the team list.

## Working rules
- The refresh changes only `data.js` and `bc_closed.json`. Don't edit `index.html`, `api/`, `scripts/` from it.
- Preview locally at 1440 / 1024 / 768 / 390 px before pushing page changes; nothing may run off the side.
- The site is public (no-index). Only DR month data goes into `data.js` — never other tabs.
- Plain wording on the page: Done / Pending / Late, "Not started", "Not assigned".
- `sheet-script/DR-Sync.gs` (auto-add from Basecamp) is NOT set up: it assumes one sheet with a tab per month
  and needs adapting to the one-file-per-month, tab-per-brand layout before use.
