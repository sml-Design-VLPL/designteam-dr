#!/usr/bin/env python3
"""Build data.js for the Design Team DR dashboard from the monthly "Design Team JSR" spreadsheets.

The team keeps ONE Google Sheet PER MONTH (e.g. "11 November 2026, Design Team JSR") in one Drive folder.
Inside each file there is one tab per brand (SUGAR, SUGAR POP, QUENCH, Molten, ...).

Usage:
  python3 -I scripts/build_data.py data.js 2026-10=<file> 2026-11=<file> ...

Each <file> is the .xlsx export of that month's sheet (or the JSON wrapper a Drive download saves, with a
base64 "content" field). Months you pass replace those months in data.js; months you don't pass are kept as
they were, so one failed download never wipes a month.

What is read in each tab:
  - Header row whose first cell is "Task". Columns found by name: Assigned To, Due On, Status,
    Details (New/Adapt/Changes) -> type, "DR Raised on" (optional) -> raised.
  - A row with only a date in column A is a day divider: the rows under it were raised that day.
  - Task cell = DR name, its hyperlink = Basecamp to-do.
Tabs skipped (never published): Packaging, Incomplete DR, and any tab without a "Task" header.
Rows dropped: a row raised before the file's month that was already Done in an earlier month's file
(running logs repeat old rows). Several rows for one to-do inside a month (change rounds) are all kept,
so each month's count matches its sheet.
"""
import base64, datetime, io, json, os, re, sys
import openpyxl

MONTHS = ["january", "february", "march", "april", "may", "june", "july",
          "august", "september", "october", "november", "december"]
SKIP_TABS = {"packaging", "incomplete dr"}
BRAND_NAMES = {"SUGAR": "SUGAR", "SUGAR POP": "SUGAR POP", "QUENCH": "Quench", "MOLTEN": "Molten"}


def txt(v):
    return "" if v is None else str(v).strip()


def day(v):
    if isinstance(v, datetime.datetime):
        return v.date()
    if isinstance(v, datetime.date):
        return v
    return None


def clean_link(u):
    if not u:
        return None
    u = u.strip()
    u = re.sub(r"^https://app\.basecamp\.com/", "https://3.basecamp.com/", u)   # same to-do, two hostnames
    u = re.sub(r"/edit(\?.*)?$", "", u)
    u = re.sub(r"\?.*$", "", u)
    return u if u.startswith("https://") else None


def todo_id(link):
    m = link and re.search(r"/todos/(\d+)", link)
    return m.group(1) if m else None


def load(path):
    raw = open(path, "rb").read()
    if not raw.startswith(b"PK"):                  # Drive JSON wrapper
        raw = base64.b64decode(json.loads(raw)["content"])
    return openpyxl.load_workbook(io.BytesIO(raw), data_only=True)


def parse_month(path):
    wb = load(path)
    rows = []
    for ws in wb.worksheets:
        tab = ws.title.strip()
        if tab.lower() in SKIP_TABS:
            continue
        hdr_row = None
        for r in ws.iter_rows(min_row=1, max_row=10, max_col=12):
            if txt(r[0].value).lower() == "task":
                hdr_row = r[0].row
                hdr = [txt(c.value).lower() for c in r]
                break
        if hdr_row is None:
            continue
        def ix(*keys):
            for i, h in enumerate(hdr):
                if any(h.startswith(k) for k in keys):
                    return i
            return -1
        iA, iD, iS, iT, iR = ix("assigned to"), ix("due on", "due"), ix("status"), ix("details"), ix("dr raised on")
        brand = BRAND_NAMES.get(tab.upper(), tab)
        current_day = None
        for r in ws.iter_rows(min_row=hdr_row + 1, max_col=max(iA, iD, iS, iT, iR) + 1):
            g = lambda i: r[i].value if 0 <= i < len(r) else None
            a = r[0].value
            if day(a) and not any(txt(g(i)) for i in (iA, iD, iT) if i >= 0):
                current_day = day(a)              # day divider row
                continue
            name = txt(a)
            if not name or name.lower().startswith("http"):
                continue
            link = clean_link(r[0].hyperlink.target if r[0].hyperlink else None)
            raised = day(g(iR)) or current_day
            rows.append({
                "name": name, "link": link,
                "raised": raised.isoformat() if raised else None,
                "due": day(g(iD)).isoformat() if day(g(iD)) else None,
                "brand": brand, "assigned": txt(g(iA)),
                "type": txt(g(iT)) or None, "status": txt(g(iS)),
            })
    return rows


def main():
    out, pairs = sys.argv[1], sys.argv[2:]
    if not pairs:
        sys.exit("Give at least one YYYY-MM=<file>")
    old = {}
    if os.path.exists(out):
        try:
            js = open(out, encoding="utf-8").read()
            for t in json.loads(js[js.index("{"): js.rindex("}") + 1])["tabs"]:
                old[(t["year"], t["month"])] = t
        except Exception:
            old = {}
    new = {}
    for p in pairs:
        key, path = p.split("=", 1)
        y, m = (int(x) for x in key.split("-"))
        new[(y, m - 1)] = parse_month(path)

    tabs = {k: v for k, v in old.items() if k not in new}
    for (y, m), rows in new.items():
        tabs[(y, m)] = {"tab": MONTHS[m].capitalize(), "year": y, "month": m, "hasType": True, "rows": rows}

    # De-duplicate in month order
    done_before = set()
    for k in sorted(tabs):
        y, m = k
        start = datetime.date(y, m + 1, 1)
        kept = []
        for r in tabs[k]["rows"]:
            tid = todo_id(r["link"])
            key = "bc:" + tid if tid else (r["name"].lower() + "|" + r["brand"])
            early = r["raised"] and r["raised"] < start.isoformat()
            if early and key in done_before:
                continue
            kept.append(r)
        tabs[k]["rows"] = kept
        for r in kept:
            if r["status"].strip().lower() == "done":
                tid = todo_id(r["link"])
                done_before.add("bc:" + tid if tid else (r["name"].lower() + "|" + r["brand"]))

    ordered = [tabs[k] for k in sorted(tabs)]
    if not ordered or not any(t["rows"] for t in ordered):
        sys.exit("No DRs found - sheet format changed? Aborting, site left untouched.")
    ist = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
    payload = {"fetchedAt": datetime.datetime.now(ist).isoformat(timespec="minutes"), "tabs": ordered}
    with open(out, "w", encoding="utf-8") as f:
        f.write("window.DR_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n")
    for t in ordered:
        mark = "" if (t["year"], t["month"]) in new else "  (kept from before)"
        print(f'{t["tab"]} {t["year"]}: {len(t["rows"])} DRs, {sum(1 for r in t["rows"] if r["link"])} with links{mark}')


main()
