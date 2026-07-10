use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::db;

/// Maximum number of recently_played entries to retain.
const MAX_RECENTLY_PLAYED: usize = 50;

#[derive(Debug, Serialize, Deserialize)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlaylistSong {
    pub id: i64,
    pub playlist_id: i64,
    pub video_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub thumbnail: Option<String>,
    pub position: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecentlyPlayed {
    pub video_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub thumbnail: Option<String>,
    pub played_at: String,
}

#[tauri::command]
pub async fn create_playlist(app: AppHandle, name: String) -> Result<i64, String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;
    db.execute("INSERT INTO playlists (name) VALUES (?1)", [&name])
        .map_err(|e| format!("Failed to create playlist: {}", e))?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub async fn delete_playlist(app: AppHandle, playlist_id: i64) -> Result<(), String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;
    db.execute("DELETE FROM playlists WHERE id = ?1", [playlist_id])
        .map_err(|e| format!("Failed to delete playlist: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_playlists(app: AppHandle) -> Result<Vec<Playlist>, String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;
    let mut stmt = db
        .prepare("SELECT id, name, created_at FROM playlists ORDER BY name")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let playlists = stmt
        .query_map([], |row| {
            Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| format!("Failed to query playlists: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(playlists)
}

#[tauri::command]
pub async fn add_to_playlist(
    app: AppHandle,
    playlist_id: i64,
    video_id: String,
    title: String,
    artist: Option<String>,
    thumbnail: Option<String>,
) -> Result<i64, String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;

    let max_pos: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM playlist_songs WHERE playlist_id = ?1",
            [playlist_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    let position = max_pos + 1;

    db.execute(
        "INSERT INTO playlist_songs (playlist_id, video_id, title, artist, thumbnail, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![playlist_id, video_id, title, artist, thumbnail, position],
    )
    .map_err(|e| format!("Failed to add to playlist: {}", e))?;

    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub async fn reorder_playlist_songs(
    app: AppHandle,
    playlist_id: i64,
    video_ids: Vec<String>,
) -> Result<(), String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;

    for (index, video_id) in video_ids.iter().enumerate() {
        let position = index as i64;
        db.execute(
            "UPDATE playlist_songs SET position = ?1 WHERE playlist_id = ?2 AND video_id = ?3",
            rusqlite::params![position, playlist_id, video_id],
        )
        .map_err(|e| format!("Failed to reorder song {}: {}", video_id, e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn remove_from_playlist(app: AppHandle, playlist_id: i64, video_id: String) -> Result<(), String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;
    db.execute(
        "DELETE FROM playlist_songs WHERE playlist_id = ?1 AND video_id = ?2",
        rusqlite::params![playlist_id, video_id],
    )
    .map_err(|e| format!("Failed to remove from playlist: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_playlist_songs(app: AppHandle, playlist_id: i64) -> Result<Vec<PlaylistSong>, String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;
    let mut stmt = db
        .prepare(
            "SELECT id, playlist_id, video_id, title, artist, thumbnail, position FROM playlist_songs WHERE playlist_id = ?1 ORDER BY position",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let songs = stmt
        .query_map([playlist_id], |row| {
            Ok(PlaylistSong {
                id: row.get(0)?,
                playlist_id: row.get(1)?,
                video_id: row.get(2)?,
                title: row.get(3)?,
                artist: row.get(4)?,
                thumbnail: row.get(5)?,
                position: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query songs: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(songs)
}

#[tauri::command]
pub async fn toggle_favorite(
    app: AppHandle,
    video_id: String,
    title: String,
    artist: Option<String>,
    thumbnail: Option<String>,
) -> Result<bool, String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;

    let exists: bool = db
        .query_row(
            "SELECT COUNT(*) > 0 FROM favorites WHERE video_id = ?1",
            [&video_id],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if exists {
        db.execute("DELETE FROM favorites WHERE video_id = ?1", [&video_id])
            .map_err(|e| format!("Failed to remove favorite: {}", e))?;
        Ok(false)
    } else {
        db.execute(
            "INSERT INTO favorites (video_id, title, artist, thumbnail) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![video_id, title, artist, thumbnail],
        )
        .map_err(|e| format!("Failed to add favorite: {}", e))?;
        Ok(true)
    }
}

#[tauri::command]
pub async fn get_favorites(app: AppHandle) -> Result<Vec<PlaylistSong>, String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;
    let mut stmt = db
        .prepare(
            "SELECT ROW_NUMBER() OVER (ORDER BY added_at), video_id, title, artist, thumbnail, 0 FROM favorites ORDER BY added_at DESC",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let favorites = stmt
        .query_map([], |row| {
            Ok(PlaylistSong {
                id: row.get(0)?,
                playlist_id: 0,
                video_id: row.get(1)?,
                title: row.get(2)?,
                artist: row.get(3)?,
                thumbnail: row.get(4)?,
                position: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query favorites: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(favorites)
}

#[tauri::command]
pub async fn add_recently_played(
    app: AppHandle,
    video_id: String,
    title: String,
    artist: Option<String>,
    thumbnail: Option<String>,
) -> Result<(), String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;

    db.execute("DELETE FROM recently_played WHERE video_id = ?1", [&video_id])
        .map_err(|e| format!("Failed to clean old entry: {}", e))?;

    db.execute(
        "INSERT INTO recently_played (video_id, title, artist, thumbnail) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![video_id, title, artist, thumbnail],
    )
    .map_err(|e| format!("Failed to add recently played: {}", e))?;

    // Trim history to prevent unbounded growth
    db.execute(
        &format!(
            "DELETE FROM recently_played WHERE id NOT IN \
             (SELECT id FROM recently_played ORDER BY played_at DESC LIMIT {})",
            MAX_RECENTLY_PLAYED
        ),
        [],
    )
    .map_err(|e| format!("Failed to trim history: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn get_recently_played(app: AppHandle) -> Result<Vec<RecentlyPlayed>, String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;
    let mut stmt = db
        .prepare(
            &format!("SELECT video_id, title, artist, thumbnail, played_at FROM recently_played ORDER BY played_at DESC LIMIT {}", MAX_RECENTLY_PLAYED),
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let items = stmt
        .query_map([], |row| {
            Ok(RecentlyPlayed {
                video_id: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                thumbnail: row.get(3)?,
                played_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed to query recently played: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(items)
}

#[tauri::command]
pub async fn save_preference(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;
    db.execute(
        "INSERT OR REPLACE INTO user_preferences (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| format!("Failed to save preference: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_preference(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;
    let result = db.query_row(
        "SELECT value FROM user_preferences WHERE key = ?1",
        [&key],
        |row| row.get(0),
    );

    match result {
        Ok(value) => Ok(Some(value)),
        Err(_) => Ok(None),
    }
}


