// Step 2 of the one-time setup: Basecamp sends you back here. Shows the refresh token
// ONCE, only to the person who just approved, so they can paste it into Vercel.
const { REDIRECT_URI, ACCOUNT_ID, UA } = require("./_lib");

const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex">
<title>${title}</title><body style="background:#0A0A0B;color:#F5F5F4;font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:60px auto;padding:0 20px">
<h1 style="font-size:22px">${title}</h1>${body}</body>`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const { code, state, error } = req.query || {};
  const cookie = (req.headers.cookie || "").match(/bc_state=([a-f0-9]+)/);
  if (error) return res.status(400).send(page("Basecamp access was not given", `<p>Basecamp said: ${esc(error)}. You can close this tab and try the connect link again.</p>`));
  if (!code || !cookie || cookie[1] !== state) return res.status(400).send(page("This link has expired", `<p>Open <a style="color:#FF9A5C" href="/api/basecamp/connect">the connect link</a> again to start over.</p>`));

  const u = new URL("https://launchpad.37signals.com/authorization/token");
  u.search = new URLSearchParams({ type: "web_server", client_id: process.env.BASECAMP_CLIENT_ID, client_secret: process.env.BASECAMP_CLIENT_SECRET, redirect_uri: REDIRECT_URI, code });
  const r = await fetch(u, { method: "POST", headers: { "User-Agent": UA } });
  if (!r.ok) return res.status(502).send(page("Couldn't finish connecting", `<p>Basecamp returned an error (${r.status}). Check the Client ID and Secret in Vercel, then try the connect link again.</p>`));
  const tok = await r.json();

  const a = await fetch("https://launchpad.37signals.com/authorization.json", { headers: { Authorization: "Bearer " + tok.access_token, "User-Agent": UA } });
  const accounts = a.ok ? (await a.json()).accounts || [] : [];
  const hasAccount = accounts.some(x => String(x.id) === ACCOUNT_ID);

  res.setHeader("Set-Cookie", "bc_state=; Path=/api/basecamp; Max-Age=0");
  res.send(page("Basecamp is connected — one last step", `
<p>${hasAccount ? "Your Basecamp account can see the DR to-dos." : "<b style='color:#FF8587'>Warning:</b> this Basecamp login can't see account " + ACCOUNT_ID + " (the one the DR links use). Sign in with the account your team uses and try again."}</p>
<p>Copy the key below and add it in Vercel → <b>designteam-dr → Settings → Environment Variables</b> as
<code>BASECAMP_REFRESH_TOKEN</code> (tick <i>Sensitive</i>, Production). Then redeploy. Don't share it with anyone.</p>
<textarea readonly style="width:100%;height:90px;background:#141416;color:#F5F5F4;border:1px solid #26262A;border-radius:10px;padding:10px;font:13px monospace">${esc(tok.refresh_token)}</textarea>
<p style="color:#8C8C94">This page is shown only once. If you lose the key, open the connect link again.</p>`));
};
