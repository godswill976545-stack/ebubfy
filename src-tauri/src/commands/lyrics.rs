use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Duration;

use super::text_clean;

// ─── Public types ───────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LyricsResult {
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synced_lyrics: Option<String>,
    pub source: String,
    pub duration: Option<f64>,
    pub provider: String,   // lrclib, netease, youtube_captions, etc.
    pub language: Option<String>,
    pub is_synced: bool,
    pub confidence: f64,    // 0.0–1.0
}

// ─── Shared HTTP client ────────────────────────────────────

fn shared_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("ebubfy/0.1.0 (music player)")
            .timeout(Duration::from_secs(12))
            .pool_max_idle_per_host(4)
            .build()
            .expect("failed to build HTTP client")
    })
}

// ─── LRCLIB (primary) ─────────────────────────────────────

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
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
        "[ebubfy-lyrics] [LRCLIB] GET /api/get artist='{}' title='{}' dur={:?}",
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
            println!("[ebubfy-lyrics] [LRCLIB] conn error: {e}");
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

    if status == 404 || !status.is_success() {
        println!("[ebubfy-lyrics] [LRCLIB] HTTP {status}");
        return Ok(None);
    }

    let data: LrclibResponse = match serde_json::from_str(&body_text) {
        Ok(d) => d,
        Err(e) => {
            println!("[ebubfy-lyrics] [LRCLIB] JSON error: {e}");
            return Ok(None);
        }
    };

    lrclib_extract(data, duration, "lrclib")
}

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
    let q = if !artist.is_empty() && !title.is_empty() {
        format!("{artist} {title}")
    } else {
        title.to_string()
    };
    params.push(("q".to_string(), q));

    println!("[ebubfy-lyrics] [LRCLIB-search] params={:?}", params);

    let resp = match client
        .get("https://lrclib.net/api/search")
        .query(&params)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            println!("[ebubfy-lyrics] [LRCLIB-search] conn error: {e}");
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

    if status == 404 || !status.is_success() {
        println!("[ebubfy-lyrics] [LRCLIB-search] HTTP {status}");
        return Ok(None);
    }

    let items: Vec<LrclibResponse> = match serde_json::from_str(&body_text) {
        Ok(d) => d,
        Err(e) => {
            println!("[ebubfy-lyrics] [LRCLIB-search] JSON error: {e}");
            return Ok(None);
        }
    };

    let num = items.len();
    for item in items {
        if let Some(r) = lrclib_extract(item, duration, "lrclib")? {
            println!("[ebubfy-lyrics] [LRCLIB-search] found match in {} results", num);
            return Ok(Some(r));
        }
    }

    println!("[ebubfy-lyrics] [LRCLIB-search] no usable lyrics in {} results", num);
    Ok(None)
}

fn lrclib_extract(
    data: LrclibResponse,
    duration: Option<f64>,
    provider: &str,
) -> Result<Option<LyricsResult>, String> {
    let synced = data.synced_lyrics.and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() { None } else { Some(t) }
    });
    let plain = data.plain_lyrics.and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() { None } else { Some(t) }
    });

    match (&synced, &plain) {
        (Some(s), _) => {
            println!("[ebubfy-lyrics] [{provider}] FOUND synced ({} chars)", s.len());
            Ok(Some(LyricsResult {
                body: s.clone(),
                synced_lyrics: Some(s.clone()),
                source: provider.to_string(),
                provider: provider.to_string(),
                language: None,
                is_synced: true,
                confidence: 0.95,
                duration,
            }))
        }
        (None, Some(p)) => {
            println!("[ebubfy-lyrics] [{provider}] FOUND plain ({} chars)", p.len());
            Ok(Some(LyricsResult {
                body: p.clone(),
                synced_lyrics: None,
                source: provider.to_string(),
                provider: provider.to_string(),
                language: None,
                is_synced: false,
                confidence: 0.85,
                duration,
            }))
        }
        _ => Ok(None),
    }
}

// ─── NetEase Cloud Music (secondary – synced LRC) ──────────
//
// Free public API, no key required. Returns synced LRC lyrics.
// Search: POST https://music.163.com/api/search/get/web
// Lyrics: GET  https://music.163.com/api/song/lyric?id={id}&lv=1&tv=-1

#[derive(Debug, Deserialize)]
struct NetEaseSearchResult {
    result: Option<NetEaseResult>,
}

#[derive(Debug, Deserialize)]
struct NetEaseResult {
    songs: Option<Vec<NetEaseSong>>,
}

#[derive(Debug, Deserialize)]
struct NetEaseSong {
    id: u64,
    name: Option<String>,
    duration: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct NetEaseLyricResponse {
    lrc: Option<NetEaseLrc>,
}

#[derive(Debug, Deserialize)]
struct NetEaseLrc {
    lyric: Option<String>,
}

/// Search NetEase for a track and return its ID.
async fn netease_search(
    artist: &str,
    title: &str,
) -> Result<Option<(u64, u64)>, String> {
    let client = shared_client();
    let keywords = if !artist.is_empty() {
        format!("{artist} {title}")
    } else {
        title.to_string()
    };

    println!("[ebubfy-lyrics] [NetEase] search keywords='{}'", keywords);

    let params = [
        ("s", keywords.as_str()),
        ("type", "1"),
        ("limit", "5"),
        ("offset", "0"),
    ];

    let resp = match client
        .post("https://music.163.com/api/search/get/web")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&params)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            println!("[ebubfy-lyrics] [NetEase] search conn error: {e}");
            return Ok(None);
        }
    };

    let status = resp.status();
    let body_text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            println!("[ebubfy-lyrics] [NetEase] search read error: {e}");
            return Ok(None);
        }
    };

    if !status.is_success() {
        println!("[ebubfy-lyrics] [NetEase] search HTTP {status}");
        return Ok(None);
    }

    let data: NetEaseSearchResult = match serde_json::from_str(&body_text) {
        Ok(d) => d,
        Err(e) => {
            println!("[ebubfy-lyrics] [NetEase] search JSON error: {e}");
            return Ok(None);
        }
    };

    let songs = match data.result.and_then(|r| r.songs) {
        Some(s) if !s.is_empty() => s,
        _ => {
            println!("[ebubfy-lyrics] [NetEase] search: no results");
            return Ok(None);
        }
    };

    // Return the first song's ID and duration (ms)
    let song = &songs[0];
    let dur_ms = song.duration.unwrap_or(0);
    println!(
        "[ebubfy-lyrics] [NetEase] search matched id={} name='{}' dur={}ms",
        song.id,
        song.name.as_deref().unwrap_or(""),
        dur_ms
    );
    Ok(Some((song.id, dur_ms)))
}

/// Fetch lyrics from NetEase by song ID.
async fn netease_fetch_lyrics(
    song_id: u64,
) -> Result<Option<String>, String> {
    let client = shared_client();
    let url = format!(
        "https://music.163.com/api/song/lyric?id={}&lv=1&tv=-1",
        song_id
    );

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            println!("[ebubfy-lyrics] [NetEase] lyrics conn error: {e}");
            return Ok(None);
        }
    };

    let status = resp.status();
    let body_text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            println!("[ebubfy-lyrics] [NetEase] lyrics read error: {e}");
            return Ok(None);
        }
    };

    if !status.is_success() {
        println!("[ebubfy-lyrics] [NetEase] lyrics HTTP {status}");
        return Ok(None);
    }

    let data: NetEaseLyricResponse = match serde_json::from_str(&body_text) {
        Ok(d) => d,
        Err(e) => {
            println!("[ebubfy-lyrics] [NetEase] lyrics JSON error: {e}");
            return Ok(None);
        }
    };

    let lrc_text = match data.lrc.and_then(|l| l.lyric) {
        Some(t) if !t.trim().is_empty() => t,
        _ => {
            println!("[ebubfy-lyrics] [NetEase] no lyrics in response");
            return Ok(None);
        }
    };

    Ok(Some(lrc_text))
}

async fn fetch_from_netease(
    artist: &str,
    title: &str,
    duration: Option<f64>,
) -> Result<Option<LyricsResult>, String> {
    let (song_id, _dur_ms) = match netease_search(artist, title).await? {
        Some(v) => v,
        None => return Ok(None),
    };

    let lrc_text = match netease_fetch_lyrics(song_id).await? {
        Some(t) => t,
        None => return Ok(None),
    };

    let trimmed = lrc_text.trim();
    let has_timestamps = trimmed.lines().any(|l| {
        l.starts_with('[') && l.contains(':')
    });

    println!(
        "[ebubfy-lyrics] [NetEase] lyrics ({} chars, synced={})",
        trimmed.len(),
        has_timestamps
    );

    Ok(Some(LyricsResult {
        body: if has_timestamps { strip_lrc_body(trimmed) } else { trimmed.to_string() },
        synced_lyrics: if has_timestamps { Some(trimmed.to_string()) } else { None },
        source: "netease".to_string(),
        provider: "netease".to_string(),
        language: None,
        is_synced: has_timestamps,
        confidence: if has_timestamps { 0.9 } else { 0.8 },
        duration,
    }))
}

/// Strip LRC timestamps from text, returning just the lyrics body.
fn strip_lrc_body(lrc: &str) -> String {
    lrc.lines()
        .map(|line| {
            let mut result = line;
            // Strip all [mm:ss.xx] tags
            while let Some(start) = result.find('[') {
                if let Some(end) = result[start..].find(']') {
                    let tag = &result[start..=start + end];
                    if tag.len() >= 3
                        && tag.as_bytes()[1].is_ascii_digit()
                        && tag.as_bytes()[2] == b':'
                    {
                        result = &result[start + end + 1..];
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
            result.trim()
        })
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

// ─── LRCLIB query variations helper ────────────────────────

/// Strip parenthetical info like "(feat. X)", "(Remix)", "[Official Video]" from a title.
fn strip_parens(s: &str) -> String {
    let mut result = s.to_string();
    // Remove content in parentheses that looks like metadata
    while let Some(open) = result.rfind('(') {
        if let Some(close) = result[open..].find(')') {
            let content = result[open + 1..open + close].to_lowercase();
            if content.starts_with("feat")
                || content.starts_with("ft.")
                || content.starts_with("ft ")
                || content.starts_with("remix")
                || content.starts_with("live")
                || content.starts_with("acoustic")
                || content.starts_with("radio")
                || content.starts_with("official")
                || content.starts_with("explicit")
            {
                result = format!("{}{}", &result[..open], &result[open + close + 1..]);
                result = result.trim().to_string();
            } else {
                break;
            }
        } else {
            break;
        }
    }
    result
}

// ─── Unified search ────────────────────────────────────────

/// Search for lyrics using multiple providers with smart query variations.
///
/// Provider chain:
///   1. LRCLIB /api/get  (exact match, highest quality synced LRC)
///   2. LRCLIB /api/search (fuzzy match, still synced LRC)
///   3. NetEase Cloud Music (free synced LRC, no API key)
///   4. LRCLIB with stripped parenthetical title
///   5. LRCLIB with first-word artist only
///   6. LRCLIB /api/search with title only
#[tauri::command]
pub async fn search_lyrics(
    query: String,
    duration: Option<f64>,
) -> Result<Option<LyricsResult>, String> {
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!(
        "[ebubfy-lyrics] search query='{}' duration={:?}",
        query, duration
    );

    let (artist, title) = text_clean::clean_query(&query);
    let lrclib_title = text_clean::title_for_lrclib(&query);
    println!(
        "[ebubfy-lyrics] Parsed: artist='{}' title='{}' lrclib_title='{}'",
        artist, title, lrclib_title
    );

    if title.is_empty() {
        println!("[ebubfy-lyrics] Empty title, aborting");
        return Ok(None);
    }

    // ── 1. LRCLIB /api/get with full artist + title + duration ──
    if !artist.is_empty() {
        println!("[ebubfy-lyrics] #1 LRCLIB /api/get (artist+title+duration)...");
        match fetch_from_lrclib(&artist, &lrclib_title, duration).await {
            Ok(Some(r)) => { println!("[ebubfy-lyrics] RESULT: #1 LRCLIB exact"); return Ok(Some(r)); }
            Ok(None) => println!("[ebubfy-lyrics] #1 no match"),
            Err(e) => println!("[ebubfy-lyrics] #1 error: {e}"),
        }

        // Retry without duration (YouTube duration often differs from canonical)
        println!("[ebubfy-lyrics] #1b LRCLIB /api/get (artist+title, no duration)...");
        match fetch_from_lrclib(&artist, &lrclib_title, None).await {
            Ok(Some(r)) => { println!("[ebubfy-lyrics] RESULT: #1b LRCLIB no-dur"); return Ok(Some(r)); }
            Ok(None) => println!("[ebubfy-lyrics] #1b no match"),
            Err(e) => println!("[ebubfy-lyrics] #1b error: {e}"),
        }
    }

    // ── 2. LRCLIB /api/search ──
    println!("[ebubfy-lyrics] #2 LRCLIB /api/search...");
    match fetch_from_lrclib_search(&artist, &lrclib_title, duration).await {
        Ok(Some(r)) => { println!("[ebubfy-lyrics] RESULT: #2 LRCLIB search"); return Ok(Some(r)); }
        Ok(None) => println!("[ebubfy-lyrics] #2 no match"),
        Err(e) => println!("[ebubfy-lyrics] #2 error: {e}"),
    }

    // ── 3. NetEase Cloud Music (free synced LRC) ──
    println!("[ebubfy-lyrics] #3 NetEase search...");
    match fetch_from_netease(&artist, &lrclib_title, duration).await {
        Ok(Some(r)) => { println!("[ebubfy-lyrics] RESULT: #3 NetEase"); return Ok(Some(r)); }
        Ok(None) => println!("[ebubfy-lyrics] #3 no match"),
        Err(e) => println!("[ebubfy-lyrics] #3 error: {e}"),
    }

    // ── 4. LRCLIB with stripped parenthetical title ──
    let stripped_title = strip_parens(&lrclib_title);
    if stripped_title != lrclib_title && !artist.is_empty() {
        println!("[ebubfy-lyrics] #4 LRCLIB (stripped title: '{}')...", stripped_title);
        match fetch_from_lrclib(&artist, &stripped_title, duration).await {
            Ok(Some(r)) => { println!("[ebubfy-lyrics] RESULT: #4 LRCLIB stripped"); return Ok(Some(r)); }
            Ok(None) => println!("[ebubfy-lyrics] #4 no match"),
            Err(e) => println!("[ebubfy-lyrics] #4 error: {e}"),
        }
        match fetch_from_lrclib(&artist, &stripped_title, None).await {
            Ok(Some(r)) => { println!("[ebubfy-lyrics] RESULT: #4b LRCLIB stripped no-dur"); return Ok(Some(r)); }
            Ok(None) => println!("[ebubfy-lyrics] #4b no match"),
            Err(e) => println!("[ebubfy-lyrics] #4b error: {e}"),
        }
    }

    // ── 5. LRCLIB with first-word artist only ──
    if !artist.is_empty() {
        let first_word = artist.split_whitespace().next().unwrap_or("");
        if !first_word.is_empty() && first_word.len() < artist.len() {
            println!("[ebubfy-lyrics] #5 LRCLIB (first-word artist: '{}')...", first_word);
            match fetch_from_lrclib(first_word, &lrclib_title, None).await {
                Ok(Some(r)) => { println!("[ebubfy-lyrics] RESULT: #5 LRCLIB first-word"); return Ok(Some(r)); }
                Ok(None) => println!("[ebubfy-lyrics] #5 no match"),
                Err(e) => println!("[ebubfy-lyrics] #5 error: {e}"),
            }
        }
    }

    // ── 6. LRCLIB /api/search with title only ──
    println!("[ebubfy-lyrics] #6 LRCLIB search (title only)...");
    match fetch_from_lrclib_search("", &lrclib_title, duration).await {
        Ok(Some(r)) => { println!("[ebubfy-lyrics] RESULT: #6 LRCLIB title-only"); return Ok(Some(r)); }
        Ok(None) => println!("[ebubfy-lyrics] #6 no match"),
        Err(e) => println!("[ebubfy-lyrics] #6 error: {e}"),
    }

    println!("[ebubfy-lyrics] No lyrics found from any provider");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    Ok(None)
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
