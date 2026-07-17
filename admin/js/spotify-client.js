(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SpotifyClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CLIENT_ID = "0a891d6707d34424bae951dfa25a9d95";
  const AUTH_URL = "https://accounts.spotify.com/authorize";
  const TOKEN_URL = "https://accounts.spotify.com/api/token";
  const API_URL = "https://api.spotify.com/v1";
  const SCOPES = "user-read-private";
  const AUTH_STORAGE_KEY = "setlist_spotify_auth_v01";
  const PKCE_STORAGE_KEY = "setlist_spotify_pkce_v01";

  function browserWindow() {
    if (typeof window === "undefined") throw new Error("ブラウザでのみ利用できます。");
    return window;
  }

  function readJson(storage, key) {
    try {
      return JSON.parse(storage.getItem(key) || "null");
    } catch (_error) {
      return null;
    }
  }

  function redirectUri() {
    const appWindow = browserWindow();
    const url = new URL(appWindow.location.href);
    let pathname = url.pathname
      .replace(/\/admin\/index\.html$/, "/")
      .replace(/\/admin\/$/, "/");
    if (pathname.endsWith("/index.html")) pathname = pathname.slice(0, -"index.html".length);
    else if (!pathname.endsWith("/")) pathname += "/";
    return url.origin + pathname;
  }

  function randomString(length) {
    const bytes = new Uint8Array(length);
    browserWindow().crypto.getRandomValues(bytes);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    return [...bytes].map((value) => alphabet[value % alphabet.length]).join("");
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    return browserWindow().crypto.subtle.digest("SHA-256", bytes);
  }

  function base64UrlEncode(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  }

  function storedAuth() {
    return readJson(browserWindow().sessionStorage, AUTH_STORAGE_KEY);
  }

  function saveAuth(value) {
    browserWindow().sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(value));
  }

  function clearAuth() {
    const appWindow = browserWindow();
    appWindow.sessionStorage.removeItem(AUTH_STORAGE_KEY);
    appWindow.sessionStorage.removeItem(PKCE_STORAGE_KEY);
  }

  async function connect() {
    const appWindow = browserWindow();
    const verifier = randomString(64);
    const state = randomString(32);
    const challenge = base64UrlEncode(await sha256(verifier));
    appWindow.sessionStorage.setItem(
      PKCE_STORAGE_KEY,
      JSON.stringify({ verifier, state })
    );

    const authUrl = new URL(AUTH_URL);
    authUrl.search = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: redirectUri(),
      scope: SCOPES,
      state,
      code_challenge_method: "S256",
      code_challenge: challenge
    }).toString();
    appWindow.location.assign(authUrl.toString());
  }

  async function tokenRequest(parameters) {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(parameters)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error_description || body.error || "Spotify認証に失敗しました。");
    }
    return body;
  }

  function tokenRecord(token, previous = {}) {
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || previous.refreshToken || null,
      expiresAt: Date.now() + Math.max(0, Number(token.expires_in || 3600) - 60) * 1000,
      scope: token.scope || previous.scope || "",
      profile: previous.profile || null
    };
  }

  async function exchangeAuthorizationCode(code, verifier) {
    const token = await tokenRequest({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier
    });
    const auth = tokenRecord(token);
    saveAuth(auth);
    return auth;
  }

  async function refreshAccessToken(auth) {
    if (!auth?.refreshToken) throw new Error("Spotifyへ再接続してください。");
    const token = await tokenRequest({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken
    });
    const refreshed = tokenRecord(token, auth);
    saveAuth(refreshed);
    return refreshed;
  }

  function cleanCallbackUrl() {
    const appWindow = browserWindow();
    const url = new URL(appWindow.location.href);
    ["code", "state", "error", "error_description"].forEach((name) => {
      url.searchParams.delete(name);
    });
    appWindow.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }

  async function getAccessToken() {
    let auth = storedAuth();
    if (!auth?.accessToken) throw new Error("Spotifyへ接続してください。");
    if (Date.now() >= Number(auth.expiresAt || 0)) {
      auth = await refreshAccessToken(auth);
    }
    return auth.accessToken;
  }

  async function apiFetch(path, options = {}, allowRefresh = true) {
    const token = await getAccessToken();
    const response = await fetch(API_URL + path, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: "Bearer " + token
      }
    });

    if (response.status === 401 && allowRefresh) {
      const auth = storedAuth();
      await refreshAccessToken(auth);
      return apiFetch(path, options, false);
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      throw new Error(
        "Spotifyの検索回数制限に達しました。" +
        (retryAfter ? retryAfter + "秒後に再試行してください。" : "少し待って再試行してください。")
      );
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error?.message || "Spotify APIの呼び出しに失敗しました。");
    }
    return body;
  }

  async function initialize() {
    const appWindow = browserWindow();
    const params = new URLSearchParams(appWindow.location.search);
    const authError = params.get("error");
    if (authError) {
      const description = params.get("error_description");
      cleanCallbackUrl();
      throw new Error(description || "Spotify接続がキャンセルされました。");
    }

    const code = params.get("code");
    if (code) {
      const returnedState = params.get("state");
      const pkce = readJson(appWindow.sessionStorage, PKCE_STORAGE_KEY);
      if (!pkce?.verifier || !pkce?.state || pkce.state !== returnedState) {
        cleanCallbackUrl();
        throw new Error("Spotify認証の確認情報が一致しません。もう一度接続してください。");
      }
      await exchangeAuthorizationCode(code, pkce.verifier);
      appWindow.sessionStorage.removeItem(PKCE_STORAGE_KEY);
      cleanCallbackUrl();
    }

    let auth = storedAuth();
    if (!auth?.accessToken) return { connected: false, profile: null };
    if (Date.now() >= Number(auth.expiresAt || 0)) {
      auth = await refreshAccessToken(auth);
    }
    if (!auth.profile) {
      const profile = await apiFetch("/me");
      auth = { ...storedAuth(), profile };
      saveAuth(auth);
    }
    return { connected: true, profile: auth.profile };
  }

  function disconnect() {
    clearAuth();
  }

  function isConnected() {
    return Boolean(storedAuth()?.accessToken);
  }

  function profile() {
    return storedAuth()?.profile || null;
  }

  function normalizeComparable(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, "");
  }

  function recordingIdentity(track) {
    const isrc = String(track?.external_ids?.isrc || "").trim().toUpperCase();
    if (isrc) return `isrc:${isrc}`;
    const linkedId = String(track?.linked_from?.id || "").trim();
    return linkedId ? `linked:${linkedId}` : "";
  }

  function uniqueRecordingMatch(matches) {
    if (matches.length === 1) {
      return { track: matches[0], collapsed: false };
    }
    if (matches.length < 2) return null;
    const identities = matches.map(recordingIdentity);
    if (identities.some((identity) => !identity)) return null;
    if (new Set(identities).size !== 1) return null;
    const playable = matches.find((track) => track?.is_playable !== false);
    return { track: playable || matches[0], collapsed: true };
  }

  function chooseTrackCandidate(candidates, request) {
    const uniqueCandidates = uniqueTracks(candidates);
    const desiredTitle = normalizeComparable(request.title);
    const exactMatches = uniqueCandidates.filter(
      (track) => normalizeComparable(track?.name) === desiredTitle
    );
    const desiredVersionTitle = request.version
      ? normalizeComparable(`${request.title} ${request.version}`)
      : "";
    const versionMatches = desiredVersionTitle
      ? uniqueCandidates.filter(
          (track) => normalizeComparable(track?.name) === desiredVersionTitle
        )
      : [];
    const versionRecording = uniqueRecordingMatch(versionMatches);
    const exactRecording = uniqueRecordingMatch(exactMatches);

    if (request.version) {
      if (versionRecording) {
        return {
          status: "matched",
          matchKind: "version",
          track: versionRecording.track,
          candidates: versionMatches
        };
      }
      if (versionMatches.length > 1) {
        return {
          status: "ambiguous",
          matchKind: null,
          track: null,
          candidates: versionMatches
        };
      }

      if (exactRecording) {
        return {
          status: "matched",
          matchKind: request.matchPolicy === "original_fallback"
            ? "original_fallback"
            : exactRecording.collapsed
              ? "same_recording"
              : "title_unlabeled_version",
          track: exactRecording.track,
          candidates: exactMatches
        };
      }
      if (exactMatches.length > 1) {
        return {
          status: "ambiguous",
          matchKind: null,
          track: null,
          candidates: exactMatches
        };
      }

      return {
        status: uniqueCandidates.length ? "manual" : "unmatched",
        matchKind: null,
        track: null,
        candidates: uniqueCandidates
      };
    }

    if (!exactMatches.length) {
      return { status: "unmatched", matchKind: null, track: null, candidates: [] };
    }
    if (!exactRecording) {
      return {
        status: "ambiguous",
        matchKind: null,
        track: null,
        candidates: exactMatches
      };
    }
    return {
      status: "matched",
      matchKind: exactRecording.collapsed ? "same_recording" : "title",
      track: exactRecording.track,
      candidates: exactMatches
    };
  }

  function uniqueTracks(tracks) {
    const seen = new Set();
    return (tracks || []).filter((track) => {
      const key = track?.id || track?.uri;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function searchTracks(query) {
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) return [];
    const params = new URLSearchParams({
      q: normalizedQuery,
      type: "track",
      market: "JP",
      limit: "10"
    });
    const body = await apiFetch("/search?" + params.toString());
    return uniqueTracks(body.tracks?.items || []);
  }

  async function searchBestTrack(request) {
    const results = await searchTracks(request.title);
    const result = chooseTrackCandidate(results, request);
    return { ...result, results };
  }

  return {
    CLIENT_ID,
    redirectUri,
    connect,
    disconnect,
    initialize,
    isConnected,
    profile,
    searchTracks,
    searchBestTrack,
    chooseTrackCandidate,
    uniqueTracks,
    normalizeComparable,
    recordingIdentity
  };
});
