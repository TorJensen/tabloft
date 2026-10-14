import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

export function openDb(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'tabmind.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      domain TEXT NOT NULL DEFAULT '',
      favicon_url TEXT,
      og_image TEXT,
      description TEXT,
      browser TEXT,
      status TEXT NOT NULL DEFAULT 'inbox',          -- inbox | kept | archived
      collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
      note TEXT NOT NULL DEFAULT '',
      starred INTEGER NOT NULL DEFAULT 0,
      snapshot TEXT,                                  -- filename of .mhtml in data/snapshots
      screenshot TEXT,                                -- filename of .jpg in data/screens
      text_len INTEGER NOT NULL DEFAULT 0,
      save_count INTEGER NOT NULL DEFAULT 1,
      saved_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      opened_at TEXT
    );
    CREATE INDEX IF NOT EXISTS items_status ON items(status, saved_at);
    CREATE INDEX IF NOT EXISTS items_collection ON items(collection_id);

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE
    );
    CREATE TABLE IF NOT EXISTS item_tags (
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, tag_id)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      title, url, description, note, tags, body,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
  return db;
}

// Turn free text into a safe FTS5 query: every word must match as a prefix.
export function ftsQuery(q) {
  const words = String(q).match(/[\p{L}\p{N}_]+/gu) || [];
  return words.map(w => `"${w}"*`).join(' AND ');
}
