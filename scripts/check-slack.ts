import { loadConfig, resetConfigCache } from "../src/config.ts";

async function slack(method: string, token: string, params: Record<string, string> = {}) {
  const body = new URLSearchParams(params);
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return (await res.json()) as Record<string, unknown>;
}

async function main() {
  resetConfigCache();
  const cfg = loadConfig();
  const report: Record<string, unknown> = {
    bot_token_present: Boolean(cfg.SLACK_BOT_TOKEN),
    bot_token_prefix_ok: (cfg.SLACK_BOT_TOKEN ?? "").startsWith("xoxb-"),
    signing_secret_present: Boolean(cfg.SLACK_SIGNING_SECRET),
    signing_secret_length: cfg.SLACK_SIGNING_SECRET?.length ?? 0,
    channel_id: cfg.SLACK_CHANNEL_ID,
    approver_ids: cfg.SLACK_APPROVER_IDS,
  };
  if (!cfg.SLACK_BOT_TOKEN) {
    console.log(JSON.stringify({ ...report, error: "missing_bot_token" }, null, 2));
    process.exit(1);
  }
  const auth = await slack("auth.test", cfg.SLACK_BOT_TOKEN);
  report.auth_ok = auth.ok === true;
  report.team = auth.team;
  report.bot_user = auth.user;
  report.bot_user_id = auth.user_id;
  if (auth.ok !== true) {
    report.auth_error = auth.error;
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  if (cfg.SLACK_CHANNEL_ID) {
    const ch = await slack("conversations.info", cfg.SLACK_BOT_TOKEN, {
      channel: cfg.SLACK_CHANNEL_ID,
    });
    const channel = ch.channel as { name?: string; is_member?: boolean } | undefined;
    report.channel_ok = ch.ok === true;
    report.channel_name = channel?.name;
    report.bot_is_in_channel = channel?.is_member;
    if (ch.ok !== true) report.channel_error = ch.error;
  }
  const approver = cfg.SLACK_APPROVER_IDS[0];
  if (approver) {
    const u = await slack("users.info", cfg.SLACK_BOT_TOKEN, { user: approver });
    const user = u.user as { name?: string; real_name?: string } | undefined;
    report.approver_ok = u.ok === true;
    report.approver_name = user?.real_name ?? user?.name;
    if (u.ok !== true) report.approver_error = u.error;
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
