use rusqlite::Connection;
use std::fs;
use tokio::sync::Mutex;
use tauri::Manager;

pub struct DbState(pub Mutex<Connection>);

pub fn init_database(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&app_dir)?;

    let db_path = app_dir.join("ebubfy.db");
    let conn = Connection::open(&db_path)?;

    // Enable foreign keys + WAL for better concurrency.
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS playlist_songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
            video_id TEXT NOT NULL,
            title TEXT NOT NULL,
            artist TEXT,
            thumbnail TEXT,
            position INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS favorites (
            video_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            artist TEXT,
            thumbnail TEXT,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS recently_played (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            video_id TEXT NOT NULL,
            title TEXT NOT NULL,
            artist TEXT,
            thumbnail TEXT,
            played_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS user_preferences (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- Search history (last N queries)
        CREATE TABLE IF NOT EXISTS search_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query TEXT NOT NULL,
            result_count INTEGER NOT NULL DEFAULT 0,
            searched_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_search_history_time
            ON search_history(searched_at DESC);

        -- Search cache: stores the (yt-dlp) results for a query so repeat
        -- searches return instantly. FTS5 enables fast prefix / token search
        -- across the cached titles + artists.
        CREATE TABLE IF NOT EXISTS search_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query TEXT NOT NULL UNIQUE,
            result_json TEXT NOT NULL,
            result_count INTEGER NOT NULL,
            cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS search_cache_fts USING fts5(
            query,
            content='search_cache',
            content_rowid='id',
            tokenize='unicode61'
        );
        ",
    )?;

    // Populate FTS index from existing cache rows (no-op on a fresh install,
    // but keeps the index in sync on app upgrades).
    let _ = conn.execute(
        "INSERT INTO search_cache_fts(rowid, query) \
         SELECT id, query FROM search_cache \
         WHERE id NOT IN (SELECT rowid FROM search_cache_fts)",
        [],
    );

    app.manage(DbState(Mutex::new(conn)));

    Ok(())
}
