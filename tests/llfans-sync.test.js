const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "admin", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "admin", "js", "app.js"), "utf8");

test("未登録のLL-Fans公演を一覧から複数選択できる", () => {
  assert.match(html, /id="llfans-sync-button"/);
  assert.match(html, /id="llfans-sync-dialog"/);
  assert.match(html, /id="llfans-sync-list"/);
  assert.match(html, /id="start-llfans-sync-button"/);
  assert.match(app, /fetch\(`\/api\/llfans-events\$\{suffix\}`/);
  assert.match(app, /function matchingRegisteredEvent\(item\)/);
  assert.match(app, /llFansSourceId\(event\) === String\(item\.sourceId\)/);
});

test("選択した公演を既存のSpotify照合・確認フローへ順番に渡す", () => {
  assert.match(app, /async function advanceLlFansSyncQueue\(\)/);
  assert.match(app, /await initializePageImport\(body\)/);
  assert.match(app, /savePageImportWithOptions\(\{ preventDefault\(\) \{\} \}\)/);
  assert.match(app, /if \(state\.llfansSyncActive\) recordLlFansSyncResult\("added"\)/);
  assert.match(app, /if \(state\.llfansSyncActive\) scheduleNextLlFansSyncItem\(\)/);
});

test("LL-Fansの参照URLを保存し、次回同期の重複判定に利用する", () => {
  assert.match(app, /const referenceSource = state\.importDraft\?\.event\?\.llFansSource/);
  assert.match(app, /referenceSource\?\.url && referenceSource\.url !== sourceUrl/);
  assert.match(app, /source\?\.priority === "reference"/);
});
