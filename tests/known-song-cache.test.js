const test = require("node:test");
const assert = require("node:assert/strict");

const cache = require("../admin/js/known-song-cache.js");

function song({ title, version = null, artist = "", trackId = null }) {
  return {
    recording: { baseTitle: title, versionLabel: version, displayTitle: title },
    artistHint: artist,
    spotify: {
      status: trackId ? "matched" : "unmatched",
      trackId,
      uri: trackId ? `spotify:track:${trackId}` : null,
      matchedTitle: trackId ? title : null,
      matchedArtist: trackId ? artist : null
    }
  };
}

function eventsWith(...songs) {
  return [{ performances: [{ setlist: songs }] }];
}

test("登録済みの同名・同バージョン曲からSpotify情報を再利用する", () => {
  const index = cache.buildKnownSongIndex(eventsWith(
    song({ title: "AWOKE", artist: "DOLLCHESTRA", trackId: "track-a" })
  ));
  const known = cache.findKnownSong(index, "AWOKE", "");

  assert.equal(known.track.id, "track-a");
  assert.equal(known.artist, "DOLLCHESTRA");
});

test("同名曲に異なるTrack IDが保存されていれば自動適用しない", () => {
  const index = cache.buildKnownSongIndex(eventsWith(
    song({ title: "同じ曲", artist: "Solo", trackId: "solo" }),
    song({ title: "同じ曲", artist: "Group", trackId: "group" })
  ));
  const known = cache.findKnownSong(index, "同じ曲", "");

  assert.equal(known.track, null);
  assert.equal(known.trackConflict, true);
  assert.equal(known.artist, "");
});

test("Track IDがなくてもアーティスト名が一意なら補完できる", () => {
  const index = cache.buildKnownSongIndex(eventsWith(
    song({ title: "スケイプゴート", artist: "DOLLCHESTRA" })
  ));
  const known = cache.findKnownSong(index, "スケイプゴート", "");

  assert.equal(known.track, null);
  assert.equal(known.artist, "DOLLCHESTRA");
});

test("同じ曲名でもバージョンが違えば再利用しない", () => {
  const index = cache.buildKnownSongIndex(eventsWith(
    song({ title: "AWOKE", version: "104期 Ver.", artist: "DOLLCHESTRA", trackId: "version" })
  ));
  const known = cache.findKnownSong(index, "AWOKE", "");

  assert.equal(known.found, false);
});

test("バージョン表記が違っても同じTrack IDだけなら曲名単位で再利用できる", () => {
  const index = cache.buildKnownSongIndex(eventsWith(
    song({ title: "青春の輪郭", version: null, artist: "DOLLCHESTRA", trackId: "same-track" }),
    song({ title: "青春の輪郭", version: "104期 Ver.", artist: "DOLLCHESTRA", trackId: "same-track" })
  ));
  const known = cache.findKnownSongByTitle(index, "青春の輪郭");

  assert.equal(known.track.id, "same-track");
  assert.equal(known.trackConflict, false);
});

test("バージョンごとにTrack IDが異なる曲は曲名単位で自動適用しない", () => {
  const index = cache.buildKnownSongIndex(eventsWith(
    song({ title: "AWOKE", version: null, artist: "DOLLCHESTRA", trackId: "original" }),
    song({ title: "AWOKE", version: "104期 Ver.", artist: "DOLLCHESTRA", trackId: "104-version" })
  ));
  const known = cache.findKnownSongByTitle(index, "AWOKE");

  assert.equal(known.track, null);
  assert.equal(known.trackConflict, true);
});
