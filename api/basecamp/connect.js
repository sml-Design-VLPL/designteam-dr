// Step 1 of the one-time setup: sends you to Basecamp to approve access.
const crypto = require("crypto");
const { REDIRECT_URI } = require("./_lib");

module.exports = (req, res) => {
  const id = process.env.BASECAMP_CLIENT_ID;
  if (!id) { res.status(500).send("BASECAMP_CLIENT_ID is not set in Vercel yet."); return; }
  const state = crypto.randomBytes(16).toString("hex");
  res.setHeader("Set-Cookie", `bc_state=${state}; Path=/api/basecamp; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  const u = new URL("https://launchpad.37signals.com/authorization/new");
  u.search = new URLSearchParams({ type: "web_server", client_id: id, redirect_uri: REDIRECT_URI, state });
  res.redirect(302, u.toString());
};
