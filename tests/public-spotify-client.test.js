const test = require("node:test");
const assert = require("node:assert/strict");

const spotify = require("../js/public-spotify-client.js");

function withWindow(value, callback) {
  const originalWindow = global.window;
  global.window = value;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (originalWindow === undefined) delete global.window;
      else global.window = originalWindow;
    });
}

test("100曲ごとにSpotify追加リクエストを分割する", () => {
  const chunks = spotify.chunkItems(Array.from({ length: 205 }, (_, index) => index));
  assert.deepEqual(chunks.map((chunk) => chunk.length), [100, 100, 5]);
});

test("公開ページのパスからRedirect URIを生成する", async () => {
  await withWindow(
    { location: { href: "https://example.github.io/setlists/index.html#/event/live" } },
    () => assert.equal(spotify.redirectUri(), "https://example.github.io/setlists/")
  );
});

test("非公開プレイリストを作り、曲順と重複を保ってitemsへ追加する", async () => {
  const originalFetch = global.fetch;
  const storage = new Map([
    [
      "setlist_public_spotify_auth_v01",
      JSON.stringify({ accessToken: "token", expiresAt: Date.now() + 60000 })
    ]
  ]);
  const calls = [];
  const uris = Array.from({ length: 101 }, (_, index) => `spotify:track:${String(index % 100).padStart(22, "0")}`);

  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/me/playlists")) {
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: "playlist-id", external_urls: { spotify: "https://open.spotify.com/playlist/id" } })
      };
    }
    return { ok: true, status: 201, json: async () => ({ snapshot_id: "snapshot" }) };
  };

  try {
    await withWindow(
      {
        sessionStorage: {
          getItem: (key) => storage.get(key) || null,
          setItem: (key, value) => storage.set(key, value),
          removeItem: (key) => storage.delete(key)
        }
      },
      async () => {
        await spotify.createPrivatePlaylist({ name: "Live", description: "Setlist", uris });
      }
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, "https://api.spotify.com/v1/me/playlists");
  assert.equal(JSON.parse(calls[0].options.body).public, false);
  assert.match(calls[1].url, /\/playlists\/playlist-id\/items$/);
  assert.deepEqual(JSON.parse(calls[1].options.body).uris, uris.slice(0, 100));
  assert.deepEqual(JSON.parse(calls[2].options.body).uris, uris.slice(100));
});

