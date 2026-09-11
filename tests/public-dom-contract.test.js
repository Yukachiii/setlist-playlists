const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "js", "public-app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "public.css"), "utf8");
const playlistClient = fs.readFileSync(path.join(root, "js", "public-playlist-client.js"), "utf8");
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

test("公開ページにはローカル管理画面へのリンクを表示しない", () => {
  assert.doesNotMatch(html, /href="\.\/admin\/"/);
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

test("公演検索と曲名検索は別々の検索窓と検索語を使う", () => {
  assert.match(html, /id="event-search"[^>]*placeholder="公演名・会場名で検索"/);
  assert.match(html, /id="song-search"[^>]*placeholder="曲名で検索"/);
  assert.match(app, /eventQuery:\s*""/);
  assert.match(app, /songQuery:\s*""/);
  assert.match(app, /normalizeSearch\(state\.eventQuery\)/);
  assert.match(app, /normalizeSearch\(state\.songQuery\)/);
  assert.doesNotMatch(app, /state\.query/);
  assert.match(app, /event-search-box[^\n]+classList\.toggle\("hidden", songMode\)/);
  assert.match(app, /song-search-box[^\n]+classList\.toggle\("hidden", !songMode\)/);
});

test("公演検索と曲名検索でシリーズ絞り込みを別々に保持する", () => {
  assert.match(html, /class="filter-label">シリーズ</);
  assert.match(html, /id="series-filters"/);
  assert.match(app, /eventSeries:\s*"all"/);
  assert.match(app, /songSeries:\s*"all"/);
  assert.match(app, /state\.searchMode === "songs" \? state\.songSeries : state\.eventSeries/);
  assert.match(app, /songCandidates\(state\.events, state\.songQuery, state\.songSeries/);
  assert.match(app, /state\.eventSeries !== "all"/);
  assert.doesNotMatch(app, /state\.series/);
});

test("GitHub Pagesには公開ページだけを配信する", () => {
  assert.match(pagesWorkflow, /cp index\.html _site\//);
  assert.match(pagesWorkflow, /cp -R css js data _site\//);
  assert.match(pagesWorkflow, /cp admin\/js\/spotify-client\.js _site\/admin\/js\//);
  assert.doesNotMatch(pagesWorkflow, /cp -R admin/);
  assert.doesNotMatch(pagesWorkflow, /cp server\.py/);
});

test("各音楽サービスを共通UIから選びSoundiizへ曲目を直接渡せる", () => {
  assert.match(html, /id="create-playlist-button" class="button button-service/);
  assert.match(html, /id="soundiiz-transfer-button" class="button button-service/);
  assert.match(html, /Apple Music \/ Amazon Musicで作成して開く/);
  assert.match(html, /Soundiiz経由/);
  assert.match(css, /\.playlist-service-actions/);
  assert.doesNotMatch(`${html}\n${app}\n${css}\n${playlistClient}`, /TuneMyMusic|tunemymusic/i);
});
