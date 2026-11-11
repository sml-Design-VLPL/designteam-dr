#!/usr/bin/env python3
"""Merge ticked-off to-dos from the live /api/basecamp/closed answer into bc_closed.json.

Usage: python3 -I scripts/update_bc_cache.py <answer.json> bc_closed.json
- Adds/updates every to-do the answer says is closed.
- If the answer was a full re-check (?full=1), to-dos that are no longer closed (reopened) are removed.
"""
import json, sys, datetime
ans = json.load(open(sys.argv[1]))
if not ans.get("ok"):
    sys.exit("Basecamp answer not ok: %s — cache left unchanged" % ans.get("reason"))
try:
    cur = json.load(open(sys.argv[2]))["todos"]
except Exception:
    cur = {}
todos = ans.get("todos", {})
if ans.get("full"):
    cur = {k: v for k, v in cur.items() if k not in todos or todos[k].get("closed")}
for k, v in todos.items():
    if v.get("closed"):
        cur[k] = v
    elif k in cur and ans.get("full"):
        cur.pop(k, None)
json.dump({"updated": datetime.date.today().isoformat(), "todos": cur}, open(sys.argv[2], "w"), separators=(",", ":"))
print("bc_closed.json:", len(cur), "closed to-dos cached")
