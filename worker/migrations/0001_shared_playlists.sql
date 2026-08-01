CREATE TABLE IF NOT EXISTS shared_playlists (
  playlist_key TEXT PRIMARY KEY,
  event_path TEXT NOT NULL,
  event_id TEXT NOT NULL,
  performance_id TEXT NOT NULL,
  playlist_name TEXT NOT NULL,
  playlist_id TEXT,
  playlist_url TEXT,
  track_fingerprint TEXT NOT NULL,
  track_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('creating', 'ready', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
