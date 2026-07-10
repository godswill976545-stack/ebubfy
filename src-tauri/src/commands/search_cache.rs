use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::db;
use crate::commands::youtube::VideoResult;

const MAX_CACHE_ENTRIES: i64 = 500;
const CACHE_TTL_DAYS: i64 = 30;

#[derive(Debug, Serialize, Deserialize)]
pub struct CachedSearch {
    pub query: String,
    pub results: Vec<VideoResult>,
    pub cached_at: String,
}

/// Store search results so the same query returns instantly next time.
#[tauri::command]
pub async fn cache_search(
    app: AppHandle,
    query: String,
    results: Vec<VideoResult>,
) -> Result<(), String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(());
    }
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;

    let json = serde_json::to_string(&results)
        .map_err(|e| format!("Failed to serialize results: {}", e))?;

    db.execute(
        "INSERT INTO search_cache (query, result_json, result_count) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(query) DO UPDATE SET \
             result_json = excluded.result_json, \
             result_count = excluded.result_count, \
             cached_at = CURRENT_TIMESTAMP",
        rusqlite::params![q, json, results.len() as i64],
    )
    .map_err(|e| format!("Failed to cache search: {}", e))?;

    // Keep FTS index in sync.
    let row_id: i64 = db
        .query_row(
            "SELECT id FROM search_cache WHERE query = ?1",
            [q],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to get row id: {}", e))?;
    db.execute(
        "INSERT INTO search_cache_fts(rowid, query) VALUES (?1, ?2) \
         ON CONFLICT(rowid) DO UPDATE SET query = excluded.query",
        rusqlite::params![row_id, q],
    )
    .map_err(|e| format!("Failed to update FTS: {}", e))?;

    // Evict old entries to keep the table bounded.
    db.execute(
        &format!(
            "DELETE FROM search_cache WHERE id NOT IN (\
             SELECT id FROM search_cache ORDER BY cached_at DESC LIMIT {})",
            MAX_CACHE_ENTRIES
        ),
        [],
    )
    .map_err(|e| format!("Failed to evict cache: {}", e))?;
    db.execute(
        "DELETE FROM search_cache_fts WHERE rowid NOT IN \
         (SELECT id FROM search_cache)",
        [],
    )
    .ok();

    // Record in search history (de-dup, just bump the timestamp).
    db.execute(
        "DELETE FROM search_history WHERE query = ?1",
        [q],
    )
    .ok();
    db.execute(
        "INSERT INTO search_history (query, result_count) VALUES (?1, ?2)",
        rusqlite::params![q, results.len() as i64],
    )
    .map_err(|e| format!("Failed to record history: {}", e))?;
    db.execute(
        &format!(
            "DELETE FROM search_history WHERE id NOT IN (\
             SELECT id FROM search_history ORDER BY searched_at DESC LIMIT 50)"
        ),
        [],
    )
    .ok();

    Ok(())
}

/// Read a cached search result by exact query. Returns None if missing or expired.
#[tauri::command]
pub async fn get_cached_search(
    app: AppHandle,
    query: String,
) -> Result<Option<CachedSearch>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(None);
    }
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;

    let mut stmt = db
        .prepare(
            "SELECT result_json, cached_at FROM search_cache \
             WHERE query = ?1 \
             AND cached_at > datetime('now', ?2)",
        )
        .map_err(|e| format!("Failed to prepare: {}", e))?;
    let ttl = format!("-{} days", CACHE_TTL_DAYS);

    let mut rows = stmt
        .query(rusqlite::params![q, &ttl])
        .map_err(|e| format!("Failed to query: {}", e))?;

    if let Some(row) = rows.next().map_err(|e| format!("Row error: {}", e))? {
        let json: String = row.get(0).map_err(|e| format!("Col error: {}", e))?;
        let cached_at: String = row.get(1).map_err(|e| format!("Col error: {}", e))?;
        let results: Vec<VideoResult> = serde_json::from_str(&json).unwrap_or_default();
        return Ok(Some(CachedSearch {
            query: q.to_string(),
            results,
            cached_at,
        }));
    }

    Ok(None)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub query: String,
    pub result_count: i64,
    pub searched_at: String,
}

#[tauri::command]
pub async fn get_search_history(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;
    let mut stmt = db
        .prepare(
            "SELECT id, query, result_count, searched_at FROM search_history \
             ORDER BY searched_at DESC LIMIT 20",
        )
        .map_err(|e| format!("Failed to prepare: {}", e))?;
    let entries = stmt
        .query_map([], |row| {
            Ok(HistoryEntry {
                id: row.get(0)?,
                query: row.get(1)?,
                result_count: row.get(2)?,
                searched_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to query: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

#[tauri::command]
pub async fn clear_search_history(app: AppHandle) -> Result<(), String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;
    db.execute("DELETE FROM search_history", [])
        .map_err(|e| format!("Failed to clear history: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn remove_history_entry(app: AppHandle, id: i64) -> Result<(), String> {
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;
    db.execute("DELETE FROM search_history WHERE id = ?1", [id])
        .map_err(|e| format!("Failed to remove history entry: {}", e))?;
    Ok(())
}

/// Lightweight autocomplete across cached queries (FTS5 prefix match).
#[tauri::command]
pub async fn suggest_queries(app: AppHandle, prefix: String) -> Result<Vec<String>, String> {
    let p = prefix.trim();
    if p.is_empty() {
        return Ok(Vec::new());
    }
    let state = app.state::<db::DbState>();
    let db = state.0.lock().await;

    // FTS5 prefix search on the last token only.
    let safe = p.replace('"', " ");
    let pattern = format!("\"{}*\"", safe);
    let mut stmt = db
        .prepare(
            "SELECT c.query FROM search_cache_fts fts \
             JOIN search_cache c ON c.id = fts.rowid \
             WHERE search_cache_fts MATCH ?1 \
             ORDER BY rank LIMIT 8",
        )
        .map_err(|e| format!("Failed to prepare: {}", e))?;
    let rows = stmt
        .query_map([&pattern], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to query: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}
