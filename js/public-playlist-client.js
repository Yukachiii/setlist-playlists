(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PublicPlaylistClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_BUSY_RETRIES = 3;

  function browserWindow() {
    if (typeof window === "undefined") throw new Error("ブラウザでのみ利用できます。");
    return window;
  }

  function apiBaseUrl() {
    const appWindow = browserWindow();
    const override = String(appWindow.SETLIST_PLAYLIST_API_URL || "").trim();
    const configured = String(
      appWindow.document?.querySelector?.('meta[name="setlist-playlist-api"]')?.content || ""
    ).trim();
    return (override || configured).replace(/\/+$/, "");
  }

  function isConfigured() {
    const url = apiBaseUrl();
    return /^https:\/\//.test(url) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function requestPlaylist({ eventPath, performanceId }, attempt = 0) {
    const baseUrl = apiBaseUrl();
    if (!isConfigured()) throw new Error("プレイリスト作成機能は現在準備中です。");
    if (!/^[a-z0-9-]+\/[a-z0-9-]+\.json$/.test(String(eventPath || ""))) {
      throw new Error("この公演はGitHubへ公開してからプレイリストを作成できます。");
    }
    if (!String(performanceId || "").trim()) throw new Error("公演IDがありません。");

    const response = await fetch(`${baseUrl}/v1/playlists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventPath, performanceId })
    });
    const body = await response.json().catch(() => ({}));

    if (response.status === 409 && body.code === "playlist_busy" && attempt < MAX_BUSY_RETRIES) {
      const retryAfter = Math.max(1, Number(response.headers?.get?.("Retry-After") || 3));
      await wait(retryAfter * 1000);
      return requestPlaylist({ eventPath, performanceId }, attempt + 1);
    }
    if (!response.ok) throw new Error(body.error || "プレイリストを作成できませんでした。");
    if (!/^https:\/\/open\.spotify\.com\/playlist\//.test(String(body.playlistUrl || ""))) {
      throw new Error("SpotifyのプレイリストURLを取得できませんでした。");
    }
    return body;
  }

  return { apiBaseUrl, isConfigured, requestPlaylist };
});
