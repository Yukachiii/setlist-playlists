const test = require("node:test");
const assert = require("node:assert/strict");

const spotify = require("../admin/js/spotify-client.js");

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

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

test("Spotify接続情報をブラウザ終了後も残る領域へ保存して再利用する", () => {
  const originalWindow = global.window;
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  localStorage.setItem(
    "setlist_spotify_auth_v01",
    JSON.stringify({
      accessToken: "persistent-token",
      refreshToken: "persistent-refresh-token",
      expiresAt: Date.now() + 60000,
      profile: { id: "admin" }
    })
  );
  global.window = {
    location: { href: "http://127.0.0.1:8765/admin/" },
    localStorage,
    sessionStorage
  };

  try {
    assert.equal(spotify.isConnected(), true);
    assert.equal(spotify.profile().id, "admin");
    spotify.disconnect();
    assert.equal(localStorage.getItem("setlist_spotify_auth_v01"), null);
    assert.equal(spotify.isConnected(), false);
  } finally {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
  }
});

test("旧版のタブ内Spotify接続情報を永続保存へ移行する", () => {
  const originalWindow = global.window;
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  sessionStorage.setItem(
    "setlist_spotify_auth_v01",
    JSON.stringify({ accessToken: "legacy-token", expiresAt: Date.now() + 60000 })
  );
  global.window = {
    location: { href: "http://127.0.0.1:8765/admin/" },
    localStorage,
    sessionStorage
  };

  try {
    assert.equal(spotify.isConnected(), true);
    assert.ok(localStorage.getItem("setlist_spotify_auth_v01"));
    assert.equal(sessionStorage.getItem("setlist_spotify_auth_v01"), null);
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

test("曲名一致候補は音源が一意な場合だけ自動選択する", () => {
  const cases = [
    {
      name: "同名曲が一意",
      tracks: [track("1", "What is my LIFE?", "いきづらい部！")],
      song: { title: "What is my LIFE?", version: "", artistHint: "" },
      status: "matched",
      trackId: "1"
    },
    {
      name: "候補名が不一致",
      tracks: [track("1", "別の曲", "Artist")],
      song: { title: "探している曲", version: "", artistHint: "" },
      status: "unmatched",
      trackId: null
    },
    {
      name: "同名曲が複数アーティスト",
      tracks: [track("1", "同じ曲", "Artist A"), track("2", "同じ曲", "Artist B")],
      song: { title: "同じ曲", version: "", artistHint: "" },
      status: "ambiguous",
      trackId: null
    },
    {
      name: "同一アーティストでも複数音源",
      tracks: [track("single", "同じ曲", "Artist"), track("album", "同じ曲", "Artist")],
      song: { title: "同じ曲", version: "", artistHint: "Artist" },
      status: "ambiguous",
      trackId: null
    },
    {
      name: "アーティスト候補では絞り込まない",
      tracks: [track("solo", "同じ曲", "Solo Artist"), track("group", "同じ曲", "Group Artist")],
      song: { title: "同じ曲", version: "", artistHint: "Group Artist" },
      status: "ambiguous",
      trackId: null
    }
  ];

  for (const current of cases) {
    const result = spotify.chooseTrackCandidate(current.tracks, current.song);
    assert.equal(result.status, current.status, current.name);
    assert.equal(result.track?.id ?? null, current.trackId, current.name);
  }
});

test("バージョン指定とISRCに従ってSpotify音源を判定する", () => {
  const cases = [
    {
      name: "バージョン名まで完全一致",
      tracks: [
        track("original", "AWOKE", "DOLLCHESTRA"),
        track("version", "AWOKE (104期 Ver.)", "DOLLCHESTRA")
      ],
      song: { title: "AWOKE", version: "104期 Ver.", artistHint: "DOLLCHESTRA" },
      status: "matched",
      matchKind: "version",
      trackId: "version"
    },
    {
      name: "Spotify側にバージョン表記がない一意な完全一致",
      tracks: [
        track("seishun", "青春の輪郭", "DOLLCHESTRA"),
        track("other", "青春の輪郭線", "Other Artist")
      ],
      song: { title: "青春の輪郭", version: "104期 Ver.", matchPolicy: "exact" },
      status: "matched",
      matchKind: "title_unlabeled_version",
      trackId: "seishun"
    },
    {
      name: "原曲フォールバック",
      tracks: [track("original", "永遠の一瞬", "虹ヶ咲学園スクールアイドル同好会")],
      song: { title: "永遠の一瞬", version: "ショート Ver.", matchPolicy: "original_fallback" },
      status: "matched",
      matchKind: "original_fallback",
      trackId: "original"
    },
    {
      name: "原曲フォールバック候補が複数",
      tracks: [track("solo", "同じ曲", "Solo Artist"), track("group", "同じ曲", "Group Artist")],
      song: { title: "同じ曲", version: "ショート Ver.", matchPolicy: "original_fallback" },
      status: "ambiguous",
      trackId: null
    },
    {
      name: "フォールバックよりバージョン一致を優先",
      tracks: [
        track("original", "AWOKE", "DOLLCHESTRA"),
        track("version", "AWOKE 104期 Ver.", "DOLLCHESTRA")
      ],
      song: { title: "AWOKE", version: "104期 Ver.", matchPolicy: "original_fallback" },
      status: "matched",
      matchKind: "version",
      trackId: "version"
    },
    {
      name: "同じISRCのシングル版とアルバム版",
      tracks: [
        track("single", "ド！ド！ド！", "みらくらぱーく！", { isrc: "JP-LA0-26-00001" }),
        track("album", "ド！ド！ド！", "みらくらぱーく！", { isrc: "JP-LA0-26-00001" })
      ],
      song: { title: "ド！ド！ド！", version: "104期 Ver.", matchPolicy: "exact" },
      status: "matched",
      matchKind: "same_recording",
      trackId: "single"
    },
    {
      name: "異なるISRCの同名音源",
      tracks: [
        track("old", "同じ曲", "Artist", { isrc: "JP-AAA-24-00001" }),
        track("new", "同じ曲", "Artist", { isrc: "JP-AAA-25-00001" })
      ],
      song: { title: "同じ曲", version: "104期 Ver.", matchPolicy: "exact" },
      status: "ambiguous",
      trackId: null
    }
  ];

  for (const current of cases) {
    const result = spotify.chooseTrackCandidate(current.tracks, current.song);
    assert.equal(result.status, current.status, current.name);
    assert.equal(result.track?.id ?? null, current.trackId, current.name);
    if (current.matchKind) assert.equal(result.matchKind, current.matchKind, current.name);
  }
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

test("廃止されたSpotifyの複数曲一括取得を使わず1曲ずつ取得する", async () => {
  const originalWindow = global.window;
  const originalFetch = global.fetch;
  const storage = memoryStorage();
  const requestedUrls = [];
  storage.setItem(
    "setlist_spotify_auth_v01",
    JSON.stringify({ accessToken: "test-token", expiresAt: Date.now() + 60000 })
  );
  global.window = { localStorage: storage, sessionStorage: memoryStorage() };
  global.fetch = async (url) => {
    requestedUrls.push(String(url));
    const id = new URL(String(url)).pathname.split("/").at(-1);
    return {
      ok: true,
      status: 200,
      json: async () => track(id, `曲${id}`, "Artist")
    };
  };

  try {
    const tracks = await spotify.getTracks(["track-a", "track-b", "track-a"]);
    assert.deepEqual(tracks.map((item) => item.id), ["track-a", "track-b"]);
    assert.equal(requestedUrls.length, 2);
    assert.ok(requestedUrls.every((url) => /\/tracks\/track-[ab]\?market=JP$/.test(url)));
    assert.ok(requestedUrls.every((url) => !url.includes("/tracks?ids=")));
  } finally {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
    global.fetch = originalFetch;
  }
});

test("取得途中のSpotify曲を保存し、再読み込み後は未取得分だけ再開する", async () => {
  const originalWindow = global.window;
  const originalFetch = global.fetch;
  const modulePath = require.resolve("../admin/js/spotify-client.js");
  const storage = memoryStorage();
  storage.setItem(
    "setlist_spotify_auth_v01",
    JSON.stringify({ accessToken: "test-token", expiresAt: Date.now() + 60000 })
  );
  global.window = { localStorage: storage, sessionStorage: memoryStorage() };
  const firstRequests = [];
  global.fetch = async (url) => {
    const id = new URL(String(url)).pathname.split("/").at(-1);
    firstRequests.push(id);
    if (id === "resume-c") {
      return {
        ok: false,
        status: 429,
        headers: { get: () => "30" },
        json: async () => ({})
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => track(id, `曲${id}`, "Artist")
    };
  };

  try {
    delete require.cache[modulePath];
    const firstClient = require(modulePath);
    await assert.rejects(
      firstClient.getTracks(["resume-a", "resume-b", "resume-c"]),
      /検索回数制限/
    );
    assert.deepEqual(firstRequests.sort(), ["resume-a", "resume-b", "resume-c"]);
    assert.ok(storage.getItem("setlist_spotify_track_cache_v01"));

    const resumedRequests = [];
    global.fetch = async (url) => {
      const id = new URL(String(url)).pathname.split("/").at(-1);
      resumedRequests.push(id);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => track(id, `曲${id}`, "Artist")
      };
    };
    delete require.cache[modulePath];
    const resumedClient = require(modulePath);
    const progress = [];
    const tracks = await resumedClient.getTracks(
      ["resume-a", "resume-b", "resume-c"],
      (_completed, _total, detail) => progress.push(detail)
    );

    assert.deepEqual(resumedRequests, ["resume-c"]);
    assert.deepEqual(tracks.map((item) => item.id), ["resume-a", "resume-b", "resume-c"]);
    assert.deepEqual(progress[0], { cached: 2, fetched: 0, fetchTotal: 1 });
  } finally {
    delete require.cache[modulePath];
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
    global.fetch = originalFetch;
  }
});

test("Spotify作品一覧は各APIの現在のlimit上限で取得する", async () => {
  const originalWindow = global.window;
  const originalFetch = global.fetch;
  const storage = memoryStorage();
  const requestedUrls = [];
  storage.setItem(
    "setlist_spotify_auth_v01",
    JSON.stringify({ accessToken: "test-token", expiresAt: Date.now() + 60000 })
  );
  global.window = { localStorage: storage, sessionStorage: memoryStorage() };
  global.fetch = async (url) => {
    requestedUrls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ items: [], next: null })
    };
  };

  try {
    await spotify.getArtistAlbums("artist-id");
    await spotify.getAlbumTracks("album-id");
    assert.equal(new URL(requestedUrls[0]).searchParams.get("limit"), "10");
    assert.equal(new URL(requestedUrls[1]).searchParams.get("limit"), "50");
  } finally {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
    global.fetch = originalFetch;
  }
});

test("同じ音源は最初の配信日を採用してアルバム再収録を新曲扱いしない", () => {
  const details = [
    track("single", "New Song", "Artist", { isrc: "JP-AAA-26-00001" }),
    track("album", "New Song", "Artist", { isrc: "JP-AAA-26-00001" }),
    track("other", "Other Song", "Artist", { isrc: "JP-AAA-26-00002" })
  ];
  const entries = [
    { trackId: "album", releaseDate: "2026-08-01", albumName: "Album" },
    { trackId: "single", releaseDate: "2026-03-01", albumName: "Single" },
    { trackId: "other", releaseDate: "2026-06-01", albumName: "Other" }
  ];

  const earliest = spotify.earliestReleaseEntries(entries, details);
  assert.deepEqual(
    earliest.map((entry) => [entry.track.id, entry.releaseDate]),
    [["single", "2026-03-01"], ["other", "2026-06-01"]]
  );
  assert.equal(spotify.releaseDateValue("2026-09"), "2026-09-01");
});
