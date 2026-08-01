import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_ID = "0a891d6707d34424bae951dfa25a9d95";
const REDIRECT_URI = "http://127.0.0.1:8765/";
const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const PORT = 8765;
const TIMEOUT_MS = 15 * 60 * 1000;

const verifier = randomBytes(64).toString("base64url");
const state = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const toolDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(toolDirectory, "..", "..");
const wranglerConfig = resolve(projectDirectory, "worker", "wrangler.toml");

function html(title, message) {
  return `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${title}</title>
<body style="font-family:system-ui,sans-serif;max-width:680px;margin:60px auto;padding:0 24px;line-height:1.8">
<h1>${title}</h1><p>${message}</p></body></html>`;
}

function authorizationUrl() {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "playlist-modify-private",
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
    show_dialog: "true"
  }).toString();
  return url.toString();
}

async function exchangeCode(code) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.refresh_token) {
    throw new Error(body.error_description || body.error || "Spotifyの認証情報を取得できませんでした。");
  }
  return body.refresh_token;
}

function saveWorkerSecret(refreshToken) {
  return new Promise((resolvePromise, rejectPromise) => {
    const isWindows = process.platform === "win32";
    const command = isWindows ? process.execPath : "npx";
    const npxCli = resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
    const args = isWindows
      ? [npxCli, "wrangler@latest", "secret", "put", "SPOTIFY_REFRESH_TOKEN", "--config", wranglerConfig]
      : ["wrangler@latest", "secret", "put", "SPOTIFY_REFRESH_TOKEN", "--config", wranglerConfig];
    const child = spawn(
      command,
      args,
      { cwd: projectDirectory, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
    );
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errorOutput += chunk; });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(output);
      else rejectPromise(new Error(errorOutput || output || "Cloudflare Secretを保存できませんでした。"));
    });
    child.stdin.end(`${refreshToken}\n`);
  });
}

let completed = false;
const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", REDIRECT_URI);
  if (url.pathname !== "/") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return;
  }
  if (completed) {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html("設定済みです", "この画面を閉じて構いません。"));
    return;
  }
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  if (error) {
    response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html("Spotify接続を完了できませんでした", "接続がキャンセルされました。"));
    return;
  }
  if (!code && !url.searchParams.has("state")) {
    response.writeHead(302, { Location: authorizationUrl(), "Cache-Control": "no-store" });
    response.end();
    return;
  }
  if (!code || returnedState !== state) {
    response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html("Spotify接続を確認できませんでした", "最初からもう一度実行してください。"));
    return;
  }

  try {
    const refreshToken = await exchangeCode(code);
    await saveWorkerSecret(refreshToken);
    completed = true;
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html(
      "作成用Spotifyアカウントを接続しました",
      "認証情報はCloudflare Secretへ直接保存しました。この画面を閉じて構いません。"
    ));
    console.log("Spotify refresh token saved to Cloudflare Worker secret.");
    setTimeout(() => server.close(), 500);
  } catch (setupError) {
    completed = true;
    response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html("設定に失敗しました", "画面を閉じず、実行結果を確認してください。"));
    console.error(setupError?.message || setupError);
    setTimeout(() => server.close(), 500);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error("127.0.0.1:8765 は使用中です。ローカル管理サーバーを停止してから再実行してください。");
  } else {
    console.error(error?.message || error);
  }
  process.exitCode = 1;
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`AUTH_URL=${authorizationUrl()}`);
  console.log("Waiting for Spotify authorization...");
});

setTimeout(() => {
  if (completed) return;
  console.error("Spotify authorization timed out.");
  server.close();
  process.exitCode = 1;
}, TIMEOUT_MS).unref();
