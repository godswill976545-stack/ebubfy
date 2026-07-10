use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Duration;

// ─── Public types ───────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LyricsResult {
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synced_lyrics: Option<String>,
    pub source: String,
    pub duration: Option<f64>,
    pub provider: String, // More specific than source (lrclib, lyrics.ovh, etc.)
    pub language: Option<String>, // If lyrics are translated
    pub is_synced: bool, // Explicit flag for synced vs plain
    pub confidence: f64, // 0.0-1.0 confidence level of match
}

// ─── Shared HTTP client ────────────────────────────────────

fn shared_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("ebubfy/0.1.0 (music player)")
            .timeout(Duration::from_secs(15))
            .pool_max_idle_per_host(4)
            .build()
            .expect("failed to build HTTP client")
    })
}

// ─── Query cleaning ────────────────────────────────────────

const CHANNEL_SUFFIXES: &[&str] = &[
    "- Topic", "- topic", "Topic",
    "-VEVO", "-vevo", "VEVO",
    "Officiel", "officiel", "OFFICIEL",
    "Official", "OFFICIAL",
    "Music",
];

/// Parse artist + title from a YouTube-style query.
/// Uses first " - " separator, but also handles cases where title contains artist
/// Returns (artist, title) with cleaned, standardized formatting.
fn clean_query(query: &str) -> (String, String) {
    let q = query.trim();

    // First, try to extract artist and title using a YouTube-style separator.
    // Handles ASCII hyphen, en-dash and em-dash so titles like "Artist – Title"
    // are parsed correctly.
    if let Some((pos, sep_len)) = find_separator(q) {
        let raw_artist = q[..pos].trim();
        let raw_title = q[pos + sep_len..].trim();
        
        // Clean both parts
        let artist = clean_artist(raw_artist);
        let title = clean_title(raw_title);
        
        // If the cleaned title starts with the cleaned artist (e.g., "CKay CKay - BODY" → "CKay - BODY"),
        // remove the artist from the title to avoid duplication
        if !artist.is_empty() && !title.is_empty() && 
           title.to_lowercase().starts_with(&artist.to_lowercase()) {
            let title_without_artist = title[artist.len()..].trim();
            if title_without_artist.starts_with(" - ") {
                let final_title = title_without_artist[3..].trim();
                if !final_title.is_empty() {
                    return (artist, final_title.to_string());
                }
            }
        }
        
        return (artist, title);
    }
    
    // If no " - " separator, assume the whole thing is the title
    // and let the backend determine the artist from metadata
    (String::new(), clean_title(q))
}

fn clean_artist(raw: &str) -> String {
    let mut result = raw.trim().to_string();
    for suffix in CHANNEL_SUFFIXES {
        if let Some(pos) = result.rfind(suffix) {
            if result[pos + suffix.len()..].trim().is_empty() {
                result = result[..pos].trim().to_string();
            }
        }
    }
    result
}

fn clean_title(raw: &str) -> String {
    let cleaned = raw
        .replace(|c: char| c == '(' || c == ')' || c == '[' || c == ']', " ")
        .replace(|c: char| c == '（' || c == '）' || c == '［' || c == '］', " ");

    let result: Vec<&str> = cleaned
        .split_whitespace()
        .take_while(|w| {
            let lower = w.to_lowercase();
            !["feat", "featuring", "ft", "ft.", "prod", "produced", "remix", "and"]
                .contains(&lower.as_str())
        })
        .collect();

    result.join(" ")
}

// ─── LRCLIB API (primary provider) ───────────────────────

#[derive(Debug, Deserialize)]
struct LrclibResponse {
    #[serde(default, rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
    #[serde(default, rename = "plainLyrics")]
    plain_lyrics: Option<String>,
    #[serde(default, rename = "trackName")]
    track_name: Option<String>,
    #[serde(default, rename = "artistName")]
    artist_name: Option<String>,
}

/// Fetch lyrics from LRCLIB (primary provider).
///
/// LRCLIB is an open, free API that returns synced LRC lyrics.
/// Endpoint: GET https://lrclib.net/api/get?track_name=...&artist_name=...&duration=...
async fn fetch_from_lrclib(
    artist: &str,
    title: &str,
    duration: Option<f64>,
) -> Result<Option<LyricsResult>, String> {
    let client = shared_client();
    let mut params = vec![
        ("track_name".to_string(), title.to_string()),
        ("artist_name".to_string(), artist.to_string()),
    ];
    if let Some(dur) = duration {
        params.push(("duration".to_string(), dur.round().to_string()));
    }

    println!(
        "[ebubfy-lyrics] [LRCLIB] GET https://lrclib.net/api/get (artist='{}', title='{}', duration={:?})",
        artist, title, duration
    );

    let resp = match client
        .get("https://lrclib.net/api/get")
        .query(&params)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            println!("[ebubfy-lyrics] [LRCLIB] connection error: {e}");
            return Ok(None);
        }
    };

    let status = resp.status();
    let body_text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            println!("[ebubfy-lyrics] [LRCLIB] read error: {e}");
            return Ok(None);
        }
    };

    if status == 404 {
        println!("[ebubfy-lyrics] [LRCLIB] HTTP 404 -- no lyrics found");
        return Ok(None);
    }

    if !status.is_success() {
        println!("[ebubfy-lyrics] [LRCLIB] HTTP {status}");
        return Ok(None);
    }

    let data: LrclibResponse = match serde_json::from_str(&body_text) {
        Ok(d) => d,
        Err(e) => {
            println!("[ebubfy-lyrics] [LRCLIB] JSON parse error: {e}");
            return Ok(None);
        }
    };

    // Prefer synced lyrics, fall back to plain text
    let synced = data.synced_lyrics.and_then(|s| {
        let trimmed = s.trim();
        if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
    });
    let plain = data.plain_lyrics.and_then(|s| {
        let trimmed = s.trim();
        if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
    });

    match (&synced, &plain) {
        (Some(s), _) => {
            println!("[ebubfy-lyrics] [LRCLIB] FOUND synced lyrics ({} chars)", s.len());
            Ok(Some(LyricsResult {
                body: s.clone(),
                synced_lyrics: Some(s.clone()),
                source: "lrclib".to_string(),
                provider: "lrclib".to_string(),
                language: None,
                is_synced: true,
                confidence: 0.95, // High confidence for synced lyrics
                duration: duration,
            }))
        }
        (None, Some(p)) => {
            println!("[ebubfy-lyrics] [LRCLIB] FOUND plain lyrics ({} chars)", p.len());
            Ok(Some(LyricsResult {
                body: p.clone(),
                synced_lyrics: None,
                source: "lrclib".to_string(),
                provider: "lrclib".to_string(),
                language: None,
                is_synced: false,
                confidence: 0.85, // Good confidence for plain lyrics
                duration: duration,
            }))
        }
        (None, None) => {
            println!("[ebubfy-lyrics] [LRCLIB] Empty response");
            Ok(None)
        }
    }
}

/// Search LRCLIB by query + track_name + artist_name (all optional).
/// Endpoint: GET https://lrclib.net/api/search?q=...&track_name=...&artist_name=...
/// Returns an array of matches; we pick the first one.
async fn fetch_from_lrclib_search(
    artist: &str,
    title: &str,
    duration: Option<f64>,
) -> Result<Option<LyricsResult>, String> {
    let client = shared_client();
    let mut params: Vec<(String, String)> = vec![];
    if !title.is_empty() {
        params.push(("track_name".to_string(), title.to_string()));
    }
    if !artist.is_empty() {
        params.push(("artist_name".to_string(), artist.to_string()));
    }
    // Also provide a free-text query for broader matching
    let q = if !artist.is_empty() && !title.is_empty() {
        format!("{artist} {title}")
    } else {
        title.to_string()
    };
    params.push(("q".to_string(), q));

    println!(
        "[ebubfy-lyrics] [LRCLIB-search] GET /api/search params={:?}",
        params
    );

    let resp = match client
        .get("https://lrclib.net/api/search")
        .query(&params)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            println!("[ebubfy-lyrics] [LRCLIB-search] connection error: {e}");
            return Ok(None);
        }
    };

    let status = resp.status();
    let body_text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            println!("[ebubfy-lyrics] [LRCLIB-search] read error: {e}");
            return Ok(None);
        }
    };

    if status == 404 {
        println!("[ebubfy-lyrics] [LRCLIB-search] HTTP 404 -- no results");
        return Ok(None);
    }

    if !status.is_success() {
        println!("[ebubfy-lyrics] [LRCLIB-search] HTTP {status}");
        return Ok(None);
    }

    // Response is an array of TrackResponse objects
    let items: Vec<LrclibResponse> = match serde_json::from_str(&body_text) {
        Ok(d) => d,
        Err(e) => {
            println!("[ebubfy-lyrics] [LRCLIB-search] JSON parse error: {e}");
            return Ok(None);
        }
    };

    // Pick the first result that has any lyrics
    let num_results = items.len();
    for item in items {
        let synced = item.synced_lyrics.and_then(|s| {
            let trimmed = s.trim().to_string();
            if trimmed.is_empty() { None } else { Some(trimmed) }
        });
        let plain = item.plain_lyrics.and_then(|s| {
            let trimmed = s.trim().to_string();
            if trimmed.is_empty() { None } else { Some(trimmed) }
        });

        match (&synced, &plain) {
            (Some(s), _) => {
                println!("[ebubfy-lyrics] [LRCLIB-search] FOUND synced lyrics ({} chars)", s.len());
                return Ok(Some(LyricsResult {
                    body: s.clone(),
                    synced_lyrics: Some(s.to_string()),
                    source: "lrclib".to_string(),
                    duration,
                    provider: "lrclib".to_string(),
                    language: None,
                    is_synced: true,
                    confidence: 0.95,
                }));
            }
            (None, Some(p)) => {
                println!("[ebubfy-lyrics] [LRCLIB-search] FOUND plain lyrics ({} chars)", p.len());
                return Ok(Some(LyricsResult {
                    body: p.to_string(),
                    synced_lyrics: None,
                    source: "lrclib".to_string(),
                    duration,
                    provider: "lrclib".to_string(),
                    language: None,
                    is_synced: false,
                    confidence: 0.85,
                }));
            }
            _ => {} // instrumental or empty, try next
        }
    }

    println!("[ebubfy-lyrics] [LRCLIB-search] No usable lyrics in {} results", num_results);
    Ok(None)
}

// ─── Lyrics.ovh API (fallback provider) ──────────────────────

#[derive(Debug, Deserialize)]
struct LyricsOvhResponse {
    lyrics: Option<String>,
    error: Option<String>,
}

/// Fetch lyrics from lyrics.ovh.
///
/// Endpoint: GET https://api.lyrics.ovh/v1/{artist}/{title}
/// Returns `{"lyrics": "..."}` on success, or a 404 with `{"error": "No lyrics found"}`.
async fn fetch_from_lyrics_ovh(artist: &str, title: &str) -> Result<Option<LyricsResult>, String> {
    let client = shared_client();
    let url = format!(
        "https://api.lyrics.ovh/v1/{}/{}",
        urlencoding::encode(artist),
        urlencoding::encode(title),
    );

    println!("[ebubfy-lyrics] [lyrics.ovh] GET {url}");

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            println!("[ebubfy-lyrics] [lyrics.ovh] connection error: {e}");
            return Ok(None);
        }
    };

    let status = resp.status();
    let body_text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            println!("[ebubfy-lyrics] [lyrics.ovh] read error: {e}");
            return Ok(None);
        }
    };

    // 404, 400, 502, 503 = not found or upstream error
    if status == 404 || status == 400 || status == 502 || status == 503 {
        println!("[ebubfy-lyrics] [lyrics.ovh] HTTP {status} — skipping");
        return Ok(None);
    }

    if !status.is_success() {
        println!("[ebubfy-lyrics] [lyrics.ovh] HTTP {status}");
        return Ok(None);
    }

    let data: LyricsOvhResponse = match serde_json::from_str(&body_text) {
        Ok(d) => d,
        Err(e) => {
            println!("[ebubfy-lyrics] [lyrics.ovh] JSON parse error: {e}");
            return Ok(None);
        }
    };

    if data.error.is_some() {
        println!("[ebubfy-lyrics] [lyrics.ovh] API error: {:?}", data.error);
        return Ok(None);
    }

    let lyrics = match data.lyrics {
        Some(l) => l,
        None => {
            println!("[ebubfy-lyrics] [lyrics.ovh] empty lyrics field");
            return Ok(None);
        }
    };

    let trimmed = lyrics.trim();
    if trimmed.is_empty() || trimmed == "\n" {
        println!("[ebubfy-lyrics] [lyrics.ovh] empty content");
        return Ok(None);
    }

    println!(
        "[ebubfy-lyrics] [lyrics.ovh] FOUND lyrics ({} chars)",
        trimmed.len()
    );

    Ok(Some(LyricsResult {
        body: trimmed.to_string(),
        synced_lyrics: None, // lyrics.ovh doesn't provide synced/LRC lyrics
        source: "lyrics.ovh".to_string(),
        provider: "lyrics.ovh".to_string(),
        language: None,
        is_synced: false,
        confidence: 0.75, // Medium confidence for plain lyrics
        duration: None,
    }))
}

// ─── Unified search ────────────────────────────────────────

/// Search for lyrics: LRCLIB (primary) -> lyrics.ovh (fallback).
///
/// Tries LRCLIB first with full artist+title (and optional duration).
/// If not found, falls back to lyrics.ovh with artist name variations.
#[tauri::command]
pub async fn search_lyrics(
    query: String,
    duration: Option<f64>,
) -> Result<Option<LyricsResult>, String> {
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!(
        "[ebubfy-lyrics] query='{}' duration={:?}",
        query, duration
    );

    // Keep the original unstripped title for LRCLIB (it matches better)
    let (artist, title) = clean_query(&query);
    let title_for_lrclib = title_stripped_for_lrclib(&query);
    println!(
        "[ebubfy-lyrics] Parsed: artist='{}' title='{}' lrclib_title='{}'",
        artist, title, title_for_lrclib
    );

    if title.is_empty() {
        println!("[ebubfy-lyrics] Empty title, aborting");
        return Ok(None);
    }

    // ── Provider 1: LRCLIB (primary) ──
    // Try with full artist + cleaned title + duration
    if !artist.is_empty() {
        println!("[ebubfy-lyrics] Trying LRCLIB (full artist + title + duration)...");
        match fetch_from_lrclib(&artist, &title_for_lrclib, duration).await {
            Ok(Some(result)) => {
                println!("[ebubfy-lyrics] RESULT: LRCLIB matched (full)");
                return Ok(Some(result));
            }
            Ok(None) => println!("[ebubfy-lyrics] LRCLIB: no match (full)"),
            Err(e) => println!("[ebubfy-lyrics] LRCLIB error: {e}"),
        }

        // LRCLIB /api/get requires an exact duration match. If the YouTube video
        // length differs from the canonical track length (very common), retry
        // without the duration parameter.
        println!("[ebubfy-lyrics] Trying LRCLIB (full artist + title, no duration)...");
        match fetch_from_lrclib(&artist, &title_for_lrclib, None).await {
            Ok(Some(result)) => {
                println!("[ebubfy-lyrics] RESULT: LRCLIB matched (no duration)");
                return Ok(Some(result));
            }
            Ok(None) => println!("[ebubfy-lyrics] LRCLIB: no match (no duration)"),
            Err(e) => println!("[ebubfy-lyrics] LRCLIB error: {e}"),
        }
    }

    // ── Provider 2: LRCLIB /api/search (title-only fallback) ──
    println!("[ebubfy-lyrics] Trying LRCLIB /api/search...");
    match fetch_from_lrclib_search(&artist, &title_for_lrclib, duration).await {
        Ok(Some(result)) => {
            println!("[ebubfy-lyrics] RESULT: LRCLIB /api/search matched");
            return Ok(Some(result));
        }
        Ok(None) => println!("[ebubfy-lyrics] LRCLIB /api/search: no match"),
        Err(e) => println!("[ebubfy-lyrics] LRCLIB /api/search error: {e}"),
    }

    // ── Provider 3: lyrics.ovh (fallback, may be unreliable) ──
    // Try with full artist + full title
    if !artist.is_empty() && !title.is_empty() {
        println!("[ebubfy-lyrics] Falling back to lyrics.ovh (full artist + title)...");
        match fetch_from_lyrics_ovh(&artist, &title).await {
            Ok(Some(result)) => {
                println!("[ebubfy-lyrics] RESULT: lyrics.ovh matched (full)");
                return Ok(Some(result));
            }
            Ok(None) => println!("[ebubfy-lyrics] lyrics.ovh: no match (full)"),
            Err(e) => println!("[ebubfy-lyrics] lyrics.ovh error: {e}"),
        }
    } else if !title.is_empty() {
        println!("[ebubfy-lyrics] No artist parsed, trying lyrics.ovh with 'Unknown'...");
        match fetch_from_lyrics_ovh("Unknown", &title).await {
            Ok(Some(result)) => {
                println!("[ebubfy-lyrics] RESULT: lyrics.ovh matched (unknown artist)");
                return Ok(Some(result));
            }
            Ok(None) => println!("[ebubfy-lyrics] lyrics.ovh: no match (unknown artist)"),
            Err(e) => println!("[ebubfy-lyrics] lyrics.ovh error: {e}"),
        }
    }

    // Try with first word of artist
    if !artist.is_empty() && !title.is_empty() {
        let first_word = artist.split_whitespace().next().unwrap_or("");
        if !first_word.is_empty() && first_word.len() < artist.len() {
            println!("[ebubfy-lyrics] Trying lyrics.ovh (first artist word: '{}')...", first_word);
            match fetch_from_lyrics_ovh(first_word, &title).await {
                Ok(Some(result)) => {
                    println!("[ebubfy-lyrics] RESULT: lyrics.ovh matched (first word)");
                    return Ok(Some(result));
                }
                Ok(None) => println!("[ebubfy-lyrics] lyrics.ovh: no match (first word)"),
                Err(e) => println!("[ebubfy-lyrics] lyrics.ovh error: {e}"),
            }
        }
    }

    println!("[ebubfy-lyrics] No lyrics found from any provider");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    Ok(None)
}

/// Extract a cleaned title from the raw query for LRCLIB.
/// Keeps more of the original title than clean_title (which strips parentheses, etc.).
/// LRCLIB matches better with fuller titles.
fn title_stripped_for_lrclib(query: &str) -> String {
    let q = query.trim();
    if let Some((pos, sep_len)) = find_separator(q) {
        q[pos + sep_len..].trim().to_string()
    } else {
        q.to_string()
    }
}

/// Find the first YouTube-style "artist - title" separator in a string.
/// Returns the byte index and byte length of the separator, preferring the
/// ASCII hyphen first, then en-dash, then em-dash.
fn find_separator(q: &str) -> Option<(usize, usize)> {
    q.find(" - ")
        .map(|pos| (pos, " - ".len()))
        .or_else(|| q.find(" – ").map(|pos| (pos, " – ".len())))
        .or_else(|| q.find(" — ").map(|pos| (pos, " — ".len())))
}

// ─── Legacy compatibility ──────────────────────────────────

#[tauri::command]
pub async fn get_lyrics_by_id(_track_id: i64) -> Result<Option<LyricsResult>, String> {
    Err("MusixMatch API is no longer supported. Use search_lyrics instead.".to_string())
}

#[tauri::command]
pub async fn get_lyrics_translation(
    _track_id: i64,
    _language: String,
) -> Result<Option<String>, String> {
    Err("MusixMatch API is no longer supported.".to_string())
}
