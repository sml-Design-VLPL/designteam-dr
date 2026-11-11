/**
 * DR Sync (TEST) — adds new Basecamp DRs to this sheet automatically.
 * Lives only in this Google Sheet. Talks to Basecamp directly.
 *
 * HOURLY (syncNewDRs): Basecamp to-dos newly assigned to the people in CFG.watch are added to the current
 *   month's tab, below the last DR: DR = title with the Basecamp link · Raised = created date · Due = due date.
 *   Brand, Assigned To, Type, Status and Remarks are left blank for the team.
 * MONTHLY (monthlyRollover, 1st ~6 AM IST): creates the new month's tab from last month's and carries over
 *   every open DR (whole row: same people, same status).
 * Never adds a to-do twice: remembers every to-do it has handled, and recognises DRs already in the sheet
 *   by their Basecamp link (or, for a row with no link, by its exact title — it then adds the link to that row).
 * Any failure is emailed to CFG.alertTo (at most once a day per problem).
 *
 * Tab names: 2026 uses plain month names ("November"); from 2027 tabs are named with the year ("January 2027")
 *   so they never clash with last year's. Short names ("Nov", "Nov 2027") are also recognised.
 *
 * Use the "DR Sync" menu in the sheet:
 *   1. Enter Basecamp app keys   2. Connect Basecamp   3. Start hourly sync
 */
const CFG = {
  account: "3985435",
  watch: ["First Last", "First Last"],   // SETUP: exact Basecamp names whose newly assigned to-dos become DR rows
  alertTo: "nitesh@sugarcosmetics.com",            // who gets an email if a run fails
  legacyYear: 2026,                                // SETUP: the year whose tabs have plain month names ("November")
  exited: [],                                      // SETUP: people who left, e.g. [{ name: "Asha", from: "2026-11" }]
};
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function onOpen() {
  SpreadsheetApp.getUi().createMenu("DR Sync")
    .addItem("1. Enter Basecamp app keys", "enterKeys")
    .addItem("2. Connect Basecamp", "connect")
    .addItem("3. Start hourly sync", "startHourly")
    .addSeparator()
    .addItem("Sync now", "syncNewDRs")
    .addItem("Stop hourly sync", "stopHourly")
    .addSeparator()
    .addItem("Preview next month's carry-over", "previewRolloverUi")
    .addToUi();
}

const UP = () => PropertiesService.getUserProperties();   // stored only for the Google account that sets it up
const redirectUri_ = () => "https://script.google.com/macros/d/" + ScriptApp.getScriptId() + "/usercallback";

/* ---------- setup ---------- */
function enterKeys() {
  const ui = SpreadsheetApp.getUi();
  const a = ui.prompt("Basecamp Client ID", 'Paste the Client ID of the "DR Sheet Sync" Basecamp app.', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  const b = ui.prompt("Basecamp Client Secret", "Paste the Client Secret. It is saved only for your Google account.", ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  UP().setProperties({ BC_ID: a.getResponseText().trim(), BC_SECRET: b.getResponseText().trim() });
  ui.alert("Saved. Next: DR Sync → 2. Connect Basecamp");
}

function connect() {
  const ui = SpreadsheetApp.getUi();
  const id = UP().getProperty("BC_ID");
  if (!id) return ui.alert("Do step 1 first: DR Sync → 1. Enter Basecamp app keys");
  const state = ScriptApp.newStateToken().withMethod("authCallback").withTimeout(600).createToken();
  const url = "https://launchpad.37signals.com/authorization/new?type=web_server" +
    "&client_id=" + encodeURIComponent(id) +
    "&redirect_uri=" + encodeURIComponent(redirectUri_()) +
    "&state=" + encodeURIComponent(state);
  const html = HtmlService.createHtmlOutput(
    '<div style="font:14px Arial,sans-serif"><p>Click below, approve access in Basecamp, then come back here.</p>' +
    '<p><a href="' + url + '" target="_blank" style="color:#e8590c;font-weight:bold">Connect Basecamp</a></p></div>'
  ).setWidth(340).setHeight(130);
  ui.showModalDialog(html, "Connect Basecamp");
}

function authCallback(req) {
  const code = req.parameter.code;
  if (!code) return HtmlService.createHtmlOutput("Basecamp access was not given. You can close this tab.");
  const ok = tokenRequest_({ type: "web_server", code: code, redirect_uri: redirectUri_() });
  return HtmlService.createHtmlOutput(ok
    ? '<p style="font:15px Arial,sans-serif">Basecamp is connected. Close this tab and go back to the sheet → DR Sync → 3. Start hourly sync.</p>'
    : '<p style="font:15px Arial,sans-serif">Couldn\'t connect. Check the Client ID and Secret (DR Sync → 1), then try again.</p>');
}

function startHourly() {
  token_();   // fails early with a clear message if not connected
  const doc = PropertiesService.getDocumentProperties();
  if (!doc.getProperty("BASELINE_V2")) seedBaseline();
  stopHourly(true);
  ScriptApp.newTrigger("syncNewDRs").timeBased().everyHours(1).create();
  setupMonthly();
  const n = syncNewDRs();
  SpreadsheetApp.getUi().alert("Hourly sync is on. DRs newly assigned in Basecamp are added to this month's tab." + (typeof n === "number" ? " Added just now: " + n + "." : ""));
}

function stopHourly(quiet) {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "syncNewDRs").forEach(t => ScriptApp.deleteTrigger(t));
  if (quiet !== true) SpreadsheetApp.getUi().alert("Hourly sync is off.");
}

/* ---------- Basecamp ---------- */
function tokenRequest_(params) {
  const p = UP();
  params.client_id = p.getProperty("BC_ID");
  params.client_secret = p.getProperty("BC_SECRET");
  const qs = Object.keys(params).map(k => k + "=" + encodeURIComponent(params[k])).join("&");
  const res = UrlFetchApp.fetch("https://launchpad.37signals.com/authorization/token?" + qs, { method: "post", muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) { console.log("Basecamp token error " + res.getResponseCode() + ": " + res.getContentText().slice(0, 200)); return null; }
  const j = JSON.parse(res.getContentText());
  p.setProperty("BC_ACCESS", j.access_token);
  p.setProperty("BC_EXPIRES", String(Date.now() + ((j.expires_in || 1209600) - 3600) * 1000));
  if (j.refresh_token) p.setProperty("BC_REFRESH", j.refresh_token);
  return j;
}

function token_() {
  const p = UP();
  if (p.getProperty("BC_ACCESS") && Date.now() < Number(p.getProperty("BC_EXPIRES"))) return p.getProperty("BC_ACCESS");
  if (!p.getProperty("BC_REFRESH")) throw new Error("Not connected to Basecamp yet. Use DR Sync → 2. Connect Basecamp.");
  const j = tokenRequest_({ type: "refresh", refresh_token: p.getProperty("BC_REFRESH"), redirect_uri: redirectUri_() });
  if (!j) throw new Error("Basecamp login expired. Use DR Sync → 2. Connect Basecamp again.");
  return j.access_token;
}

// GET a Basecamp API path; follows pagination. Returns an array (or the report's todos).
function bc_(path) {
  const token = token_();
  let url = "https://3.basecampapi.com/" + CFG.account + path, out = [];
  while (url) {
    const res = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true });
    if (res.getResponseCode() === 429) { Utilities.sleep(10000); continue; }
    if (res.getResponseCode() !== 200) throw new Error("Basecamp " + res.getResponseCode() + " on " + path);
    const j = JSON.parse(res.getContentText());
    out = out.concat(Array.isArray(j) ? j : (j.todos || []));
    const link = res.getHeaders()["Link"] || res.getHeaders()["link"] || "";
    const m = String(link).match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
  }
  return out;
}

/* ---------- memory of handled to-dos ---------- */
// Script properties hold max 9 KB per value, so the list is split over SEEN_0, SEEN_1, … (~550 ids each).
function seen_() {
  const all = PropertiesService.getDocumentProperties().getProperties(), set = new Set();
  Object.keys(all).filter(k => k === "SEEN" || k.indexOf("SEEN_") === 0).forEach(k => JSON.parse(all[k] || "[]").forEach(id => set.add(String(id))));
  return set;
}
function saveSeen_(set) {
  const dp = PropertiesService.getDocumentProperties(), ids = [...set], chunk = 550;
  Object.keys(dp.getProperties()).filter(k => k === "SEEN" || k.indexOf("SEEN_") === 0).forEach(k => dp.deleteProperty(k));
  for (let i = 0, n = 0; i < ids.length; i += chunk, n++) dp.setProperty("SEEN_" + n, JSON.stringify(ids.slice(i, i + chunk)));
}

/* ---------- tabs ---------- */
const MON3 = MONTHS.map(m => m.slice(0, 3).toLowerCase());
// "November", "Nov", "November 2027", "Nov 2027" → {m: 0-11, y}; null if not a month tab.
function parseTab_(name) {
  const t = String(name).trim().toLowerCase().match(/^([a-z]+)\.?(?:\s+(\d{4}))?$/);
  if (!t) return null;
  const m = MON3.indexOf(t[1].slice(0, 3));
  if (m < 0 || !(t[1] === MONTHS[m].toLowerCase() || t[1] === MON3[m] || (m === 8 && t[1] === "sept"))) return null;
  return { m: m, y: t[2] ? Number(t[2]) : CFG.legacyYear };
}
function ymNow_(d) { d = d || new Date(); return { m: Number(Utilities.formatDate(d, "Asia/Kolkata", "M")) - 1, y: Number(Utilities.formatDate(d, "Asia/Kolkata", "yyyy")) }; }
function tabNameFor_(ym) { return ym.y === CFG.legacyYear ? MONTHS[ym.m] : MONTHS[ym.m] + " " + ym.y; }
function findMonthTab_(ss, ym) { return ss.getSheets().find(s => { const p = parseTab_(s.getName()); return p && p.m === ym.m && p.y === ym.y; }) || null; }
function monthTabs_(ss) {
  return ss.getSheets().map(s => ({ s: s, p: parseTab_(s.getName()) })).filter(x => x.p).sort((a, b) => (a.p.y * 12 + a.p.m) - (b.p.y * 12 + b.p.m));
}
// This month's tab, or the latest month tab if this month's doesn't exist yet.
function monthTab_(ss) {
  const now = findMonthTab_(ss, ymNow_());
  if (now) return now;
  const all = monthTabs_(ss);
  if (!all.length) throw new Error("No month tab found (expected a tab named like \"" + tabNameFor_(ymNow_()) + "\").");
  return all[all.length - 1].s;
}

// Header row (first cell "DR") and column numbers, found by header name.
function layout_(sh) {
  const top = sh.getRange(1, 1, Math.min(10, sh.getMaxRows()), Math.min(15, sh.getMaxColumns())).getDisplayValues();
  const hr = top.findIndex(r => /^dr\b/i.test(String(r[0]).trim()));
  if (hr < 0) throw new Error('The "' + sh.getName() + '" tab has no header row starting with "DR" in its first 10 rows. Restore the header (DR, Raised, Due, Brand, Assigned To, Type, Status, Remarks).');
  const h = top[hr].map(x => String(x).trim().toLowerCase());
  let ncols = 0; while (ncols < h.length && h[ncols] !== "") ncols++;
  const col = n => h.indexOf(n) + 1;
  let status = col("status"); if (!status) status = (col("type") || col("assigned to")) + 1;   // July has a blank Status header
  return { headerRow: hr + 1, ncols: ncols, dr: 1, raised: col("raised") || 2, due: col("due") || 3, assigned: col("assigned to"), status: status };
}

// First empty row below the last DR in column A.
function nextRow_(sh, lay) {
  const last = sh.getLastRow();
  if (last <= lay.headerRow) return lay.headerRow + 1;
  const a = sh.getRange(lay.headerRow + 1, 1, last - lay.headerRow, 1).getDisplayValues();
  let i = a.length - 1;
  while (i >= 0 && !String(a[i][0]).trim()) i--;
  return lay.headerRow + 2 + i;
}

function todoId_(url) { const m = url && String(url).match(/\/todos\/(\d+)/); return m ? m[1] : null; }
const norm_ = t => String(t).toLowerCase().replace(/\s+/g, " ").trim();

function addRow_(sh, lay, title, url, raised, due) {
  const row = nextRow_(sh, lay);
  sh.getRange(row, lay.dr).setRichTextValue(SpreadsheetApp.newRichTextValue().setText(title).setLinkUrl(url).build());
  if (raised) sh.getRange(row, lay.raised).setValue(raised).setNumberFormat("mmmm d");
  if (due) sh.getRange(row, lay.due).setValue(due).setNumberFormat("mmmm d");
}

/* ---------- alerts ---------- */
// Emails CFG.alertTo when a run fails — at most once a day for the same problem, so a stuck job can't spam.
function alert_(job, err) {
  const dp = PropertiesService.getDocumentProperties(), msg = String(err && err.message || err);
  const key = "ALERT_" + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, job + msg)).slice(0, 10);
  const last = Number(dp.getProperty(key) || 0);
  if (Date.now() - last < 24 * 3600 * 1000) return;
  dp.setProperty(key, String(Date.now()));
  try {
    MailApp.sendEmail(CFG.alertTo, "DR Sync problem: " + job,
      "The DR sheet's automation hit a problem.\n\nJob: " + job + "\nProblem: " + msg +
      "\n\nIt will keep retrying on schedule. Open the sheet → DR Sync menu, or the script's Executions page, to check.\n" +
      SpreadsheetApp.getActive().getUrl());
  } catch (e) { console.log("Could not send alert email: " + e.message); }
}

/* ---------- hourly: add newly assigned DRs ---------- */
function openAssigned_() {
  const people = bc_("/reports/todos/assigned.json");
  const watched = people.filter(p => CFG.watch.some(n => n.toLowerCase() === String(p.name).toLowerCase()));
  // Basecamp leaves the connected person (whose login the script uses) out of that list — add them back.
  const meRes = UrlFetchApp.fetch("https://3.basecampapi.com/" + CFG.account + "/my/profile.json", { headers: { Authorization: "Bearer " + token_() }, muteHttpExceptions: true });
  if (meRes.getResponseCode() === 200) {
    const me = JSON.parse(meRes.getContentText());
    if (CFG.watch.some(n => n.toLowerCase() === String(me.name).toLowerCase()) && !watched.some(p => String(p.id) === String(me.id))) watched.push(me);
  }
  const missing = CFG.watch.filter(n => !watched.some(p => n.toLowerCase() === String(p.name).toLowerCase()));
  if (missing.length) throw new Error("Not found in Basecamp: " + missing.join(", ") + ". Check the spelling in CFG.watch.");
  const todos = new Map();
  const byPerson = {};   // lower-case name -> ids of that person's open to-dos
  watched.forEach(p => {
    const ids = [];
    bc_("/reports/todos/assigned/" + p.id + ".json?group_by=bucket").forEach(t => {
      if (t.completed) return;
      ids.push(String(t.id));
      if (!todos.has(String(t.id))) todos.set(String(t.id), t);
    });
    byPerson[String(p.name).toLowerCase()] = ids;
  });
  return { watched: watched, todos: todos, byPerson: byPerson };
}

// Someone newly added to CFG.watch: their to-dos open at that moment are remembered (not added), so only DRs
// assigned to them afterwards come in. Their backlog never floods the sheet. Done once per person.
function seedNewPeople_(a, seen) {
  const dp = PropertiesService.getDocumentProperties();
  const done = JSON.parse(dp.getProperty("SEEDED_PEOPLE") || '[]');
  const fresh = Object.keys(a.byPerson).filter(n => done.indexOf(n) < 0);
  if (!fresh.length) return [];
  const others = new Set();
  Object.keys(a.byPerson).filter(n => done.indexOf(n) >= 0).forEach(n => a.byPerson[n].forEach(id => others.add(id)));
  let count = 0;
  fresh.forEach(n => { a.byPerson[n].forEach(id => { if (!others.has(id) && !seen.has(id)) { seen.add(id); count++; } }); done.push(n); });
  saveSeen_(seen);
  dp.setProperty("SEEDED_PEOPLE", JSON.stringify(done));
  console.log("New in watch list: " + fresh.join(", ") + ". " + count + " to-do(s) already open for them were marked as seen (not added).");
  return fresh;
}

// One-off: remember every to-do currently assigned, so only NEW assignments get added from now on.
function seedBaseline() {
  const seen = seen_(), a = openAssigned_();
  a.todos.forEach((t, id) => seen.add(id));
  saveSeen_(seen);
  const dp = PropertiesService.getDocumentProperties();
  dp.setProperty("BASELINE_V2", new Date().toISOString());
  dp.setProperty("SEEDED_PEOPLE", JSON.stringify(Object.keys(a.byPerson)));
  dp.deleteProperty("START_DATE");
  console.log("Baseline saved: " + a.todos.size + " currently assigned to-dos will not be added again. Total remembered: " + seen.size + ".");
}

function syncNewDRs() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return;
  try {
    if (!PropertiesService.getDocumentProperties().getProperty("BASELINE_V2")) { seedBaseline(); return 0; }   // first run of this version
    const a = openAssigned_();
    const ss = SpreadsheetApp.getActive();
    const sh = monthTab_(ss), lay = layout_(sh);
    const seen = seen_();
    seedNewPeople_(a, seen);   // anyone just added to CFG.watch: backlog marked as seen, not added

    // DRs already in the sheet: by Basecamp link in column A of every tab.
    const linked = new Set();
    ss.getSheets().forEach(s => {
      const n = s.getLastRow(); if (n < 1) return;
      s.getRange(1, 1, n, 1).getRichTextValues().forEach(r => { const id = todoId_(r[0] && r[0].getLinkUrl()); if (id) linked.add(id); });
    });
    // Rows in this month's tab with a DR title but no link (to attach the link instead of adding a duplicate).
    const unlinked = new Map();
    const last = sh.getLastRow();
    if (last > lay.headerRow) {
      const rich = sh.getRange(lay.headerRow + 1, 1, last - lay.headerRow, 1).getRichTextValues();
      rich.forEach((r, i) => { const t = r[0] && r[0].getText(); if (t && !r[0].getLinkUrl()) unlinked.set(norm_(t), lay.headerRow + 1 + i); });
    }

    const day = d => Utilities.formatDate(new Date(d), "Asia/Kolkata", "yyyy-MM-dd");
    const asDate = s => s ? new Date(s.slice(0, 10) + "T00:00:00+05:30") : "";
    const fresh = [...a.todos.values()].filter(t => !seen.has(String(t.id)) && !linked.has(String(t.id)))
      .sort((x, y) => new Date(x.created_at) - new Date(y.created_at));

    let added = 0, attached = 0;
    fresh.forEach(t => {
      const row = unlinked.get(norm_(t.title));
      if (row) {   // same title already typed in without a link → just add the link
        sh.getRange(row, 1).setRichTextValue(SpreadsheetApp.newRichTextValue().setText(sh.getRange(row, 1).getDisplayValue()).setLinkUrl(t.app_url).build());
        unlinked.delete(norm_(t.title)); attached++;
      } else {
        addRow_(sh, lay, t.title, t.app_url, asDate(day(t.created_at)), asDate(t.due_on)); added++;
      }
      seen.add(String(t.id));
    });
    // Also remember to-dos already linked in the sheet, so a deleted row never comes back.
    a.todos.forEach((t, id) => { if (linked.has(id)) seen.add(id); });
    saveSeen_(seen);
    console.log("Added " + added + " new DR(s) to " + sh.getName() + (attached ? ", linked " + attached + " existing row(s)" : "") + ". Watching: " + a.watched.map(p => p.name).join(", ") + ". Open to-dos checked: " + a.todos.size + ".");
    return added;
  } catch (e) {
    alert_("Hourly DR sync", e); throw e;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- monthly: new tab + carry over open DRs ---------- */
const CLOSED = ["done", "approved", "na", "scrapped"];

function setupMonthly() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "monthlyRollover").forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("monthlyRollover").timeBased().onMonthDay(1).atHour(6).inTimezone("Asia/Kolkata").create();
  console.log("Monthly rollover set: 1st of every month, around 6 AM IST.");
}

function exitedFor_(name, ym) {
  return CFG.exited.find(x => {
    const f = x.from.split("-").map(Number);
    return String(name).toLowerCase().split(/,|&|\//).map(s => s.trim()).indexOf(x.name.toLowerCase()) >= 0 && (ym.y * 12 + ym.m) >= (f[0] * 12 + f[1] - 1);
  });
}

// Works out last month's tab, the new tab's name, and which rows would be carried over.
function rolloverPlan_(ss, when) {
  const cur = ymNow_(when), prevYm = { m: (cur.m + 11) % 12, y: cur.m === 0 ? cur.y - 1 : cur.y };
  const prev = findMonthTab_(ss, prevYm);
  if (!prev) throw new Error('Last month\'s tab ("' + tabNameFor_(prevYm) + '") not found, so the new month could not be created.');
  const lay = layout_(prev);
  const last = prev.getLastRow(), rows = [], noLink = [], dupes = [], ids = new Set();
  if (last > lay.headerRow) {
    const vals = prev.getRange(lay.headerRow + 1, 1, last - lay.headerRow, lay.ncols).getDisplayValues();
    const rich = prev.getRange(lay.headerRow + 1, 1, last - lay.headerRow, 1).getRichTextValues();
    vals.forEach((v, i) => {
      if (!String(v[0]).trim()) return;
      if (CLOSED.indexOf(String(v[lay.status - 1] || "").trim().toLowerCase()) >= 0) return;
      const id = todoId_(rich[i][0] && rich[i][0].getLinkUrl());
      if (id && ids.has(id)) { dupes.push(String(v[0])); return; }   // same Basecamp to-do twice → carry once
      if (id) ids.add(id); else noLink.push(String(v[0]));
      rows.push({ row: lay.headerRow + 1 + i, title: String(v[0]), status: String(v[lay.status - 1] || ""), assigned: lay.assigned ? String(v[lay.assigned - 1] || "") : "", todo: id });
    });
  }
  return { prev: prev, newYm: cur, newName: tabNameFor_(cur), exists: !!findMonthTab_(ss, cur), lay: lay, rows: rows, noLink: noLink, dupes: dupes };
}

// Drops rows whose Basecamp to-do is already ticked off (if Basecamp can't be reached, carries them anyway).
function dropClosedInBasecamp_(rows) {
  try {
    const token = token_(), closed = [];
    const keep = rows.filter(r => {
      if (!r.todo) return true;
      const res = UrlFetchApp.fetch("https://3.basecampapi.com/" + CFG.account + "/todos/" + r.todo + ".json", { headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) return true;
      if (JSON.parse(res.getContentText()).completed) { closed.push(r.title); return false; }
      return true;
    });
    return { keep: keep, closed: closed };
  } catch (e) { console.log("Basecamp check skipped: " + e.message); return { keep: rows, closed: [] }; }
}

function monthlyRollover() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(60000)) return;
  try {
    const ss = SpreadsheetApp.getActive();
    const p = rolloverPlan_(ss);
    if (p.exists) { console.log('"' + p.newName + '" tab already exists — nothing done.'); return; }
    const bc = dropClosedInBasecamp_(p.rows), carry = bc.keep;

    // New tab = copy of last month's (keeps formatting, dropdowns, Quick View), placed right after it.
    const tab = p.prev.copyTo(ss).setName(p.newName);
    ss.setActiveSheet(tab);
    ss.moveActiveSheet(p.prev.getIndex() + 1);
    if (parseTab_(tab.getRange(1, 1).getDisplayValue())) tab.getRange(1, 1).setValue(MONTHS[p.newYm.m]);   // title cell
    const last = tab.getLastRow();
    if (last > p.lay.headerRow) {
      const r = tab.getRange(p.lay.headerRow + 1, 1, last - p.lay.headerRow, p.lay.ncols);
      r.clearContent(); r.clearNote();
    }

    // Carry over the open DRs, whole row (DR link, dates, brand, people, type, status, remarks).
    const flagged = [];
    carry.forEach((r, i) => {
      const to = p.lay.headerRow + 1 + i;
      p.prev.getRange(r.row, 1, 1, p.lay.ncols).copyTo(tab.getRange(to, 1, 1, p.lay.ncols));
      const gone = r.assigned && exitedFor_(r.assigned, p.newYm);
      if (gone && p.lay.assigned) { tab.getRange(to, p.lay.assigned).setNote(gone.name + " has left the team — please reassign."); flagged.push(r.title); }
    });

    const seen = seen_(); carry.forEach(r => r.todo && seen.add(r.todo)); saveSeen_(seen);
    const report = 'Created "' + p.newName + '" with ' + carry.length + " open DR(s) carried over from " + p.prev.getName() + "." +
      (bc.closed.length ? "\nNot carried (already ticked off in Basecamp): " + bc.closed.join(", ") : "") +
      (p.dupes.length ? "\nSkipped duplicates (same Basecamp to-do twice): " + p.dupes.join(", ") : "") +
      (p.noLink.length ? "\nCarried without a Basecamp link (please add the link): " + p.noLink.join(", ") : "") +
      (flagged.length ? "\nNeeds a new owner (person has left): " + flagged.join(", ") : "");
    console.log(report);
    try { MailApp.sendEmail(CFG.alertTo, "DR sheet: " + p.newName + " tab created", report + "\n\n" + ss.getUrl()); } catch (e) { console.log("Summary email not sent: " + e.message); }
  } catch (e) {
    alert_("Monthly rollover", e); throw e;
  } finally {
    lock.releaseLock();
  }
}

// Safe preview: lists what the next rollover would carry over. Changes nothing.
function previewRollover() {
  const next = new Date(); next.setMonth(next.getMonth() + 1, 1);
  const ss = SpreadsheetApp.getActive(), p = rolloverPlan_(ss, next);
  const bc = dropClosedInBasecamp_(p.rows), carry = bc.keep;
  const text = 'On the 1st, "' + p.newName + '" will be created with ' + carry.length + " DR(s) carried over from " + p.prev.getName() + ":\n" +
    carry.map(r => "• " + r.title + "  [" + (r.status || "blank") + "]" + (exitedFor_(r.assigned, p.newYm) ? "  ← reassign" : "")).join("\n") +
    (bc.closed.length ? "\n\nNot carried (ticked off in Basecamp): " + bc.closed.join(", ") : "") +
    (p.dupes.length ? "\nSkipped duplicates: " + p.dupes.join(", ") : "") +
    (p.noLink.length ? "\nNo Basecamp link: " + p.noLink.join(", ") : "");
  console.log(text);
  return text;
}
function previewRolloverUi() { SpreadsheetApp.getUi().alert(previewRollover()); }

// Sends a test alert email (to check alerts reach CFG.alertTo).
function testAlert() { MailApp.sendEmail(CFG.alertTo, "DR Sync: test alert", "Alerts from the DR sheet automation reach this inbox.\n" + SpreadsheetApp.getActive().getUrl()); }

// Lists the Basecamp names that look like the watched people (for checking CFG.watch spelling).
function debugPeople() {
  const people = bc_("/reports/todos/assigned.json");
  console.log("Assignable people matching cecil/prath/manish: " + people.filter(p => /cecil|prath|mathew|manish|mistry/i.test(p.name)).map(p => p.name + " (#" + p.id + ")").join(", ") + " | total people: " + people.length);
  const me = JSON.parse(UrlFetchApp.fetch("https://3.basecampapi.com/" + CFG.account + "/my/profile.json", { headers: { Authorization: "Bearer " + token_() } }).getContentText());
  console.log("Connected Basecamp user: " + me.name + " (#" + me.id + ")");
}
