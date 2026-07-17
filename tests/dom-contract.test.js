const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "admin", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "admin", "js", "app.js"), "utf8");

test("HTMLのIDは重複せず、JavaScriptが参照する要素が存在する", () => {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  const referencedIds = [...app.matchAll(/\$\("#([^"]+)"\)/g)].map((match) => match[1]);
  const missingIds = referencedIds.filter((id) => !ids.includes(id));

  assert.deepEqual([...new Set(duplicateIds)], []);
  assert.deepEqual([...new Set(missingIds)], []);
});

test("本文パーサーを管理画面より先に読み込む", () => {
  const parserIndex = html.indexOf("./js/page-text-parser.js");
  const knownSongCacheIndex = html.indexOf("./js/known-song-cache.js");
  const spotifyIndex = html.indexOf("./js/spotify-client.js");
  const appIndex = html.indexOf("./js/app.js");

  assert.ok(parserIndex >= 0);
  assert.ok(knownSongCacheIndex > parserIndex);
  assert.ok(spotifyIndex > knownSongCacheIndex);
  assert.ok(appIndex > spotifyIndex);
});

test("本文解析後にSpotify接続済みなら曲検索まで自動実行する", () => {
  assert.match(app, /async function parsePageImportText\(\)/);
  assert.match(app, /async function initializePageImport\(parsed\)/);
  assert.match(app, /if \(window\.SpotifyClient\.isConnected\(\)\) \{[\s\S]*?await enrichArtistsFromSpotify\(\);/);
  assert.match(app, /const parsed = window\.SetlistPageParser\.parseLlFansPage\(rawText\);[\s\S]*?await initializePageImport\(parsed\);/);
});

test("LL-Fans URLから複数公演を取得して一括登録する", () => {
  assert.match(app, /fetch\(`\/api\/llfans-event\?url=/);
  assert.match(app, /state\.importDraft = normalizeImportDraft\(parsed\)/);
  assert.match(app, /targetEvent\.performances\.push\(\.\.\.performances\)/);
});

test("原曲フォールバック設定をSpotify検索へ渡して結果を明記する", () => {
  assert.match(app, /searchBestTrack\(\{[\s\S]*?matchPolicy/);
  assert.match(app, /result\.matchKind === "original_fallback"[\s\S]*?"原曲で補完"/);
});

test("登録済み曲をSpotifyで再検索して差し替えられる", () => {
  assert.match(html, /id="spotify-research-all-button"/);
  assert.match(html, /class="research-song spotify-candidates-button"/);
  assert.match(app, /function openEditorSpotifyCandidateDialog\(row\)/);
  assert.match(app, /state\.spotifyManualContext === "editor"[\s\S]*?trackId: track\.id/);
  assert.match(app, /status === "matched"[\s\S]*?"Spotifyで再検索"/);
  assert.match(app, /async function researchDraftSetlistFromSpotify\(\)/);
  assert.match(app, /searchBestTrack\(\{[\s\S]*?title,[\s\S]*?version,[\s\S]*?matchPolicy/);
  assert.match(app, /要確認・見つからずの曲は現在の登録を保持しています/);
});

test("一度手動確定したSpotify曲を次回以降へ自動反映する", () => {
  assert.match(app, /CONFIRMED_SPOTIFY_KEY = "setlist_confirmed_spotify_mappings_v01"/);
  assert.match(app, /function rememberConfirmedSpotifyMapping\(title, version, track\)/);
  assert.match(app, /function findConfirmedSpotifyMapping\(title, version\)/);
  assert.match(app, /rememberConfirmedSpotifyMapping\(title, version, track\)/);
  assert.match(app, /"手動設定を自動反映"/);
  assert.match(app, /findKnownSongByTitle\(index, title\)/);
});

test("Spotify候補にアルバムジャケットを表示する", () => {
  assert.match(app, /track\.album\?\.images/);
  assert.match(app, /className = "spotify-candidate-artwork"/);
  assert.match(app, /image\.loading = "lazy"/);
});

test("登録時に未登録曲を1曲ずつ設定または未配信にできる", () => {
  assert.match(html, /id="spotify-review-progress"/);
  assert.match(html, /id="mark-unavailable-spotify-candidate-button"[^>]*>この曲を未配信として登録</);
  assert.match(app, /function collectUnresolvedSpotifySongs\(\)/);
  assert.match(app, /function startSpotifyReview\(queue\)/);
  assert.match(app, /function markCurrentSpotifyReviewSongUnavailable\(\)/);
  assert.match(app, /function advanceSpotifyReview\(\)/);
  assert.match(app, /function finishSpotifyReview\(\)/);
  assert.match(app, /spotifyMatchPolicy: spotifyUnavailable \? "unavailable"/);
  assert.match(app, /savePageImportWithOptions\([\s\S]*?\{ skipSpotifyReview: true \}\)/);
});

test("同じ曲の重複確認と前のSpotify検索結果の混入を防ぐ", () => {
  assert.match(app, /const seen = new Set\(\)/);
  assert.match(app, /if \(!item\.title \|\| seen\.has\(key\)\) continue/);
  assert.match(app, /const requestId = \+\+state\.spotifySearchRequestId/);
  assert.match(app, /if \(requestId !== state\.spotifySearchRequestId\) return/);
});

test("管理画面から公開JSONの保存とGitHub pushを実行できる", () => {
  assert.match(html, /id="publish-github-button"/);
  assert.match(html, /id="github-publish-state"/);
  assert.match(app, /fetch\("\/api\/github-publish-status"/);
  assert.match(app, /fetch\("\/api\/github-publish"/);
  assert.match(app, /function publishSelectedEventToGitHub\(\)/);
  assert.match(app, /このプロジェクト内の変更をすべてcommit/);
});
