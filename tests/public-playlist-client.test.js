const test = require("node:test");
const assert = require("node:assert/strict");

const playlistClient = require("../js/public-playlist-client.js");

function withBrowser(value, callback) {
  const originalWindow = global.window;
  const originalFetch = global.fetch;
  global.window = value.window;
  if (value.fetch) global.fetch = value.fetch;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (originalWindow === undefined) delete global.window;
      else global.window = originalWindow;
      global.fetch = originalFetch;
    });
}

function browser(apiUrl = "https://worker.example") {
  return {
    document: {
      querySelector: () => ({ content: apiUrl })
    }
  };
}

test("Cloudflare Workerの設定URLを読み込む", async () => {
  await withBrowser({ window: browser() }, () => {
    assert.equal(playlistClient.apiBaseUrl(), "https://worker.example");
    assert.equal(playlistClient.isConfigured(), true);
  });
});

test("公演IDだけをWorkerへ送り共有プレイリストURLを受け取る", async () => {
  const calls = [];
  await withBrowser(
    {
      window: browser(),
      fetch: async (url, options) => {
        calls.push({ url: String(url), options });
        return {
          ok: true,
          status: 201,
          json: async () => ({
            ok: true,
            created: true,
            playlistUrl: "https://open.spotify.com/playlist/3gqj2EA3KDnYIcDsJq5F8L",
            trackCount: 29
          })
        };
      }
    },
    async () => {
      const result = await playlistClient.requestPlaylist({
        eventPath: "ikizulive/example-live.json",
        performanceId: "example-live-day-1"
      });
      assert.equal(result.created, true);
      assert.equal(calls[0].url, "https://worker.example/v1/playlists");
      assert.deepEqual(JSON.parse(calls[0].options.body), {
        eventPath: "ikizulive/example-live.json",
        performanceId: "example-live-day-1"
      });
      assert.doesNotMatch(calls[0].options.body, /spotify:track:/);
    }
  );
});

test("未公開のデータパスはWorkerへ送らない", async () => {
  await withBrowser({ window: browser() }, async () => {
    await assert.rejects(
      playlistClient.requestPlaylist({ eventPath: "../secret.json", performanceId: "live" }),
      /GitHubへ公開/
    );
  });
});

test("公演IDをWorkerへ送りSoundiizの移行URLを受け取る", async () => {
  const calls = [];
  await withBrowser(
    {
      window: browser(),
      fetch: async (url, options) => {
        calls.push({ url: String(url), options });
        return {
          ok: true,
          status: 201,
          json: async () => ({
            ok: true,
            shareUrl: "https://soundiiz.com/go/import-playlist/0123456789abcdef0123456789abcdef",
            trackCount: 29,
            expiresAt: 1782220923
          })
        };
      }
    },
    async () => {
      const result = await playlistClient.requestSoundiizTransfer({
        eventPath: "ikizulive/example-live.json",
        performanceId: "example-live-day-1"
      });
      assert.equal(result.trackCount, 29);
      assert.equal(calls[0].url, "https://worker.example/v1/transfers/soundiiz");
      assert.deepEqual(JSON.parse(calls[0].options.body), {
        eventPath: "ikizulive/example-live.json",
        performanceId: "example-live-day-1"
      });
      assert.doesNotMatch(calls[0].options.body, /spotify:track:/);
    }
  );
  assert.equal(
    playlistClient.isSoundiizShareUrl("https://soundiiz.com/go/import-playlist/0123456789abcdef"),
    true
  );
  assert.equal(playlistClient.isSoundiizShareUrl("https://attacker.example/import-playlist/token"), false);
});
