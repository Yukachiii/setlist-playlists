const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const pages = [
  {
    name: "管理画面",
    html: fs.readFileSync(path.join(root, "admin", "index.html"), "utf8"),
    app: fs.readFileSync(path.join(root, "admin", "js", "app.js"), "utf8")
  },
  {
    name: "公開ページ",
    html: fs.readFileSync(path.join(root, "index.html"), "utf8"),
    app: fs.readFileSync(path.join(root, "js", "public-app.js"), "utf8")
  }
];

test("各ページのIDは重複せず、JavaScriptが参照する要素が存在する", () => {
  for (const { name, html, app } of pages) {
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    const referencedIds = [...app.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)]
      .map((match) => match[1]);
    const missingIds = referencedIds.filter((id) => !ids.includes(id));

    assert.deepEqual([...new Set(duplicateIds)], [], `${name}に重複IDがあります`);
    assert.deepEqual([...new Set(missingIds)], [], `${name}に存在しない参照IDがあります`);
  }
});

test("各ページは依存スクリプトをアプリ本体より先に読み込む", () => {
  const adminHtml = pages[0].html;
  const adminScripts = [
    "./js/page-text-parser.js",
    "./js/known-song-cache.js",
    "./js/spotify-client.js",
    "./js/app.js"
  ].map((source) => adminHtml.indexOf(source));
  assert.ok(adminScripts.every((index) => index >= 0));
  assert.deepEqual(adminScripts, [...adminScripts].sort((a, b) => a - b));

  const publicHtml = pages[1].html;
  const publicScripts = [
    "./admin/js/spotify-client.js",
    "./js/admin-spotify-callback.js",
    "./js/public-playlist-client.js",
    "./js/public-app.js"
  ].map((source) => publicHtml.indexOf(source));
  assert.ok(publicScripts.every((index) => index >= 0));
  assert.deepEqual(publicScripts, [...publicScripts].sort((a, b) => a - b));
  assert.doesNotMatch(publicHtml, /public-spotify-client/);
  assert.doesNotMatch(publicHtml, /id="spotify-connect-button"/);
});
