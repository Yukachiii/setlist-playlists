(() => {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const isSpotifyCallback = params.has("code") || params.has("error");
  const hasAdminRequest = Boolean(sessionStorage.getItem("setlist_spotify_pkce_v01"));
  if (!isSpotifyCallback || !hasAdminRequest || !window.SpotifyClient) return;

  window.__adminSpotifyCallback = true;
  window.SpotifyClient.initialize()
    .then(() => {
      window.location.replace(new URL("./admin/", window.location.href).toString());
    })
    .catch((error) => {
      sessionStorage.setItem(
        "setlist_admin_spotify_callback_error_v01",
        error?.message || "Spotify接続を完了できませんでした。"
      );
      window.location.replace(new URL("./admin/", window.location.href).toString());
    });
})();
