// Shared helpers for the Basecamp connection. Secrets live only in Vercel env vars:
//   BASECAMP_CLIENT_ID, BASECAMP_CLIENT_SECRET, BASECAMP_REFRESH_TOKEN
const SITE = "https://designteam-dr.vercel.app";   // Vercel URL (change if Vercel gives a different one)
const REDIRECT_URI = SITE + "/api/basecamp/callback";
const ACCOUNT_ID = "3985435";  // the number in the Basecamp links (3.basecamp.com/<this>/...)
const UA = "Design Team DR Dashboard (" + SITE + ")";

async function accessToken() {
  const { BASECAMP_CLIENT_ID: id, BASECAMP_CLIENT_SECRET: secret, BASECAMP_REFRESH_TOKEN: refresh } = process.env;
  if (!id || !secret || !refresh) throw new Error("not_connected");
  const u = new URL("https://launchpad.37signals.com/authorization/token");
  u.search = new URLSearchParams({ type: "refresh", refresh_token: refresh, client_id: id, client_secret: secret, redirect_uri: REDIRECT_URI });
  const r = await fetch(u, { method: "POST", headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("refresh_failed_" + r.status);
  return (await r.json()).access_token;
}

module.exports = { SITE, REDIRECT_URI, ACCOUNT_ID, UA, accessToken };
