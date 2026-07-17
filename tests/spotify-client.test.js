const test = require("node:test");
const assert = require("node:assert/strict");

const spotify = require("../admin/js/spotify-client.js");

test("管理画面のSpotify認証は公開ページのルートURLへ戻す", () => {
  const originalWindow = global.window;
  global.window = { location: { href: "http://127.0.0.1:8765/admin/" } };
  try {
    assert.equal(spotify.redirectUri(), "http://127.0.0.1:8765/");
    global.window.location.href = "https://example.github.io/setlists/admin/";
    assert.equal(spotify.redirectUri(), "https://example.github.io/setlists/");
  } finally {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
  }
});

function track(id, name, artist, options = {}) {
  const value = {
    id,
    uri: `spotify:track:${id}`,
    name,
    artists: [{ name: artist }]
  };
  if (options.isrc) value.external_ids = { isrc: options.isrc };
  if (options.isPlayable !== undefined) value.is_playable = options.isPlayable;
  return value;
}

test("同名曲が一意ならSpotify曲を自動選択する", () => {
  const result = spotify.chooseTrackCandidate(
    [track("1", "What is my LIFE?", "いきづらい部！")],
    { title: "What is my LIFE?", version: "", artistHint: "" }
  );

  assert.equal(result.status, "matched");
  assert.equal(result.track.id, "1");
});

test("同名曲が複数アーティストにまたがる場合は自動選択しない", () => {
  const result = spotify.chooseTrackCandidate(
    [
      track("1", "同じ曲", "Artist A"),
      track("2", "同じ曲", "Artist B")
    ],
    { title: "同じ曲", version: "", artistHint: "" }
  );

  assert.equal(result.status, "ambiguous");
  assert.equal(result.track, null);
});

test("候補名が曲名と一致しなければ未一致にする", () => {
  const result = spotify.chooseTrackCandidate(
    [track("1", "別の曲", "Artist")],
    { title: "探している曲", version: "", artistHint: "" }
  );

  assert.equal(result.status, "unmatched");
});

test("バージョン名まで完全一致する音源を優先して自動選択する", () => {
  const result = spotify.chooseTrackCandidate(
    [
      track("original", "AWOKE", "DOLLCHESTRA"),
      track("version", "AWOKE (104期 Ver.)", "DOLLCHESTRA")
    ],
    { title: "AWOKE", version: "104期 Ver.", artistHint: "DOLLCHESTRA" }
  );

  assert.equal(result.status, "matched");
  assert.equal(result.matchKind, "version");
  assert.equal(result.track.id, "version");
});

test("104期 Ver.表記がSpotify曲名になくても曲名完全一致が一意なら自動選択する", () => {
  const result = spotify.chooseTrackCandidate(
    [
      track("seishun", "青春の輪郭", "DOLLCHESTRA"),
      track("other", "青春の輪郭線", "Other Artist")
    ],
    {
      title: "青春の輪郭",
      version: "104期 Ver.",
      matchPolicy: "exact"
    }
  );

  assert.equal(result.status, "matched");
  assert.equal(result.matchKind, "title_unlabeled_version");
  assert.equal(result.track.id, "seishun");
});

test("原曲フォールバック指定ならバージョン不一致時に一意の原曲を選ぶ", () => {
  const result = spotify.chooseTrackCandidate(
    [track("original", "永遠の一瞬", "虹ヶ咲学園スクールアイドル同好会")],
    {
      title: "永遠の一瞬",
      version: "ショート Ver.",
      matchPolicy: "original_fallback"
    }
  );

  assert.equal(result.status, "matched");
  assert.equal(result.matchKind, "original_fallback");
  assert.equal(result.track.id, "original");
});

test("原曲フォールバックでも同名の原曲が複数なら自動選択しない", () => {
  const result = spotify.chooseTrackCandidate(
    [
      track("solo", "同じ曲", "Solo Artist"),
      track("group", "同じ曲", "Group Artist")
    ],
    {
      title: "同じ曲",
      version: "ショート Ver.",
      matchPolicy: "original_fallback"
    }
  );

  assert.equal(result.status, "ambiguous");
  assert.equal(result.track, null);
});

test("原曲フォールバック指定でもバージョン曲が一意ならそちらを優先する", () => {
  const result = spotify.chooseTrackCandidate(
    [
      track("original", "AWOKE", "DOLLCHESTRA"),
      track("version", "AWOKE 104期 Ver.", "DOLLCHESTRA")
    ],
    {
      title: "AWOKE",
      version: "104期 Ver.",
      matchPolicy: "original_fallback"
    }
  );

  assert.equal(result.status, "matched");
  assert.equal(result.matchKind, "version");
  assert.equal(result.track.id, "version");
});

test("同じ曲名が同じアーティストで複数件あっても自動選択しない", () => {
  const result = spotify.chooseTrackCandidate(
    [
      track("single", "同じ曲", "Artist"),
      track("album", "同じ曲", "Artist")
    ],
    { title: "同じ曲", version: "", artistHint: "Artist" }
  );

  assert.equal(result.status, "ambiguous");
  assert.equal(result.track, null);
});

test("同じISRCのシングル版とアルバム版は同一音源として自動選択する", () => {
  const result = spotify.chooseTrackCandidate(
    [
      track("single", "ド！ド！ド！", "みらくらぱーく！", { isrc: "JP-LA0-26-00001" }),
      track("album", "ド！ド！ド！", "みらくらぱーく！", { isrc: "JP-LA0-26-00001" })
    ],
    { title: "ド！ド！ド！", version: "104期 Ver.", matchPolicy: "exact" }
  );

  assert.equal(result.status, "matched");
  assert.equal(result.matchKind, "same_recording");
  assert.equal(result.track.id, "single");
});

test("曲名とアーティストが同じでもISRCが異なる音源は自動選択しない", () => {
  const result = spotify.chooseTrackCandidate(
    [
      track("old", "同じ曲", "Artist", { isrc: "JP-AAA-24-00001" }),
      track("new", "同じ曲", "Artist", { isrc: "JP-AAA-25-00001" })
    ],
    { title: "同じ曲", version: "104期 Ver.", matchPolicy: "exact" }
  );

  assert.equal(result.status, "ambiguous");
  assert.equal(result.track, null);
});

test("アーティスト候補は自動選択の判定に使用しない", () => {
  const result = spotify.chooseTrackCandidate(
    [
      track("solo", "同じ曲", "Solo Artist"),
      track("group", "同じ曲", "Group Artist")
    ],
    { title: "同じ曲", version: "", artistHint: "Group Artist" }
  );

  assert.equal(result.status, "ambiguous");
  assert.equal(result.track, null);
});

test("手動選択用の検索結果はSpotify Track IDで重複を除く", () => {
  const first = track("1", "同じ曲", "Artist");
  const results = spotify.uniqueTracks([
    first,
    { ...first, name: "同じIDの別表示" },
    track("2", "別候補", "Artist")
  ]);

  assert.deepEqual(results.map((item) => item.id), ["1", "2"]);
});

test("自動一致しないSpotify検索結果も手動選択候補として返す", async () => {
  const originalWindow = global.window;
  const originalFetch = global.fetch;
  let requestedUrl = "";
  const storage = new Map([
    [
      "setlist_spotify_auth_v01",
      JSON.stringify({ accessToken: "test-token", expiresAt: Date.now() + 60000 })
    ]
  ]);
  global.window = {
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    }
  };
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        tracks: { items: [track("candidate", "似ている候補", "Candidate Artist")] }
      })
    };
  };

  try {
    const result = await spotify.searchBestTrack({
      title: "探している曲",
      version: "",
      artistHint: ""
    });
    assert.equal(result.status, "unmatched");
    assert.deepEqual(result.results.map((item) => item.id), ["candidate"]);
    assert.equal(new URL(requestedUrl).searchParams.get("q"), "探している曲");
  } finally {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
    global.fetch = originalFetch;
  }
});
