use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Emitter;

// ─── Public types ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicBrainzRecording {
    pub id: String,
    pub title: String,
    pub artist_credit: String,
    pub score: i32,
    pub releases: Vec<MusicBrainzReleaseSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicBrainzReleaseSummary {
    pub id: String,
    pub title: String,
}

// ─── Cached enrichment result ───────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedEnrichment {
    pub query_key: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<i32>,
    pub cover_url: Option<String>,
    pub cached_at: i64, // unix timestamp
}

// ─── HTTP client ────────────────────────────────────────────

fn shared_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("ebubfy/0.1.0 (music player; https://github.com/ebubfy)")
            .timeout(Duration::from_secs(10))
            .pool_max_idle_per_host(2)
            .build()
            .expect("failed to build MusicBrainz HTTP client")
    })
}

// ─── Rate limiter (1 req/sec per MusicBrainz policy) ────────

static LAST_REQUEST: OnceLock<Mutex<Instant>> = OnceLock::new();

// ─── In-flight dedup set ──────────────────────────────────
// Prevents duplicate concurrent enrichments for the same query_key.
static ENRICH_IN_FLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn try_claim_in_flight(key: &str) -> bool {
    let set = ENRICH_IN_FLIGHT.get_or_init(|| Mutex::new(HashSet::new()));
    let mut set = set.lock().unwrap();
    if set.contains(key) {
        false
    } else {
        set.insert(key.to_string());
        true
    }
}

fn release_in_flight(key: &str) {
    if let Some(set) = ENRICH_IN_FLIGHT.get() {
        let mut set = set.lock().unwrap();
        set.remove(key);
    }
}

async fn rate_limit() {
    let lock = LAST_REQUEST.get_or_init(|| std::sync::Mutex::new(Instant::now()));
    // Read the last request time, drop the guard before any .await
    let wait = {
        let last = lock.lock().unwrap();
        let elapsed = last.elapsed();
        if elapsed < Duration::from_millis(1100) {
            Some(Duration::from_millis(1100) - elapsed)
        } else {
            None
        }
    };
    // Sleep outside the lock
    if let Some(wait) = wait {
        tokio::time::sleep(wait).await;
    }
    // Update the timestamp
    {
        let mut last = lock.lock().unwrap();
        *last = Instant::now();
    }
}

// ─── Title cleaning for MusicBrainz matching ─────────────────

/// Clean a YouTube-derived title for better MusicBrainz matching.
/// Strips:
///   - Leading "ArtistName - " or "ArtistName – " prefix
///   - Trailing parenthetical descriptors like (Clip officiel), (Official Video)
///   - Trailing square-bracket descriptors like [Official Video]
///   - Featured-artist prefix before " - " when it contains the artist name
///     (e.g., "GIMS & La Mano 1.9 - PARISIENNE" → "PARISIENNE")
fn clean_title_for_musicbrainz(artist: &str, title: &str) -> String {
    let mut cleaned = title.trim().to_string();

    // 1. Strip leading "ArtistName - " prefix (regular and em-dash)
    let mut step1_matched = false;
    for sep in [" - ", " – "] {
        let prefix = format!("{}{}", artist, sep);
        if cleaned.starts_with(&prefix) {
            cleaned = cleaned[prefix.len()..].to_string();
            step1_matched = true;
            break;
        }
    }

    // 2. More general: if artist name appears in the prefix before " - ", strip it
    // Only runs if step 1 didn't match, to avoid double-stripping.
    if !step1_matched && !artist.is_empty() {
        if let Some(dash_idx) = cleaned.find(" - ") {
            let prefix_part = cleaned[..dash_idx].to_lowercase();
            if prefix_part.contains(&artist.to_lowercase()) {
                cleaned = cleaned[dash_idx + 3..].to_string();
            }
        }
    }

    // 3. Strip trailing parenthetical groups: "Title (Clip officiel)" → "Title"
    // Only strip COMMON noise descriptors, NOT all parentheses — some tracks
    // legitimately have parentheses in their title (e.g. "Mauvais Djo - Pilé (Gospel Version)")
    let noise_parentheses = [
        "clip officiel", "clip", "official video", "official music video",
        "official audio", "official lyric video", "official visualizer",
        "music video", "audio", "lyric video", "visualizer",
        "lyrics", "vevo", "remaster", "remastered",
        "live performance", "live from", "live at",
        "explicit", "clean version", "radio edit",
        "4k", "hd",
    ];

    // Only strip trailing groups that match KNOWN noise patterns
    let has_noise_parenthetical = |s: &str| -> bool {
        if let Some(open_idx) = s.rfind('(') {
            if s[open_idx..].ends_with(')') {
                let content = s[open_idx + 1..s.len() - 1].trim().to_lowercase();
                return noise_parentheses.iter().any(|n| content.contains(n) || content == *n);
            }
        }
        false
    };

    loop {
        let trimmed = cleaned.trim().to_string();
        if trimmed.is_empty() { break; }
        if has_noise_parenthetical(&trimmed) {
            if let Some(open_idx) = trimmed.rfind('(') {
                cleaned = trimmed[..open_idx].trim().to_string();
                continue;
            }
        }
        break;
    }

    // 4. Strip trailing square-bracket groups: "Title [Official Video]" → "Title"
    let noise_brackets = [
        "official video", "official music video", "official audio",
        "official lyric video", "music video", "lyric video", "visualizer",
        "audio", "lyrics", "vevo", "explicit", "4k", "hd",
    ];

    let has_noise_bracket = |s: &str| -> bool {
        if let Some(open_idx) = s.rfind('[') {
            if s[open_idx..].ends_with(']') {
                let content = s[open_idx + 1..s.len() - 1].trim().to_lowercase();
                return noise_brackets.iter().any(|n| content.contains(n) || content == *n);
            }
        }
        false
    };

    loop {
        let trimmed = cleaned.trim().to_string();
        if trimmed.is_empty() { break; }
        if has_noise_bracket(&trimmed) {
            if let Some(open_idx) = trimmed.rfind('[') {
                cleaned = trimmed[..open_idx].trim().to_string();
                continue;
            }
        }
        break;
    }

    cleaned.trim().to_string()
}

// ─── Query key generation ───────────────────────────────────

fn make_query_key(artist: &str, title: &str) -> String {
    let artist = artist.to_lowercase().trim().to_string();
    let title = title.to_lowercase().trim().to_string();
    // Strip common noise from title for better matching
    let title_clean: String = title
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect();
    let title_clean = title_clean.split_whitespace().collect::<Vec<_>>().join(" ");
    format!("{}::{}", artist, title_clean)
}

// ─── MusicBrainz search ─────────────────────────────────────

async fn search_recording(artist: &str, title: &str) -> Result<Vec<MusicBrainzRecording>, String> {
    rate_limit().await;

    let query = if !artist.is_empty() {
        format!(
            "recording:\"{}\" AND artist:\"{}\"",
            title, artist
        )
    } else {
        format!("recording:\"{}\"", title)
    };

    let url = format!(
        "https://musicbrainz.org/ws/2/recording/?query={}&fmt=json&limit=5",
        urlencoding::encode(&query)
    );

    println!("[musicbrainz] Searching: {}", url);

    let resp = shared_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("MusicBrainz request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("MusicBrainz HTTP {}", resp.status()));
    }

    #[derive(Deserialize)]
    struct SearchResponse {
        recordings: Vec<MbRecording>,
    }

    #[derive(Deserialize)]
    struct MbRecording {
        id: String,
        title: String,
        #[serde(rename = "artist-credit")]
        artist_credit: Vec<ArtistCreditEntry>,
        score: Option<i32>,
        releases: Option<Vec<MbRelease>>,
    }

    #[derive(Deserialize)]
    struct ArtistCreditEntry {
        name: Option<String>,
    }

    #[derive(Deserialize)]
    struct MbRelease {
        id: String,
        title: String,
    }

    let data: SearchResponse = resp
        .json()
        .await
        .map_err(|e| format!("MusicBrainz JSON parse failed: {}", e))?;

    let results: Vec<MusicBrainzRecording> = data
        .recordings
        .into_iter()
        .map(|r| MusicBrainzRecording {
            id: r.id,
            title: r.title,
            artist_credit: r
                .artist_credit
                .iter()
                .filter_map(|a| a.name.clone())
                .collect::<Vec<_>>()
                .join(", "),
            score: r.score.unwrap_or(0),
            releases: r
                .releases
                .unwrap_or_default()
                .into_iter()
                .map(|rel| MusicBrainzReleaseSummary {
                    id: rel.id,
                    title: rel.title,
                })
                .collect(),
        })
        .collect();

    println!("[musicbrainz] Found {} recordings", results.len());
    Ok(results)
}

async fn get_release_covers(release_id: &str) -> Result<Option<String>, String> {
    rate_limit().await;

    let url = format!(
        "https://coverartarchive.org/release/{}/front-500",
        release_id
    );

    let resp = shared_client()
        .head(&url)
        .send()
        .await
        .map_err(|e| format!("Cover Art request failed: {}", e))?;

    if resp.status().is_success() {
        Ok(Some(url))
    } else {
        Ok(None)
    }
}

async fn lookup_recording_releases(
    recording_id: &str,
) -> Result<Vec<MusicBrainzReleaseSummary>, String> {
    rate_limit().await;

    let url = format!(
        "https://musicbrainz.org/ws/2/recording/{}?inc=releases&fmt=json",
        recording_id
    );

    let resp = shared_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("MusicBrainz lookup failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("MusicBrainz HTTP {}", resp.status()));
    }

    #[derive(Deserialize)]
    struct RecordingLookup {
        releases: Option<Vec<MbRelease>>,
    }

    #[derive(Deserialize)]
    struct MbRelease {
        id: String,
        title: String,
    }

    let data: RecordingLookup = resp
        .json()
        .await
        .map_err(|e| format!("MusicBrainz JSON parse failed: {}", e))?;

    Ok(data
        .releases
        .unwrap_or_default()
        .into_iter()
        .map(|r| MusicBrainzReleaseSummary {
            id: r.id,
            title: r.title,
        })
        .collect())
}

async fn lookup_release_year(release_id: &str) -> Result<Option<i32>, String> {
    rate_limit().await;

    let url = format!(
        "https://musicbrainz.org/ws/2/release/{}?fmt=json",
        release_id
    );

    let resp = shared_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("MusicBrainz release lookup failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("MusicBrainz HTTP {}", resp.status()));
    }

    #[derive(Deserialize)]
    struct ReleaseDetail {
        date: Option<String>,
    }

    let data: ReleaseDetail = resp
        .json()
        .await
        .map_err(|e| format!("MusicBrainz JSON parse failed: {}", e))?;

    if let Some(ref date_str) = data.date {
        // Date format: "YYYY-MM-DD" or "YYYY-MM" or "YYYY"
        if let Some(year_str) = date_str.split('-').next() {
            if let Ok(year) = year_str.parse::<i32>() {
                if year >= 1900 && year <= 2100 {
                    return Ok(Some(year));
                }
            }
        }
    }

    Ok(None)
}

// ─── SQLite cache ───────────────────────────────────────────

fn get_cache_db_path() -> std::path::PathBuf {
    let data_dir = if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
    } else if cfg!(target_os = "macos") {
        std::env::var("HOME")
            .map(|p| std::path::PathBuf::from(p).join("Library/Application Support"))
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
    } else {
        std::env::var("HOME")
            .map(|p| std::path::PathBuf::from(p).join(".local/share"))
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
    };
    data_dir.join("ebubfy").join("ebubfy.db")
}

fn init_cache_table(conn: &rusqlite::Connection) {
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS musicbrainz_cache (
            query_key TEXT PRIMARY KEY,
            title TEXT,
            artist TEXT,
            album TEXT,
            year INTEGER,
            cover_url TEXT,
            cached_at INTEGER NOT NULL
        );",
    );
}

fn cache_lookup(query_key: &str) -> Option<CachedEnrichment> {
    let db_path = get_cache_db_path();
    if !db_path.exists() {
        return None;
    }

    let conn = rusqlite::Connection::open(&db_path).ok()?;
    init_cache_table(&conn);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Cache entries expire after 7 days
    let result = conn.query_row(
        "SELECT query_key, title, artist, album, year, cover_url, cached_at FROM musicbrainz_cache WHERE query_key = ?1 AND cached_at > ?2",
        rusqlite::params![query_key, now - 604800],
        |row| {
            Ok(CachedEnrichment {
                query_key: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                album: row.get(3)?,
                year: row.get(4)?,
                cover_url: row.get(5)?,
                cached_at: row.get(6)?,
            })
        },
    );

    match result {
        Ok(entry) => {
            println!("[musicbrainz] Cache hit for: {}", query_key);
            Some(entry)
        }
        Err(_) => None,
    }
}

fn cache_store(enrichment: &CachedEnrichment) {
    let db_path = get_cache_db_path();
    if let Some(parent) = db_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    match rusqlite::Connection::open(&db_path) {
        Ok(conn) => {
            init_cache_table(&conn);
            let _ = conn.execute(
                "INSERT OR REPLACE INTO musicbrainz_cache (query_key, title, artist, album, year, cover_url, cached_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    enrichment.query_key,
                    enrichment.title,
                    enrichment.artist,
                    enrichment.album,
                    enrichment.year,
                    enrichment.cover_url,
                    enrichment.cached_at,
                ],
            );
        }
        Err(e) => {
            println!("[musicbrainz] Cache write failed: {}", e);
        }
    }
}

// ─── Core enrichment logic (reusable) ───────────────────────

/// Enrich a track with MusicBrainz metadata (album, year, cover art, artist).
/// Uses SQLite cache to respect rate limits and avoid repeated lookups.
/// This is the core logic, usable both from the Tauri command and enriched search.
pub async fn enrich(artist: &str, title: &str) -> CachedEnrichment {
    let original_title = title.trim();
    let clean_title = clean_title_for_musicbrainz(artist, title);
    let query_key = make_query_key(artist, &clean_title);

    // Check cache first
    if let Some(cached) = cache_lookup(&query_key) {
        return cached;
    }

    // Dedup: if another task is already enriching this same key, wait for it
    if !try_claim_in_flight(&query_key) {
        // Another call is in progress — poll cache for up to 3 seconds
        for _ in 0..15 {
            tokio::time::sleep(Duration::from_millis(200)).await;
            if let Some(cached) = cache_lookup(&query_key) {
                return cached;
            }
        }
    }

    if clean_title != original_title {
        println!("[musicbrainz] Enriching: '{}' by '{}' (cleaned from: '{}')", clean_title, artist, original_title);
    } else {
        println!("[musicbrainz] Enriching: '{}' by '{}'", clean_title, artist);
    }

    // ── Strategy: Try title variants from most-specific to most-general ──
    // Variant 1: original title (preserves parentheses/brackets)
    // Variant 2: cleaned title (strips noise descriptors)
    let title_variants = if clean_title != original_title {
        vec![original_title.to_string(), clean_title]
    } else {
        vec![original_title.to_string()]
    };

    let mut best_match: Option<MusicBrainzRecording> = None;
    let mut used_cleaned = false;

    for (variant_idx, variant_title) in title_variants.iter().enumerate() {
        if variant_idx > 0 {
            used_cleaned = true;
            println!("[musicbrainz] First variant returned no matches, trying cleaned title: '{}'", variant_title);
        }

        let recordings = match search_recording(artist, variant_title).await {
            Ok(r) => r,
            Err(e) => {
                println!("[musicbrainz] Search failed: {}", e);
                continue;
            }
        };

        // Find best match (score >= 80, or first result)
        let candidate = recordings.iter().find(|r| r.score >= 80).or(recordings.first());

        if let Some(c) = candidate {
            best_match = Some(c.clone());
            break;
        }
    }

    let best = match best_match {
        Some(ref b) => b,
        None => {
            println!("[musicbrainz] No matching recording found");
            release_in_flight(&query_key);
            let qk = query_key.clone();
            let enrichment = CachedEnrichment {
                query_key: qk,
                title: None,
                artist: None,
                album: None,
                year: None,
                cover_url: None,
                cached_at: now_timestamp(),
            };
            cache_store(&enrichment);
            return enrichment;
        }
    };

    println!(
        "[musicbrainz] Best match: '{}' by '{}' (score={}){}",
        best.title,
        best.artist_credit,
        best.score,
        if used_cleaned { " (via cleaned title)" } else { "" }
    );

    // Try to find a release with cover art
    let mut album_name: Option<String> = None;
    let mut cover_url: Option<String> = None;
    let mut year: Option<i32> = None;

    // First try releases from the recording search result
    for release in &best.releases {
        if let Ok(Some(url)) = get_release_covers(&release.id).await {
            album_name = Some(release.title.clone());
            cover_url = Some(url);
            if let Ok(Some(y)) = lookup_release_year(&release.id).await {
                year = Some(y);
            }
            break;
        }
    }

    // If no cover found via search releases, look up the recording for more releases
    if cover_url.is_none() {
        if let Ok(releases) = lookup_recording_releases(&best.id).await {
            for release in &releases {
                if let Ok(Some(url)) = get_release_covers(&release.id).await {
                    album_name = Some(release.title.clone());
                    cover_url = Some(url);
                    if let Ok(Some(y)) = lookup_release_year(&release.id).await {
                        year = Some(y);
                    }
                    break;
                }
            }
        }
    }

    // If still no year, try first release
    if year.is_none() {
        if let Some(first_release) = best.releases.first() {
            if let Ok(Some(y)) = lookup_release_year(&first_release.id).await {
                year = Some(y);
            }
            if album_name.is_none() {
                album_name = Some(first_release.title.clone());
            }
        }
    }

    println!(
        "[musicbrainz] Enriched: album={:?}, year={:?}, cover={:?}",
        album_name, year, cover_url.is_some()
    );

    let enrichment = CachedEnrichment {
        query_key: query_key.clone(),
        title: Some(best.title.clone()),
        artist: Some(best.artist_credit.clone()),
        album: album_name,
        year,
        cover_url,
        cached_at: now_timestamp(),
    };

    cache_store(&enrichment);
    release_in_flight(&query_key);
    enrichment
}

// ─── Tauri commands ─────────────────────────────────────────

/// Enrich a track with MusicBrainz metadata — Tauri command entry point.
#[tauri::command]
pub async fn musicbrainz_enrich(
    artist: String,
    title: String,
) -> Result<CachedEnrichment, String> {
    Ok(enrich(&artist, &title).await)
}

/// Background enrichment for NowPlayingPage — spawns a non-blocking task
/// and emits a 'musicbrainz-enrichment' event when done.
#[tauri::command]
pub async fn enrich_track_background(
    app: tauri::AppHandle,
    video_id: String,
    artist: String,
    title: String,
) -> Result<(), String> {
    tokio::spawn(async move {
        let mb = enrich(&artist, &title).await;

        if mb.album.is_some() || mb.year.is_some() || mb.cover_url.is_some() || mb.artist.is_some() {
            println!(
                "[musicbrainz-bg] Enriched '{}' → album={:?}, year={:?}, cover={:?}, mb_artist={:?}",
                title, mb.album, mb.year, mb.cover_url.is_some(), mb.artist
            );

            let _ = app.emit(
                "musicbrainz-enrichment",
                serde_json::json!({
                    "video_id": video_id,
                    "album": mb.album,
                    "year": mb.year,
                    "cover_url": mb.cover_url,
                    "artist": mb.artist,
                }),
            );
        }
    });
    Ok(())
}

fn now_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
