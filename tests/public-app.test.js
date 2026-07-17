const test = require("node:test");
const assert = require("node:assert/strict");

const app = require("../js/public-app.js");

test("Spotify Track URIは22文字のtrack URIだけを有効にする", () => {
  assert.equal(app.validSpotifyUri({ spotify: { uri: "spotify:track:1234567890123456789012" } }), true);
  assert.equal(app.validSpotifyUri({ spotify: { uri: "spotify:track:a" } }), false);
  assert.equal(app.validSpotifyUri({ spotify: { uri: null } }), false);
});

test("日付を日本語の曜日付きで表示する", () => {
  assert.equal(app.formatDate("2026-02-14"), "2026.2.14 (土)");
});

test("公演JSONとイベント配列の両方を読める", () => {
  const event = { id: "event", title: "Live" };
  assert.deepEqual(app.normalizeLoadedEvents(event), [event]);
  assert.deepEqual(app.normalizeLoadedEvents({ events: [event] }), [event]);
});

