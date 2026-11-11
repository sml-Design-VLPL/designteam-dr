# Design Team DR Dashboard: what's left to do

Everything in this folder is filled in and tested locally with real data from all 11 month sheets.
The steps below need **you** (sign-ins, keys) or a **Claude coding session with the repo attached**.
You can delete this file once you're done.

## 1. Push to GitHub
Push this folder to https://github.com/sml-Design-VLPL/designteam-dr (branch `main`).
Either:
- open a Claude **coding session** with that repo attached (push access) and ask it to commit these files, or
- upload them in GitHub's web page (Add file → Upload files).

## 2. Vercel
Vercel → Add New → Project → import `designteam-dr` → Framework preset **Other**, no build command → Deploy.
Check the URL is **https://designteam-dr.vercel.app**. If it's different, tell Claude so `SITE` in
`api/basecamp/_lib.js` gets updated (the Basecamp connection depends on it).

## 3. Basecamp dates (turnaround, closed DRs)
1. Go to https://launchpad.37signals.com/integrations → **Register one now**
   - Name: `Design Team DR Dashboard`
   - Company: SUGAR Cosmetics · Website: https://designteam-dr.vercel.app
   - Redirect URI: `https://designteam-dr.vercel.app/api/basecamp/callback`
2. Vercel → designteam-dr → Settings → Environment Variables (Production, tick **Sensitive**):
   add `BASECAMP_CLIENT_ID` and `BASECAMP_CLIENT_SECRET` from that app. Then redeploy.
3. Open https://designteam-dr.vercel.app/api/basecamp/connect, approve with the Basecamp login that can see the
   team's to-dos (account 3985435). Copy the key shown into a new env var `BASECAMP_REFRESH_TOKEN` (Sensitive).
   Redeploy. Don't paste the key into chat.
4. Check https://designteam-dr.vercel.app/api/basecamp/closed shows `"ok": true`.

## 4. Scheduled refresh (twice a day)
> Now a cloud routine: see `scripts/refresh-routine.md` (current prompt and the two one-time setup needs). The text below is the original plan.

**Create this from a Claude coding session where `git push` to the repo already works**, and make sure the task
shows **automatic approval**. A task made from a plain chat reports "success" but never updates the site.
First make a one-time copy that runs 2–3 minutes later and check a new commit appears and the site's
"Updated" time changes. Only then create the recurring one (`CRON_TZ=Asia/Kolkata 36 10,16 * * *`).

Prompt for the task:

```
Refresh the Design Team DR Dashboard with today's data from the monthly Google Sheets. This runs unattended:
never ask questions or wait for a reply — decide, carry on, and report at the end. Only data.js and
bc_closed.json change; never edit index.html, api/, scripts/ or anything else.
- Sheets: one Google Sheet per month in Drive folder 1rr6kEhm_DtRlSWPU6C6lRQheCNlaYU6D, titled
  "NN Month YYYY, Design Team JSR" (e.g. "11 November 2026, Design Team JSR").
- GitHub repo: sml-Design-VLPL/designteam-dr (branch main). Vercel deploys every push. Live: https://designteam-dr.vercel.app
Steps:
1. ToolSearch "select:mcp__Google_Drive__search_files,mcp__Google_Drive__download_file_content,mcp__claude-code-remote__add_repo". If missing, wait ~20 s and retry once.
2. If add_repo is available, call it with owner "sml-Design-VLPL", repo "designteam-dr", access "push". Clone once:
   git clone --depth 1 https://github.com/sml-Design-VLPL/designteam-dr /home/claude/designteam-dr. If the clone fails, STOP and notify.
3. Basecamp cache: cd /home/claude/designteam-dr && Q=""; [ "$(TZ=Asia/Kolkata date +%u)" = "1" ] && Q="?full=1";
   curl -s --max-time 290 "https://designteam-dr.vercel.app/api/basecamp/closed$Q" -o /tmp/bc.json && python3 -I scripts/update_bc_cache.py /tmp/bc.json bc_closed.json
   If it fails, git checkout bc_closed.json and continue. "not_connected"/"refresh_failed" → the owner must reconnect at https://designteam-dr.vercel.app/api/basecamp/connect.
4. Drive search_files with query "parentId = '1rr6kEhm_DtRlSWPU6C6lRQheCNlaYU6D' and mimeType = 'application/vnd.google-apps.spreadsheet'"
   (follow nextPageToken). Keep files whose title matches "NN Month YYYY, Design Team JSR" for the current month and the
   previous month (on the 1st–5th of a month also the month before that). For each, download_file_content with
   exportMimeType application/vnd.openxmlformats-officedocument.spreadsheetml.sheet. Note each saved path; do not read them.
5. python3 -I scripts/build_data.py data.js YYYY-MM=<saved path> YYYY-MM=<saved path> ...
   (pip install openpyxl --break-system-packages if needed). Months not passed are kept as they are.
   Sanity: counts per month as of 11 Nov 2026 were Jan 360, Feb 346, Mar 365, Apr 313, May 327, Jun 275, Jul 301,
   Aug 403, Sep 365, Oct 438, Nov 92 (growing). Past months must not drop by more than a few rows. If they do,
   git checkout data.js, publish nothing, report.
6. git add data.js bc_closed.json && git commit -m "Data refresh <date>" && git push origin main; confirm with git ls-remote.
   If refused (403), don't try other routes — report the exact error.
7. Wait 90 s, then curl https://designteam-dr.vercel.app/api/basecamp/closed once to warm the cache.
8. Notify ONLY if something failed or needs the owner (failure emails: nitesh@sugarcosmetics.com). Otherwise end with a 2–3 line summary.
Do not touch any other repo, project, env var or scheduled task.
```

## 5. Later (you said "add on later")
- **Leavers:** tell Claude the name and month; it goes into `TEAM_EXITS` in `index.html`.
- **Auto-add DRs from Basecamp:** `sheet-script/DR-Sync.gs` needs reworking first, because your sheets are one
  file per month with a tab per brand, and the script expects one sheet with a tab per month.
- **Packaging tab:** left out for now (no assignees, mixed row layout). Can be added as its own brand if wanted.

## Done when
- [ ] Each month's count on the site matches the sheet (see counts above).
- [ ] `/api/basecamp/closed` → `ok: true`; Turnaround and Closed DRs show data.
- [ ] One-time test task pushed a commit and the site's "Updated" time changed.
- [ ] Recurring task shows automatic approval; no duplicate refresh tasks.
