# Cloud refresh routine

The data refresh runs as a **Claude Code cloud routine**, so it works with every PC switched off.

- Routine: "Design Team DR Dashboard refresh" — https://claude.ai/code/routines/trig_01SVKmL6P9znqgsFLSP541P5
- Schedule: `6 5,11 * * *` UTC = **10:36 and 16:36 IST**, every day
- Environment: Default (Anthropic cloud) · model `claude-sonnet-5-5`
- Repo checked out: `sml-Design-VLPL/designteam-dr` · connector: Google Drive only
- Allowed tools: Bash, Read, Write, Edit, Glob, Grep, ToolSearch

## What the cloud needs (one-time setup)
1. **GitHub push:** the Claude GitHub App must be installed on the `sml-Design-VLPL` org with access to
   `designteam-dr` (https://github.com/apps/claude/installations/select_target). Without it the push fails with 403.
2. **Network:** the cloud environment must be allowed to reach `designteam-dr.vercel.app` (Basecamp step).
   claude.ai/code → environment settings → network access: add `designteam-dr.vercel.app`
   (or use full network access). Without it the Basecamp dates are skipped, the sheet data still updates.

## Prompt (keep in sync with the routine)

```
Refresh the Design Team DR Dashboard with today's data from the monthly Google Sheets. This runs unattended:
never ask questions or wait for a reply — decide, carry on, and report at the end. Only data.js and
bc_closed.json change; never edit index.html, api/, scripts/ or anything else.
- Sheets: one Google Sheet per month in Drive folder 1rr6kEhm_DtRlSWPU6C6lRQheCNlaYU6D, titled
  "NN Month YYYY, Design Team JSR" (e.g. "11 November 2026, Design Team JSR").
- GitHub repo: sml-Design-VLPL/designteam-dr (branch main). It is already checked out in this session's working
  directory (find it with git rev-parse --show-toplevel; call that folder R). Vercel deploys every push to main.
  Live: https://designteam-dr.vercel.app
- Times are IST: use TZ=Asia/Kolkata for every date command.
Steps:
1. Load the Google Drive tools: ToolSearch with query "google drive search_files download_file_content" (max_results 10) and use
   the Drive connector's search_files and download_file_content tools. If missing, wait ~20 s and retry once. If still missing, STOP and report.
2. cd R && git fetch origin main && git checkout -B main origin/main (work on main itself, not a feature branch).
   Then python3 -m pip install -q openpyxl --break-system-packages (use "python3 -m pip", not "pip": they can be different Pythons).
3. Basecamp cache: Q=""; [ "$(TZ=Asia/Kolkata date +%u)" = "1" ] && Q="?full=1";
   curl -s --max-time 290 "https://designteam-dr.vercel.app/api/basecamp/closed$Q" -o /tmp/bc.json && python3 -I scripts/update_bc_cache.py /tmp/bc.json bc_closed.json
   If it fails, git checkout bc_closed.json and continue. "not_connected"/"refresh_failed" → the owner must reconnect at
   https://designteam-dr.vercel.app/api/basecamp/connect (say so in the report). If the proxy refuses the host, say the
   environment needs network access to designteam-dr.vercel.app.
4. Drive search_files with query "parentId = '1rr6kEhm_DtRlSWPU6C6lRQheCNlaYU6D' and mimeType = 'application/vnd.google-apps.spreadsheet'"
   and excludeContentSnippets true (follow nextPageToken). Keep files whose title matches "NN Month YYYY, Design Team JSR" for the
   current month and the previous month (on the 1st–5th of a month also the month before that). For each, download_file_content with
   exportMimeType application/vnd.openxmlformats-officedocument.spreadsheetml.sheet. If the result names a saved file path, use it;
   if it returns base64 content instead, decode it to /tmp/YYYY-MM.xlsx with python3. Do not read the files.
5. python3 -I scripts/build_data.py data.js YYYY-MM=<xlsx path> YYYY-MM=<xlsx path> ...
   Months not passed are kept as they are.
   Sanity: counts per month as of 11 Nov 2026 were Jan 360, Feb 346, Mar 365, Apr 313, May 327, Jun 275, Jul 301,
   Aug 403, Sep 365, Oct 438, Nov 92 (growing). Past months must not drop by more than a few rows. If they do,
   git checkout data.js, publish nothing, report.
6. git add data.js bc_closed.json && git -c user.name="DR Dashboard refresh" -c user.email="noreply@anthropic.com" commit -m "Data refresh $(TZ=Asia/Kolkata date '+%Y-%m-%d %H:%M IST')"
   && git push origin HEAD:main. If rejected as non-fast-forward, git pull --rebase origin main once and push again.
   Confirm with git ls-remote origin refs/heads/main that the remote matches git rev-parse HEAD.
   If refused (403/permission), don't try other routes or branches — report the exact error.
7. Wait 90 s, then curl -s https://designteam-dr.vercel.app/data.js | head -c 80 and check fetchedAt is the new one; then curl
   https://designteam-dr.vercel.app/api/basecamp/closed once to warm the cache (skip if the host is blocked).
8. End with a 2–3 line summary: per-month counts that changed, commit hash, fetchedAt — or the exact failure and what the owner must do.
Do not touch any other repo, project, env var or routine.
```
