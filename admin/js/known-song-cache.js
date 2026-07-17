(function (root, factory) {
  // Reuses confirmed tracks from previously registered performances.
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KnownSongCache = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeComparable(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, "");
  }

  function songKey(title, version) {
    return `${normalizeComparable(title)}::${normalizeComparable(version)}`;
  }

  function emptyEntry() {
    return { tracks: new Map(), artists: new Map() };
  }

  function addSong(entry, item) {
    const spotify = item.spotify || {};
    const artist = String(spotify.matchedArtist || item.artistHint || "").trim();
    if (artist) entry.artists.set(normalizeComparable(artist), artist);

    const identity = spotify.trackId || spotify.uri;
    if (!identity) return;
    const existing = entry.tracks.get(identity) || {};
    entry.tracks.set(identity, {
      id: spotify.trackId || existing.id || null,
      uri: spotify.uri || existing.uri || null,
      name: spotify.matchedTitle || existing.name || item.recording?.displayTitle || item.recording?.baseTitle || "",
      artist: artist || existing.artist || "",
      artworkUrl: spotify.artworkUrl || existing.artworkUrl || "",
      albumName: spotify.albumName || existing.albumName || ""
    });
  }

  function buildKnownSongIndex(events) {
    const index = new Map();
    const titleIndex = new Map();
    for (const event of events || []) {
      for (const performance of event.performances || []) {
        for (const item of performance.setlist || []) {
          const title = item.recording?.baseTitle || item.title || "";
          if (!normalizeComparable(title)) continue;
          const version = item.recording?.versionLabel || item.version || "";
          const key = songKey(title, version);
          const entry = index.get(key) || emptyEntry();
          addSong(entry, item);
          index.set(key, entry);

          const normalizedTitle = normalizeComparable(title);
          const titleEntry = titleIndex.get(normalizedTitle) || emptyEntry();
          addSong(titleEntry, item);
          titleIndex.set(normalizedTitle, titleEntry);
        }
      }
    }
    index.titleIndex = titleIndex;
    return index;
  }

  function resolveEntry(entry) {
    if (!entry) {
      return {
        found: false,
        track: null,
        artist: "",
        trackConflict: false,
        artistConflict: false
      };
    }

    const tracks = [...entry.tracks.values()];
    const artists = [...entry.artists.values()];
    const artist = artists.length === 1 ? artists[0] : "";
    const cachedTrack = tracks.length === 1 ? tracks[0] : null;
    const trackArtist = cachedTrack?.artist || artist;
    const track = cachedTrack
      ? {
          id: cachedTrack.id,
          uri: cachedTrack.uri,
          name: cachedTrack.name,
          artists: trackArtist ? [{ name: trackArtist }] : [],
          album: cachedTrack.artworkUrl || cachedTrack.albumName
            ? {
                name: cachedTrack.albumName,
                images: cachedTrack.artworkUrl ? [{ url: cachedTrack.artworkUrl }] : []
              }
            : null
        }
      : null;

    return {
      found: true,
      track,
      artist: trackArtist || artist,
      trackConflict: tracks.length > 1,
      artistConflict: artists.length > 1
    };
  }

  function findKnownSong(index, title, version) {
    return resolveEntry(index.get(songKey(title, version)));
  }

  function findKnownSongByTitle(index, title) {
    return resolveEntry(index.titleIndex?.get(normalizeComparable(title)));
  }

  return {
    normalizeComparable,
    songKey,
    buildKnownSongIndex,
    findKnownSong,
    findKnownSongByTitle
  };
});
