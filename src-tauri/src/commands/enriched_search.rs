use futures::stream::{self, StreamExt};
use std::time::Duration;
use tauri::Emitter;

use super::deezer;

/// Search YouTube and enrich results with rich Deezer metadata in the
/// background. Returns yt-dlp results immediately (~500ms) so the UI is fast,
/// then emits a `search-enriched` event when the album/year/cover patches
/// arrive (typically ~1-2s).
///
/// **Panic-safe:** the background task is wrapped in a `JoinHandle` and any
/// errors are logged but never crash the worker. A bad result for one track
/// can't take down enrichment for the rest.
#[tauri::command]
pub async fn search_youtube_enriched(
    app: tauri::AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<super::youtube::VideoResult>, String> {
    let limit = limit.unwrap_or(15);

    println!(
        "[ebubfy-search] search_youtube_enriched: '{}' limit={}",
        query, limit
    );

    // First, try to serve from the local cache for instant results.
    if let Ok(Some(cached)) =
        super::search_cache::get_cached_search(app.clone(), query.clone()).await
    {
        if !cached.results.is_empty() {
            println!(
                "[ebubfy-search] Cache hit for '{}': {} results",
                query,
                cached.results.len()
            );
            // Still spawn a background task to refresh the cache, but don't
            // block the response.
            let bg_app = app.clone();
            let bg_query = query.clone();
            let bg_tracks: Vec<(String, String)> = cached
                .results
                .iter()
                .map(|r| (r.artist.clone(), r.title.clone()))
                .collect();
            tokio::spawn(async move {
                enrich_and_emit(bg_app, bg_query, bg_tracks).await;
            });
            return Ok(cached.results);
        }
    }

    // ── Live YouTube search with retry ──
    let yt_results = match tokio::time::timeout(
        Duration::from_secs(12),
        super::youtube::search_youtube(app.clone(), query.clone(), Some(limit)),
    )
    .await
    {
        Ok(Ok(res)) => res,
        Ok(Err(e)) => {
            println!("[ebubfy-search] First attempt failed: {e}, retrying...");
            match tokio::time::timeout(
                Duration::from_secs(12),
                super::youtube::search_youtube(app.clone(), query.clone(), Some(limit)),
            )
            .await
            {
                Ok(Ok(res)) => res,
                Ok(Err(e2)) => return Err(format!("{e} (retry: {e2})")),
                Err(_) => return Err(format!("{e} (retry timed out)")),
            }
        }
        Err(_) => return Err("Search timed out. Check your network or try again.".to_string()),
    };

    // Persist to cache for instant next time.
    if !yt_results.is_empty() {
        let cache_app = app.clone();
        let cache_query = query.clone();
        let cache_results = yt_results.clone();
        tokio::spawn(async move {
            let _ = super::search_cache::cache_search(
                cache_app,
                cache_query,
                cache_results,
            )
            .await;
        });
    }

    if yt_results.is_empty() {
        return Ok(yt_results);
    }

    let yt_count = yt_results.len();
    println!(
        "[ebubfy-search] Returning {yt_count} YouTube results immediately"
    );

    // ── Spawn background Deezer enrichment (panic-safe) ──
    let bg_app = app.clone();
    let bg_query = query.clone();
    let bg_tracks: Vec<(String, String)> = yt_results
        .iter()
        .map(|r| (r.artist.clone(), r.title.clone()))
        .collect();
    tokio::spawn(async move {
        enrich_and_emit(bg_app, bg_query, bg_tracks).await;
    });

    Ok(yt_results)
}

/// Look up each track on Deezer, build patches, emit `search-enriched`.
/// Wrapped in a panic-catching layer so a single bad response can't crash
/// the runtime. Runs up to 5 Deezer lookups in parallel for ~5x faster
/// enrichment compared to the old sequential approach.
async fn enrich_and_emit(
    app: tauri::AppHandle,
    query: String,
    tracks: Vec<(String, String)>,
) {
    println!(
        "[ebubfy-search] Background Deezer enrichment starting for {} tracks...",
        tracks.len()
    );

    const CONCURRENCY: usize = 5;

    // Spawn the enrichment work as a child task so we can join with a timeout.
    let enrich_fut = async move {
        let results: Vec<serde_json::Value> = stream::iter(tracks.into_iter())
            .map(|(artist, title)| async move {
                // Skip if either part is missing/garbage.
                if artist.is_empty() || title.is_empty()
                    || artist == "Unknown Artist"
                    || title == "Unknown"
                {
                    return make_empty_patch(&artist, &title);
                }

                match tokio::time::timeout(
                    Duration::from_secs(6),
                    deezer::fetch_track_metadata(&artist, &title),
                )
                .await
                {
                    Ok(Some(meta)) => make_patch(&artist, &title, Some(&meta)),
                    Ok(None) => make_empty_patch(&artist, &title),
                    Err(_) => make_empty_patch(&artist, &title),
                }
            })
            .buffer_unordered(CONCURRENCY)
            .collect()
            .await;
        results
    };

    let join = tokio::spawn(enrich_fut);
    let patches = match tokio::time::timeout(Duration::from_secs(20), join).await {
        Ok(Ok(p)) => p,
        Ok(Err(e)) => {
            println!("[ebubfy-search] Enrichment join error: {e}");
            return;
        }
        Err(_) => {
            println!("[ebubfy-search] Deezer enrichment timed out (>20s)");
            return;
        }
    };

    let enriched = patches
        .iter()
        .filter(|p| p["album_cover_large"].is_string() || p["album"].is_string())
        .count();
    println!(
        "[ebubfy-search] Emitting search-enriched: {} patches ({} with data)",
        patches.len(),
        enriched
    );

    let _ = app.emit(
        "search-enriched",
        serde_json::json!({
            "query": query,
            "patches": patches,
        }),
    );
}

fn make_patch(artist: &str, title: &str, meta: Option<&deezer::TrackMetadata>) -> serde_json::Value {
    let key = format!("{}::{}", artist.to_lowercase(), title.to_lowercase());
    match meta {
        Some(m) => serde_json::json!({
            "key": key,
            "artist": artist,
            "title": title,
            "album": m.album,
            "year": m.album_release_date.as_ref().and_then(|d| d.get(..4).and_then(|y| y.parse::<i32>().ok())),
            "album_cover_small": m.album_cover_small,
            "album_cover_medium": m.album_cover_medium,
            "album_cover_large": m.album_cover_large,
            "label": m.label,
            "genre": m.genre,
        }),
        None => serde_json::json!({
            "key": key,
            "artist": artist,
            "title": title,
        }),
    }
}

fn make_empty_patch(artist: &str, title: &str) -> serde_json::Value {
    let key = format!("{}::{}", artist.to_lowercase(), title.to_lowercase());
    serde_json::json!({
        "key": key,
        "artist": artist,
        "title": title,
    })
}
