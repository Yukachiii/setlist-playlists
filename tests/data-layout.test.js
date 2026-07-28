const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dataRoot = path.join(root, "data");
const manifest = JSON.parse(
  fs.readFileSync(path.join(dataRoot, "index.json"), "utf8")
);

test("公演JSONはシリーズ別フォルダに分けて配置する", () => {
  assert.ok(Array.isArray(manifest.events));
  assert.ok(manifest.events.length > 0);
  assert.equal(new Set(manifest.events).size, manifest.events.length);

  for (const entry of manifest.events) {
    assert.match(entry, /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9_-]*\.json$/);
    const eventPath = path.join(dataRoot, ...entry.split("/"));
    assert.equal(fs.existsSync(eventPath), true, `${entry} が存在しません`);
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    const expectedDirectory = event.series?.[0] || "other";
    assert.equal(entry.split("/")[0], expectedDirectory, `${entry} のシリーズが不一致です`);
  }
});
