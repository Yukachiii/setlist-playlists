const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";
const SOUNDIIZ_IMPORT_URL = "https://soundiiz.com/go/import-playlist";
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_REQUEST_BYTES = 4096;

class RequestError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class SpotifyError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SpotifyError";
    this.status = status;
  }
}

class SoundiizError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SoundiizError";
    this.status = status;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

export function chunkItems(items, size = 100) {
  const safeSize = Math.max(1, Math.floor(Number(size) || 100));
  const chunks = [];
  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }
  return chunks;
}

export function validEventPath(value) {
  return /^[a-z0-9-]+\/[a-z0-9-]+\.json$/.test(text(value));
}

function validPerformanceId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(text(value));
}

function spotifyUnavailable(item) {
  return item?.spotifyMatchPolicy === "unavailable" ||
    item?.spotify?.status === "unavailable" ||
    item?.spotify?.status === "skipped";
}

function validSpotifyUri(item) {
  return !spotifyUnavailable(item) &&
    /^spotify:track:[A-Za-z0-9]{22}$/.test(text(item?.spotify?.uri));
}

function performanceLabel(performance, index = 0) {
  return text(performance?.label) ||
    (performance?.day ? `Day ${performance.day}` : `公演 ${index + 1}`);
}

function loadedEvents(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.events) && value.events.every((item) => typeof item === "object")) {
    return value.events;
  }
  return value?.id ? [value] : [];
}

export function extractPlaylistSpec(documentValue, eventPath, performanceId) {
  if (!validEventPath(eventPath)) {
    throw new RequestError(400, "invalid_event_path", "公演データの指定が不正です。");
  }
  if (!validPerformanceId(performanceId)) {
    throw new RequestError(400, "invalid_performance_id", "公演IDの指定が不正です。");
  }

  const candidates = loadedEvents(documentValue);
  const event = candidates.find((item) =>
    Array.isArray(item?.performances) && item.performances.some((performance) => performance?.id === performanceId)
  );
  if (!event?.id || !event?.title) {
    throw new RequestError(404, "event_not_found", "指定された公演データが見つかりません。");
  }

  const performanceIndex = event.performances.findIndex((item) => item?.id === performanceId);
  const performance = event.performances[performanceIndex];
  const songs = (Array.isArray(performance?.setlist) ? performance.setlist : [])
    .filter((item) => !item?.type || item.type === "song");
  const availableSongs = songs.filter(validSpotifyUri);
  const uris = availableSongs.map((item) => text(item.spotify.uri));
  if (!uris.length) {
    throw new RequestError(422, "no_available_tracks", "Spotifyへ追加できる曲がありません。");
  }

  const name = `${text(event.title)} — ${performanceLabel(performance, performanceIndex)}`.slice(0, 100);
  return {
    key: `${text(event.id)}:${text(performance.id)}`,
    eventPath: text(eventPath),
    eventId: text(event.id),
    performanceId: text(performance.id),
    name,
    description: "Setlist Playlistsで作成したライブセットリスト（共有用）".slice(0, 300),
    uris,
    tracks: availableSongs.map((item) => ({
      title: text(item?.spotify?.matchedTitle) ||
        text(item?.recording?.displayTitle) ||
        text(item?.recording?.baseTitle),
      artists: text(item?.spotify?.matchedArtist) || text(item?.artistHint)
    }))
  };
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function playlistFingerprint(spec) {
  return sha256(JSON.stringify({ name: spec.name, uris: spec.uris }));
}

function allowedOrigins(env) {
  return text(env.ALLOWED_ORIGINS)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsOrigin(request, env) {
  const origin = text(request.headers.get("Origin"));
  return origin && allowedOrigins(env).includes(origin) ? origin : "";
}

function responseHeaders(origin = "", extra = {}) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
    headers.set("Vary", "Origin");
  }
  return headers;
}

function json(body, status = 200, origin = "", extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(origin, extraHeaders)
  });
}

function databaseChanges(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

async function findPlaylist(env, key) {
  return env.DB.prepare(
    `SELECT playlist_key, event_path, event_id, performance_id, playlist_name,
            playlist_id, playlist_url, track_fingerprint, track_count,
            status, error, created_at, updated_at
       FROM shared_playlists
      WHERE playlist_key = ?1`
  ).bind(key).first();
}

async function claimPlaylist(env, spec, fingerprint, now = new Date()) {
  const nowIso = now.toISOString();
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO shared_playlists (
       playlist_key, event_path, event_id, performance_id, playlist_name,
       track_fingerprint, track_count, status, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'creating', ?8, ?8)`
  ).bind(
    spec.key,
    spec.eventPath,
    spec.eventId,
    spec.performanceId,
    spec.name,
    fingerprint,
    spec.uris.length,
    nowIso
  ).run();

  if (databaseChanges(inserted) > 0) {
    return { claimed: true, row: await findPlaylist(env, spec.key) };
  }

  const existing = await findPlaylist(env, spec.key);
  if (!existing) {
    throw new RequestError(503, "database_conflict", "作成状態を確認できませんでした。もう一度お試しください。");
  }
  if (existing.status === "ready" &&
      existing.track_fingerprint === fingerprint &&
      text(existing.playlist_url)) {
    return { claimed: false, ready: true, row: existing };
  }

  const updatedAt = Date.parse(existing.updated_at || "");
  const claimIsFresh = existing.status === "creating" &&
    Number.isFinite(updatedAt) && now.getTime() - updatedAt < CLAIM_TIMEOUT_MS;
  if (claimIsFresh) return { claimed: false, busy: true, row: existing };

  const updated = await env.DB.prepare(
    `UPDATE shared_playlists
        SET event_path = ?1,
            event_id = ?2,
            performance_id = ?3,
            playlist_name = ?4,
            track_fingerprint = ?5,
            track_count = ?6,
            status = 'creating',
            error = NULL,
            updated_at = ?7
      WHERE playlist_key = ?8 AND updated_at = ?9`
  ).bind(
    spec.eventPath,
    spec.eventId,
    spec.performanceId,
    spec.name,
    fingerprint,
    spec.uris.length,
    nowIso,
    spec.key,
    existing.updated_at
  ).run();

  if (databaseChanges(updated) === 0) {
    return { claimed: false, busy: true, row: await findPlaylist(env, spec.key) };
  }
  return { claimed: true, row: await findPlaylist(env, spec.key) };
}

async function markAllocated(env, key, playlistId, playlistUrl) {
  await env.DB.prepare(
    `UPDATE shared_playlists
        SET playlist_id = ?1, playlist_url = ?2, updated_at = ?3
      WHERE playlist_key = ?4 AND status = 'creating'`
  ).bind(playlistId, playlistUrl, new Date().toISOString(), key).run();
}

async function markReady(env, key, playlistId, playlistUrl) {
  await env.DB.prepare(
    `UPDATE shared_playlists
        SET playlist_id = ?1,
            playlist_url = ?2,
            status = 'ready',
            error = NULL,
            updated_at = ?3
      WHERE playlist_key = ?4`
  ).bind(playlistId, playlistUrl, new Date().toISOString(), key).run();
}

async function markFailed(env, key, error) {
  await env.DB.prepare(
    `UPDATE shared_playlists
        SET status = 'failed', error = ?1, updated_at = ?2
      WHERE playlist_key = ?3`
  ).bind(text(error?.message || error).slice(0, 500), new Date().toISOString(), key).run();
}

async function fetchEventDocument(eventPath, env, fetchImpl) {
  const base = text(env.PUBLIC_DATA_BASE_URL);
  if (!base) throw new RequestError(503, "worker_not_configured", "公演データの取得先が設定されていません。");
  const url = new URL(eventPath, base.endsWith("/") ? base : `${base}/`);
  const response = await fetchImpl(url.toString(), {
    headers: { Accept: "application/json" },
    cf: { cacheEverything: true, cacheTtl: 300 }
  });
  if (!response.ok) {
    throw new RequestError(404, "event_data_unavailable", "公演データを取得できませんでした。");
  }
  return response.json();
}

function validSoundiizShareUrl(value) {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" &&
      url.hostname === "soundiiz.com" &&
      /^\/go\/import-playlist\/[A-Za-z0-9_-]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

export async function createSoundiizImport(spec, fetchImpl) {
  const tracklist = (Array.isArray(spec?.tracks) ? spec.tracks : [])
    .map((track) => ({
      title: text(track?.title),
      ...(text(track?.artists) ? { artists: text(track.artists) } : {})
    }))
    .filter((track) => track.title);

  if (!tracklist.length) {
    throw new RequestError(422, "no_transferable_tracks", "移行できる曲名がありません。");
  }
  if (tracklist.length > 200) {
    throw new RequestError(422, "soundiiz_track_limit", "Soundiizへ一度に送信できるのは200曲までです。");
  }

  const response = await fetchImpl(SOUNDIIZ_IMPORT_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: spec.name,
      sourceName: "Setlist Playlists",
      description: spec.description,
      tracklist
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status !== "success" || !validSoundiizShareUrl(body.shareUrl)) {
    throw new SoundiizError(
      response.status,
      text(body.message || body.error) || "Soundiizの移行画面を用意できませんでした。"
    );
  }

  return {
    shareUrl: text(body.shareUrl),
    expiresAt: body.expiresAt ?? null,
    trackCount: Number(body.nbTracks) || tracklist.length
  };
}

async function spotifyAccessToken(env, fetchImpl) {
  if (!text(env.SPOTIFY_CLIENT_ID) || !text(env.SPOTIFY_REFRESH_TOKEN)) {
    throw new RequestError(503, "spotify_not_configured", "Spotify作成用アカウントがまだ設定されていません。");
  }
  const response = await fetchImpl(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env.SPOTIFY_REFRESH_TOKEN,
      client_id: env.SPOTIFY_CLIENT_ID
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    const message = body.error === "invalid_grant"
      ? "Spotify作成用アカウントの再認証が必要です。"
      : "Spotify作成用アカウントへ接続できませんでした。";
    throw new RequestError(503, "spotify_auth_failed", message);
  }
  return body.access_token;
}

async function spotifyRequest(path, accessToken, fetchImpl, options = {}) {
  const response = await fetchImpl(`${SPOTIFY_API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${accessToken}`
    }
  });
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status === 429
      ? "Spotifyの利用回数制限に達しました。少し待ってからお試しください。"
      : body.error?.message || "Spotify APIの呼び出しに失敗しました。";
    throw new SpotifyError(response.status, message);
  }
  return body;
}

async function createSpotifyPlaylist(spec, accessToken, fetchImpl, onAllocated) {
  const playlist = await spotifyRequest("/me/playlists", accessToken, fetchImpl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: spec.name,
      public: false,
      description: spec.description
    })
  });
  const playlistId = text(playlist.id);
  const playlistUrl = text(playlist.external_urls?.spotify) ||
    (playlistId ? `https://open.spotify.com/playlist/${playlistId}` : "");
  if (!playlistId || !playlistUrl) {
    throw new SpotifyError(502, "Spotifyからプレイリスト情報を取得できませんでした。");
  }

  await onAllocated(playlistId, playlistUrl);
  for (const chunk of chunkItems(spec.uris, 100)) {
    await spotifyRequest(`/playlists/${encodeURIComponent(playlistId)}/items`, accessToken, fetchImpl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: chunk })
    });
  }
  return { playlistId, playlistUrl };
}

async function updateSpotifyPlaylist(spec, playlistId, playlistUrl, accessToken, fetchImpl) {
  await spotifyRequest(`/playlists/${encodeURIComponent(playlistId)}`, accessToken, fetchImpl, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: spec.name, public: false, description: spec.description })
  });

  const chunks = chunkItems(spec.uris, 100);
  await spotifyRequest(`/playlists/${encodeURIComponent(playlistId)}/items`, accessToken, fetchImpl, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uris: chunks[0] })
  });
  for (const chunk of chunks.slice(1)) {
    await spotifyRequest(`/playlists/${encodeURIComponent(playlistId)}/items`, accessToken, fetchImpl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: chunk })
    });
  }
  return {
    playlistId,
    playlistUrl: text(playlistUrl) || `https://open.spotify.com/playlist/${playlistId}`
  };
}

async function syncSpotifyPlaylist(spec, existing, env, fetchImpl) {
  const accessToken = await spotifyAccessToken(env, fetchImpl);
  const existingId = text(existing?.playlist_id);
  if (existingId) {
    try {
      return await updateSpotifyPlaylist(
        spec,
        existingId,
        existing?.playlist_url,
        accessToken,
        fetchImpl
      );
    } catch (error) {
      if (!(error instanceof SpotifyError) || error.status !== 404) throw error;
    }
  }
  return createSpotifyPlaylist(
    spec,
    accessToken,
    fetchImpl,
    (playlistId, playlistUrl) => markAllocated(env, spec.key, playlistId, playlistUrl)
  );
}

async function parseRequest(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_REQUEST_BYTES) {
    throw new RequestError(413, "request_too_large", "リクエストが大きすぎます。");
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw new RequestError(400, "invalid_json", "リクエストの形式が不正です。");
  }
  return {
    eventPath: text(body.eventPath),
    performanceId: text(body.performanceId)
  };
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  const origin = corsOrigin(request, env);
  const apiPaths = new Set(["/v1/playlists", "/v1/transfers/soundiiz"]);

  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "setlist-playlist-api" });
  }
  if (request.method === "OPTIONS" && apiPaths.has(url.pathname)) {
    if (!origin) return json({ error: "許可されていないアクセス元です。" }, 403);
    return new Response(null, { status: 204, headers: responseHeaders(origin) });
  }
  if (request.method !== "POST" || !apiPaths.has(url.pathname)) {
    return json({ error: "Not Found" }, 404, origin);
  }
  if (!origin) {
    return json({ error: "許可されていないアクセス元です。", code: "origin_not_allowed" }, 403);
  }

  if (url.pathname === "/v1/transfers/soundiiz") {
    try {
      const input = await parseRequest(request);
      const eventDocument = await fetchEventDocument(input.eventPath, env, fetchImpl);
      const spec = extractPlaylistSpec(eventDocument, input.eventPath, input.performanceId);
      const transfer = await createSoundiizImport(spec, fetchImpl);
      return json({ ok: true, ...transfer }, 201, origin);
    } catch (error) {
      if (error instanceof RequestError) {
        return json({ ok: false, code: error.code, error: error.message, ...error.details }, error.status, origin);
      }
      if (error instanceof SoundiizError) {
        const status = error.status === 429 ? 503 : 502;
        return json({ ok: false, code: "soundiiz_error", error: error.message }, status, origin);
      }
      console.error("Soundiiz transfer request failed", error?.stack || error);
      return json({ ok: false, code: "internal_error", error: "Soundiizの移行画面を用意できませんでした。" }, 500, origin);
    }
  }

  if (!env.DB) {
    return json({ error: "プレイリスト保存先が設定されていません。", code: "database_not_configured" }, 503, origin);
  }

  let spec;
  try {
    const input = await parseRequest(request);
    const eventDocument = await fetchEventDocument(input.eventPath, env, fetchImpl);
    spec = extractPlaylistSpec(eventDocument, input.eventPath, input.performanceId);
    const fingerprint = await playlistFingerprint(spec);
    const claim = await claimPlaylist(env, spec, fingerprint);

    if (claim.ready) {
      return json({
        ok: true,
        created: false,
        playlistUrl: claim.row.playlist_url,
        trackCount: Number(claim.row.track_count || spec.uris.length)
      }, 200, origin);
    }
    if (!claim.claimed) {
      return json({
        ok: false,
        code: "playlist_busy",
        error: "この公演のプレイリストを作成中です。少し待ってからもう一度お試しください。"
      }, 409, origin, { "Retry-After": "3" });
    }

    const synced = await syncSpotifyPlaylist(spec, claim.row, env, fetchImpl);
    await markReady(env, spec.key, synced.playlistId, synced.playlistUrl);
    return json({
      ok: true,
      created: !text(claim.row?.playlist_id),
      playlistUrl: synced.playlistUrl,
      trackCount: spec.uris.length
    }, 201, origin);
  } catch (error) {
    if (spec?.key) await markFailed(env, spec.key, error).catch(() => {});
    if (error instanceof RequestError) {
      return json({ ok: false, code: error.code, error: error.message, ...error.details }, error.status, origin);
    }
    if (error instanceof SpotifyError) {
      const status = error.status === 429 ? 503 : 502;
      return json({ ok: false, code: "spotify_error", error: error.message }, status, origin);
    }
    console.error("playlist request failed", error?.stack || error);
    return json({ ok: false, code: "internal_error", error: "プレイリストを作成できませんでした。" }, 500, origin);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};
