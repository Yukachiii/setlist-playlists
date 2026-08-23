const test = require("node:test");
const assert = require("node:assert/strict");

const app = require("../js/public-app.js");

test("Spotify Track IDをURIから取得できる", () => {
  const trackId = "abcdefghijklmnopqrstuv";
  assert.equal(app.spotifyTrackId({ spotify: { uri: `spotify:track:${trackId}` } }), trackId);
  assert.equal(app.spotifyTrackId({ spotify: { uri: "spotify:track:short" } }), "");
});

test("保存済みジャケットURLはHTTPSだけを使用する", () => {
  assert.equal(
    app.spotifyArtworkUrl({ spotify: { artworkUrl: "https://example.com/cover.jpg" } }),
    "https://example.com/cover.jpg"
  );
  assert.equal(
    app.spotifyArtworkUrl({ spotify: { artworkUrl: "http://example.com/cover.jpg" } }),
    ""
  );
});

test("Spotify oEmbedからジャケットURLを取得する", async () => {
  const originalFetch = global.fetch;
  const trackId = "abcdefghijklmnopqrstuv";
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ thumbnail_url: "https://example.com/oembed.jpg" })
  });

  try {
    assert.equal(await app.fetchSpotifyArtwork(trackId), "https://example.com/oembed.jpg");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Spotify Track URIは22文字のtrack URIだけを有効にする", () => {
  assert.equal(app.validSpotifyUri({ spotify: { uri: "spotify:track:1234567890123456789012" } }), true);
  assert.equal(app.validSpotifyUri({ spotify: { uri: "spotify:track:a" } }), false);
  assert.equal(app.validSpotifyUri({ spotify: { uri: null } }), false);
  assert.equal(app.validSpotifyUri({
    spotifyMatchPolicy: "unavailable",
    spotify: { uri: "spotify:track:1234567890123456789012" }
  }), false);
});

test("未配信と未登録を区別する", () => {
  const unavailable = { spotifyMatchPolicy: "unavailable", spotify: { status: "unmatched" } };
  const unregistered = { spotifyMatchPolicy: "exact", spotify: { status: "unmatched" } };
  assert.equal(app.isSpotifyUnavailable(unavailable), true);
  assert.equal(app.isSpotifyUnavailable(unregistered), false);
  assert.equal(app.spotifyAvailabilityLabel(unavailable), "未配信");
  assert.equal(app.spotifyAvailabilityLabel(unregistered), "未登録");
});

test("日付を日本語の曜日付きで表示する", () => {
  assert.equal(app.formatDate("2026-02-14"), "2026.2.14 (土)");
});

test("公演JSONとイベント配列の両方を読める", () => {
  const event = { id: "event", title: "Live" };
  assert.deepEqual(app.normalizeLoadedEvents(event), [event]);
  assert.deepEqual(app.normalizeLoadedEvents({ events: [event] }), [event]);
});

test("ナンバリング公演は明示的にtrueのイベントだけを対象にする", () => {
  assert.equal(app.isNumberedLive({ isNumberedLive: true }), true);
  assert.equal(app.isNumberedLive({ isNumberedLive: false }), false);
  assert.equal(app.isNumberedLive({ title: "1st Live" }), false);
  assert.equal(app.isNumberedLive({ title: "7th Live" }), false);
});

test("曲名候補をバージョンとアーティスト別に分けて披露公演を逆引きする", () => {
  const repeated = {
    recording: { displayTitle: "Dream Believers（105期 Ver.）", baseTitle: "Dream Believers" },
    artistHint: "蓮ノ空女学院スクールアイドルクラブ"
  };
  const events = [
    {
      id: "numbered-live",
      title: "Numbered Live",
      series: ["hasunosora"],
      isNumberedLive: true,
      performances: [
        { id: "day-1", setlist: [repeated, { ...repeated }] },
        {
          id: "day-2",
          setlist: [{
            recording: { displayTitle: "Dream Believers", baseTitle: "Dream Believers" },
            artistHint: "蓮ノ空女学院スクールアイドルクラブ"
          }]
        },
        {
          id: "day-3",
          setlist: [{
            recording: { displayTitle: "Dream Believers（105期Ver.）", baseTitle: "Dream Believers" },
            artistHint: "蓮ノ空女学院スクールアイドルクラブ"
          }]
        }
      ]
    },
    {
      id: "other-live",
      title: "Other Live",
      series: ["hasunosora"],
      isNumberedLive: false,
      performances: [{
        id: "cover",
        setlist: [{ recording: { displayTitle: "Dream Believers" }, artistHint: "別アーティスト" }]
      }]
    }
  ];

  const candidates = app.songCandidates(events, "dream believers");
  assert.equal(candidates.length, 3);
  assert.deepEqual(
    candidates.map((candidate) => [candidate.title, candidate.artist, candidate.occurrences.length]),
    [
      ["Dream Believers", "蓮ノ空女学院スクールアイドルクラブ", 1],
      ["Dream Believers", "別アーティスト", 1],
      ["Dream Believers（105期 Ver.）", "蓮ノ空女学院スクールアイドルクラブ", 2]
    ]
  );

  const numberedOnly = app.songCandidates(events, "Dream Believers", "hasunosora", true);
  assert.equal(numberedOnly.length, 2);
  assert.equal(numberedOnly.reduce((total, candidate) => total + candidate.occurrences.length, 0), 3);
});
