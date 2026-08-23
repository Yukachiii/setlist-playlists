const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "js", "public-app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "public.css"), "utf8");
const playlistClient = fs.readFileSync(path.join(root, "js", "public-playlist-client.js"), "utf8");
const playlistWorker = fs.readFileSync(path.join(root, "worker", "src", "index.js"), "utf8");
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

test("スマホでは公演切り替えをプルダウン表示にする", () => {
  assert.match(html, /id="performance-select"/);
  assert.match(app, /select\.replaceChildren\(\)/);
  assert.match(app, /\$\("#performance-select"\)\.addEventListener\("change"/);
  assert.match(css, /\.performance-tabs\s*\{[^}]*position:\s*sticky/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.performance-tabs\s*\{\s*display:\s*none/);
});

test("PCの固定タブとプレイリスト作成欄が重ならない", () => {
  assert.match(app, /function syncPerformanceTabsHeight\(\)/);
  assert.match(app, /--performance-tabs-height/);
  assert.match(app, /window\.addEventListener\("resize", syncPerformanceTabsHeight\)/);
  assert.match(css, /top:\s*calc\(82px \+ var\(--performance-tabs-height, 0px\)\)/);
});

test("Spotify楽曲情報の自動検出に関する注意書きを表示する", () => {
  const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
  const footer = html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";

  assert.match(html, /Spotify楽曲情報は自動検出を含むため、誤っている場合があります。/);
  assert.match(header, /href="https:\/\/marshmallow-qa\.com\/abwyzu4ah3yhb24\?/);
  assert.match(header, /不具合報告/);
  assert.doesNotMatch(header, /Cocona_Kona/);
  assert.match(footer, /href="https:\/\/x\.com\/Cocona_Kona"/);
  assert.match(footer, /X：@Cocona_Kona/);
  assert.doesNotMatch(footer, /marshmallow-qa/);
  assert.match(html, /©︎ゆいゆい/);
});

test("公開ページのIDは重複せず、JavaScriptが参照する要素が存在する", () => {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const references = [...app.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)].map((match) => match[1]);
  const missing = references.filter((id) => !ids.includes(id));

  assert.deepEqual([...new Set(duplicates)], []);
  assert.deepEqual([...new Set(missing)], []);
});

test("管理画面のSpotifyコールバックと共有プレイリストクライアントを順番どおり読み込む", () => {
  const adminSpotifyIndex = html.indexOf("./admin/js/spotify-client.js");
  const adminCallbackIndex = html.indexOf("./js/admin-spotify-callback.js");
  const playlistClientIndex = html.indexOf("./js/public-playlist-client.js");
  const appIndex = html.indexOf("./js/public-app.js");
  assert.ok(adminSpotifyIndex >= 0);
  assert.ok(adminCallbackIndex > adminSpotifyIndex);
  assert.ok(playlistClientIndex > adminCallbackIndex);
  assert.ok(appIndex > playlistClientIndex);
  assert.doesNotMatch(html, /public-spotify-client/);
  assert.doesNotMatch(html, /id="spotify-connect-button"/);
});

test("公開ページにはローカル管理画面へのリンクを表示しない", () => {
  assert.doesNotMatch(html, /href="\.\/admin\/"/);
});

test("公開トップは説明を重ねず公演一覧へ直接進める", () => {
  assert.doesNotMatch(html, /id="how-it-works"/);
  assert.match(html, /href="#events">公演を選ぶ/);
  assert.ok(html.indexOf('id="events"') > html.indexOf('class="hero"'));
});

test("公開サイトでも手動フラグ付きナンバリング公演だけに絞り込める", () => {
  assert.match(html, /id="numbered-live-only"/);
  assert.match(html, /ナンバリング公演のみ/);
  assert.match(app, /state\.numberedOnly && !isNumberedLive\(event\)/);
  assert.match(app, /\$\("#numbered-live-only"\)\.addEventListener\("change"/);
  assert.match(app, /event\?\.isNumberedLive === true/);
});

test("曲名候補を選んで該当する公演とDayを逆引きできる", () => {
  assert.match(html, /id="search-mode-songs"/);
  assert.match(html, /id="song-candidate-select"/);
  assert.match(app, /function songCandidates\(/);
  assert.match(app, /候補曲を1曲選ぶと、その曲が披露された公演を逆引きできます。/);
  assert.match(app, /candidate\.artist/);
  assert.match(app, /#\/event\/\$\{encodeURIComponent\(event\.id\)\}\/\$\{encodeURIComponent\(performance\.id\)\}/);
  assert.match(css, /\.song-candidate-select/);
  assert.match(css, /\.song-result-card/);
});

test("GitHub Pagesには公開ページだけを配信する", () => {
  assert.match(pagesWorkflow, /cp index\.html _site\//);
  assert.match(pagesWorkflow, /cp -R css js data _site\//);
  assert.match(pagesWorkflow, /cp admin\/js\/spotify-client\.js _site\/admin\/js\//);
  assert.doesNotMatch(pagesWorkflow, /cp -R admin/);
  assert.doesNotMatch(pagesWorkflow, /cp server\.py/);
});

test("訪問者の認証情報を使わずWorkerへ公演IDだけを送る", () => {
  assert.match(app, /window\.PublicPlaylistClient\.requestPlaylist/);
  assert.match(app, /eventPath: event\.__dataPath/);
  assert.match(app, /performanceId: performance\.id/);
  assert.doesNotMatch(app, /PublicSpotifyClient|spotifyConnected\(\)/);
  assert.match(playlistClient, /\/v1\/playlists/);
  assert.doesNotMatch(playlistClient, /spotify:track:/);
});

test("各音楽サービスを共通UIから選びSoundiizへ曲目を直接渡せる", () => {
  assert.match(html, /id="create-playlist-button" class="button button-service/);
  assert.match(html, /id="soundiiz-transfer-button" class="button button-service/);
  assert.match(html, /Apple Music \/ Amazon Musicで作成して開く/);
  assert.match(html, /Soundiiz経由/);
  assert.match(css, /\.playlist-service-actions/);
  assert.match(app, /PublicPlaylistClient\.requestSoundiizTransfer/);
  assert.match(app, /window\.location\.assign\(transfer\.shareUrl\)/);
  assert.match(playlistClient, /\/v1\/transfers\/soundiiz/);
  assert.match(playlistWorker, /soundiiz\.com\/go\/import-playlist/);
  assert.doesNotMatch(`${html}\n${app}\n${css}\n${playlistClient}`, /TuneMyMusic|tunemymusic/i);
});

test("Workerが作成用アカウントで非公開プレイリストを作る", () => {
  assert.match(playlistWorker, /spotifyAccessToken/);
  assert.match(playlistWorker, /"\/me\/playlists"/);
  assert.match(playlistWorker, /`\/playlists\/\$\{encodeURIComponent\(playlistId\)\}\/items`/);
  assert.doesNotMatch(playlistWorker, /\/tracks[`"']/);
  assert.match(playlistWorker, /public: false/);
});
