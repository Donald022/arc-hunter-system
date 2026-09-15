/**
 * Local Gmail OAuth helper for a Desktop OAuth client. Does not send mail.
 * Loopback redirect: http://127.0.0.1:8765
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, resetConfigCache } from "../src/config.ts";

const PORT = 8765;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function openBrowser(url: string): void {
  if (process.platform === "win32") {
    const escaped = url.replace(/'/g, "''");
    spawn("powershell.exe", ["-NoProfile", "-Command", `Start-Process '${escaped}'`], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

function upsertEnv(key: string, value: string): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) throw new Error("missing_.env");
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) next.push(`${key}=${value}`);
  writeFileSync(path, next.join("\n"), "utf8");
}

async function exchangeCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  verifier: string;
}) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
      code_verifier: input.verifier,
    }),
  });
  const json = (await res.json()) as {
    refresh_token?: string;
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok) {
    throw new Error(json.error_description ?? json.error ?? `token_${res.status}`);
  }
  return json;
}

async function main() {
  resetConfigCache();
  const cfg = loadConfig();
  if (!cfg.GOOGLE_CLIENT_ID || !cfg.GOOGLE_CLIENT_SECRET) {
    console.log(
      JSON.stringify({
        ok: false,
        error: "missing_oauth_client",
        client_id_present: Boolean(cfg.GOOGLE_CLIENT_ID),
        client_secret_present: Boolean(cfg.GOOGLE_CLIENT_SECRET),
        hint: "Open the Desktop client 'ARC Hunter local', copy Client ID and Client secret into .env, save.",
      }),
    );
    process.exit(1);
  }

  const { verifier, challenge } = pkce();
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", cfg.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  console.log(
    JSON.stringify({
      ok: true,
      waiting: true,
      client: "desktop_loopback",
      redirect_uri: REDIRECT_URI,
      hint: "Sign in as the Workspace mailbox and Allow. No email is sent.",
    }),
  );

  await new Promise<void>((resolvePromise, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
        const err = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        if (!code && !err) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        if (err) throw new Error(err);
        if (!code) throw new Error("missing_code");
        const tokens = await exchangeCode({
          clientId: cfg.GOOGLE_CLIENT_ID!,
          clientSecret: cfg.GOOGLE_CLIENT_SECRET!,
          code,
          verifier,
        });
        if (!tokens.refresh_token) {
          throw new Error("no_refresh_token_reauthorize_with_prompt_consent");
        }
        upsertEnv("GOOGLE_REFRESH_TOKEN", tokens.refresh_token);
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("Gmail OAuth OK. Refresh token saved to .env. You can close this tab. No email was sent.");
        console.log(
          JSON.stringify({
            ok: true,
            saved: "GOOGLE_REFRESH_TOKEN",
            refresh_token_length: tokens.refresh_token.length,
            gmail_sender_set: Boolean(cfg.GMAIL_SENDER),
          }),
        );
        server.close();
        resolvePromise();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end(`OAuth failed: ${msg}`);
        console.log(JSON.stringify({ ok: false, error: msg }));
        server.close();
        reject(e);
      }
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`OPEN_IN_BROWSER ${authUrl.toString()}`);
      openBrowser(authUrl.toString());
      console.log(JSON.stringify({ browser: "opened_or_open_manually", authorize_url_host: authUrl.host }));
    });
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
