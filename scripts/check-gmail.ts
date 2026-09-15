import { loadConfig, resetConfigCache } from "../src/config.ts";

async function main() {
  resetConfigCache();
  const cfg = loadConfig();
  if (!cfg.GOOGLE_CLIENT_ID || !cfg.GOOGLE_CLIENT_SECRET || !cfg.GOOGLE_REFRESH_TOKEN) {
    console.log(JSON.stringify({ ok: false, error: "missing_gmail_oauth" }));
    process.exit(1);
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.GOOGLE_CLIENT_ID,
      client_secret: cfg.GOOGLE_CLIENT_SECRET,
      refresh_token: cfg.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenRes.ok || !tokenJson.access_token) {
    console.log(JSON.stringify({ ok: false, step: "token", status: tokenRes.status, error: tokenJson.error }));
    process.exit(1);
  }
  const headers = { authorization: `Bearer ${tokenJson.access_token}` };
  const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers });
  const profile = (await profileRes.json()) as { emailAddress?: string; messagesTotal?: number; error?: { message?: string } };
  const sendAsRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs", { headers });
  const sendAs = (await sendAsRes.json()) as {
    sendAs?: Array<{ sendAsEmail?: string; isDefault?: boolean; isPrimary?: boolean }>;
    error?: { message?: string };
  };
  const aliases = (sendAs.sendAs ?? []).map((s) => ({
    email: s.sendAsEmail,
    default: Boolean(s.isDefault),
    primary: Boolean(s.isPrimary),
  }));
  const sender = (cfg.GMAIL_SENDER ?? "").toLowerCase();
  console.log(
    JSON.stringify(
      {
        ok: profileRes.ok && sendAsRes.ok,
        mailbox: profile.emailAddress,
        gmail_sender: cfg.GMAIL_SENDER,
        sender_is_send_as: aliases.some((a) => (a.email ?? "").toLowerCase() === sender),
        sender_is_default: aliases.some((a) => (a.email ?? "").toLowerCase() === sender && a.default),
        send_as: aliases,
        live_send_enabled: cfg.LIVE_SEND_ENABLED,
        profile_error: profile.error?.message,
        send_as_error: sendAs.error?.message,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
