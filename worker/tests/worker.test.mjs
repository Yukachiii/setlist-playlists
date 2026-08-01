import test from "node:test";
import assert from "node:assert/strict";

import {
  chunkItems,
  extractPlaylistSpec,
  handleRequest,
  playlistFingerprint,
  validEventPath
} from "../src/index.js";

const eventPath = "hasunosora/example-live.json";
const performanceId = "example-live-day-1";
const firstUri = "spotify:track:0000000000000000000001";
const secondUri = "spotify:track:0000000000000000000002";

function eventDocument() {
  return {
    id: "example-live",
    title: "Example Live",
    performances: [
      {
        id: performanceId,
        label: "Day 1",
        setlist: [
          { type: "song", spotify: { status: "matched", uri: firstUri } },
          { type: "song", spotify: { status: "matched", uri: firstUri } },
          {
            type: "song",
            spotifyMatchPolicy: "unavailable",
            spotify: { status: "unavailable", uri: secondUri }
          },
          { type: "song", spotify: { status: "matched", uri: secondUri } }
        ]
      }
    ]
  };
}

class MemoryD1 {
  constructor(row = null) {
    this.row = row;
  }

  prepare(sql) {
    const database = this;
    return {
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async first() {
        if (!/SELECT[\s\S]+FROM shared_playlists/.test(sql)) throw new Error(`Unexpected first(): ${sql}`);
        return database.row ? { ...database.row } : null;
      },
      async run() {
        if (/INSERT OR IGNORE INTO shared_playlists/.test(sql)) {
          if (database.row) return { meta: { changes: 0 } };
          const [key, path, eventId, currentPerformanceId, name, fingerprint, count, now] = this.args;
          database.row = {
            playlist_key: key,
            event_path: path,
            event_id: eventId,
            performance_id: currentPerformanceId,
            playlist_name: name,
            playlist_id: null,
            playlist_url: null,
            track_fingerprint: fingerprint,
            track_count: count,
            status: "creating",
            error: null,
            created_at: now,
            updated_at: now
          };
          return { meta: { changes: 1 } };
        }
        if (/SET playlist_id = \?1, playlist_url = \?2, updated_at/.test(sql)) {
          database.row.playlist_id = this.args[0];
          database.row.playlist_url = this.args[1];
          database.row.updated_at = this.args[2];
          return { meta: { changes: 1 } };
        }
        if (/status = 'ready'/.test(sql)) {
          database.row.playlist_id = this.args[0];
          database.row.playlist_url = this.args[1];
          database.row.status = "ready";
          database.row.error = null;
          database.row.updated_at = this.args[2];
          return { meta: { changes: 1 } };
        }
        if (/status = 'failed'/.test(sql)) {
          database.row.status = "failed";
          database.row.error = this.args[0];
          database.row.updated_at = this.args[1];
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unexpected run(): ${sql}`);
      }
    };
  }
}

function workerEnv(database) {
  return {
    DB: database,
    ALLOWED_ORIGINS: "https://example.github.io,http://127.0.0.1:8765",
    PUBLIC_DATA_BASE_URL: "https://example.github.io/data/",
    SPOTIFY_CLIENT_ID: "client-id",
    SPOTIFY_REFRESH_TOKEN: "refresh-token"
  };
}

test("公開データ配下のJSONパスだけを許可する", () => {
  assert.equal(validEventPath("hasunosora/live.json"), true);
  assert.equal(validEventPath("../admin.json"), false);
  assert.equal(validEventPath("https://attacker.example/live.json"), false);
  assert.equal(validEventPath("hasunosora/live.txt"), false);
});

test("Spotify曲の曲順と重複を保ち、未配信曲を除外する", () => {
  const spec = extractPlaylistSpec(eventDocument(), eventPath, performanceId);
  assert.deepEqual(spec.uris, [firstUri, firstUri, secondUri]);
  assert.equal(spec.key, "example-live:example-live-day-1");
  assert.equal(spec.name, "Example Live — Day 1");
});

test("100曲ごとにSpotify追加リクエストを分割する", () => {
  assert.deepEqual(chunkItems(Array.from({ length: 205 }), 100).map((items) => items.length), [100, 100, 5]);
});

test("曲順が変わるとプレイリスト指紋も変わる", async () => {
  const spec = extractPlaylistSpec(eventDocument(), eventPath, performanceId);
  const reversed = { ...spec, uris: [...spec.uris].reverse() };
  assert.notEqual(await playlistFingerprint(spec), await playlistFingerprint(reversed));
});

test("未作成の公演は作成用アカウントで一度だけ作りURLを保存する", async () => {
  const database = new MemoryD1();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith(`/${eventPath}`)) {
      return { ok: true, json: async () => eventDocument() };
    }
    if (String(url).endsWith("/api/token")) {
      return { ok: true, json: async () => ({ access_token: "access-token" }) };
    }
    if (String(url).endsWith("/me/playlists")) {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: "playlist-id",
          external_urls: { spotify: "https://open.spotify.com/playlist/playlist-id" }
        })
      };
    }
    if (String(url).endsWith("/playlists/playlist-id/items")) {
      return { ok: true, status: 201, json: async () => ({ snapshot_id: "snapshot" }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const request = new Request("https://worker.example/v1/playlists", {
    method: "POST",
    headers: { Origin: "https://example.github.io", "Content-Type": "application/json" },
    body: JSON.stringify({ eventPath, performanceId })
  });

  const response = await handleRequest(request, workerEnv(database), fetchImpl);
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.created, true);
  assert.equal(body.playlistUrl, "https://open.spotify.com/playlist/playlist-id");
  assert.equal(database.row.status, "ready");
  assert.equal(database.row.track_count, 3);
  const createCall = calls.find((call) => call.url.endsWith("/me/playlists"));
  assert.equal(JSON.parse(createCall.options.body).public, false);
  const addCall = calls.find((call) => call.url.endsWith("/playlists/playlist-id/items"));
  assert.deepEqual(JSON.parse(addCall.options.body).uris, [firstUri, firstUri, secondUri]);
});

test("作成済みで内容が同じ公演はSpotifyを呼ばず既存URLを返す", async () => {
  const spec = extractPlaylistSpec(eventDocument(), eventPath, performanceId);
  const database = new MemoryD1({
    playlist_key: spec.key,
    event_path: eventPath,
    event_id: spec.eventId,
    performance_id: performanceId,
    playlist_name: spec.name,
    playlist_id: "existing-id",
    playlist_url: "https://open.spotify.com/playlist/existing-id",
    track_fingerprint: await playlistFingerprint(spec),
    track_count: spec.uris.length,
    status: "ready",
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith(`/${eventPath}`)) {
      return { ok: true, json: async () => eventDocument() };
    }
    throw new Error("Spotify should not be called");
  };
  const request = new Request("https://worker.example/v1/playlists", {
    method: "POST",
    headers: { Origin: "https://example.github.io", "Content-Type": "application/json" },
    body: JSON.stringify({ eventPath, performanceId })
  });

  const response = await handleRequest(request, workerEnv(database), fetchImpl);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.created, false);
  assert.equal(body.playlistUrl, "https://open.spotify.com/playlist/existing-id");
  assert.deepEqual(calls, [`https://example.github.io/data/${eventPath}`]);
});

test("許可していないサイトからの作成要求を拒否する", async () => {
  const request = new Request("https://worker.example/v1/playlists", {
    method: "POST",
    headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
    body: JSON.stringify({ eventPath, performanceId })
  });
  const response = await handleRequest(request, workerEnv(new MemoryD1()), async () => {
    throw new Error("fetch should not be called");
  });
  assert.equal(response.status, 403);
});
