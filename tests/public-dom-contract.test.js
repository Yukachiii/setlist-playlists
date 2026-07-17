const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "js", "public-app.js"), "utf8");
const spotify = fs.readFileSync(path.join(root, "js", "public-spotify-client.js"), "utf8");
const pagesWorkflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "pages.yml"),
  "utf8"
);

test("Spotify登録済み曲のジャケットを訪問ページへ表示する", () => {
  assert.match(app, /setlist-artwork/);
  assert.match(app, /open\.spotify\.com\/oembed/);
  assert.match(app, /thumbnail_url/);
  assert.match(app, /hydrateSetlistArtwork\(pendingArtworkLoads\)/);
});

test("公開ページのIDは重複せず、JavaScriptが参照する要素が存在する", () => {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const references = [...app.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)].map((match) => match[1]);
  const missing = references.filter((id) => !ids.includes(id));

  assert.deepEqual([...new Set(duplicates)], []);
  assert.deepEqual([...new Set(missing)], []);
});

test("Spotifyクライアントを公開アプリより先に読み込む", () => {
  const adminSpotifyIndex = html.indexOf("./admin/js/spotify-client.js");
  const adminCallbackIndex = html.indexOf("./js/admin-spotify-callback.js");
  const spotifyIndex = html.indexOf("./js/public-spotify-client.js");
  const appIndex = html.indexOf("./js/public-app.js");
  assert.ok(adminSpotifyIndex >= 0);
  assert.ok(adminCallbackIndex > adminSpotifyIndex);
  assert.ok(spotifyIndex > adminCallbackIndex);
  assert.ok(spotifyIndex >= 0);
  assert.ok(appIndex > spotifyIndex);
});

test("公開ページにはローカル管理画面へのリンクを表示しない", () => {
  assert.doesNotMatch(html, /href="\.\/admin\/"/);
});

test("公開トップは説明を重ねず公演一覧へ直接進める", () => {
  assert.doesNotMatch(html, /id="how-it-works"/);
  assert.match(html, /href="#events">公演を選ぶ/);
  assert.ok(html.indexOf('id="events"') > html.indexOf('class="hero"'));
});

test("GitHub Pagesには公開ページだけを配信する", () => {
  assert.match(pagesWorkflow, /cp index\.html _site\//);
  assert.match(pagesWorkflow, /cp -R css js data _site\//);
  assert.match(pagesWorkflow, /cp admin\/js\/spotify-client\.js _site\/admin\/js\//);
  assert.doesNotMatch(pagesWorkflow, /cp -R admin/);
  assert.doesNotMatch(pagesWorkflow, /cp server\.py/);
});

test("Spotifyの現行プレイリストAPIと非公開スコープを使う", () => {
  assert.match(spotify, /playlist-modify-private/);
  assert.match(spotify, /apiFetch\("\/me\/playlists"/);
  assert.match(spotify, /`\/playlists\/\$\{encodeURIComponent\(playlist\.id\)\}\/items`/);
  assert.doesNotMatch(spotify, /\/tracks[`"']/);
  assert.match(spotify, /public: false/);
});
