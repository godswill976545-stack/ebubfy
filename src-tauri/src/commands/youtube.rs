use serde::{Deserialize, Serialize};
use std::process::{Output, Stdio};
use std::time::Duration;

use super::ytdlp::ytdlp_command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VideoResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub thumbnail: String,
    pub duration: Option<String>,
    pub duration_seconds: Option<f64>,
    pub view_count: Option<String>,
    pub album: Option<String>,
    pub release_year: Option<i32>,
}

// ─── Title / artist cleaning ────────────────────────────────────

/// Channel name suffixes to strip from artist field.
const CHANNEL_SUFFIXES: &[&str] = &[
    " - Topic", "- Topic", " - topic",
    "-VEVO", " - VEVO",
    " (Official)", " (Official Channel)",
    " Music", " Records", " Music TV",
    "VEVO",
];

/// Noise descriptors to strip from titles (parentheses + brackets).
const TITLE_NOISE: &[&str] = &[
    "official video", "official music video", "official audio",
    "official lyric video", "official visualizer", "official trailer",
    "clip officiel", "clip", "audio officiel",
    "music video", "audio", "lyric video", "visualizer",
    "lyrics", "vevo", "remaster", "remastered",
    "live performance", "live from", "live at",
    "explicit", "clean version", "radio edit",
    "hd", "4k", "1080p", "720p",
    "2024", "2023", "2022", "2021", "2020", "2019", "2018",
    "ft. ", "feat. ",
];

/// Clean an artist name from YouTube channel metadata.
/// Strips "- Topic", "VEVO", "Official", etc.
/// Also handles common artist name variations (Feat., ft., &)
fn clean_artist(raw: &str) -> String {
    let mut result = raw.trim().to_string();

    // Strip channel suffixes (VEVO, Topic, Official, etc.)
    for suffix in CHANNEL_SUFFIXES {
        if result.to_lowercase().ends_with(&suffix.to_lowercase()) {
            let cut = result.len() - suffix.len();
            result = result[..cut].trim().to_string();
            break;
        }
    }

    // Strip trailing " - Topic", "VEVO" etc with rfind
    for suffix in &[" - Topic", "VEVO", "-VEVO"] {
        if let Some(pos) = result.rfind(suffix) {
            if result[pos + suffix.len()..].trim().is_empty() {
                result = result[..pos].trim().to_string();
            }
        }
    }

    // Handle common artist variations
    // "Artist & Artist" → "Artist"
    if result.contains(" & ") {
        result = result.split(" & ").next().unwrap_or(&result).to_string();
    }
    
    // "Artist ft. Artist" → "Artist"
    if result.to_lowercase().contains(" ft. ") {
        result = result.split(" ft. ").next().unwrap_or(&result).to_string();
    }
    
    // "Artist feat. Artist" → "Artist"
    if result.to_lowercase().contains(" feat. ") {
        result = result.split(" feat. ").next().unwrap_or(&result).to_string();
    }
    
    // "Artist (feat. Artist)" → "Artist"
    if result.contains(" (feat.") || result.contains(" (ft.") {
        if let Some(pos) = result.find(" (feat.") {
            result = result[..pos].trim().to_string();
        } else if let Some(pos) = result.find(" (ft.") {
            result = result[..pos].trim().to_string();
        }
    }

    result
}

/// Clean a title: strip noise descriptors from parentheses/brackets,
/// and extract the real song title if it contains "Artist - Title".
fn clean_title(raw: &str) -> String {
    let mut title = raw.trim().to_string();

    // 1. If title contains " - ", the part BEFORE the dash might be the artist
    // and the part AFTER is the real title. We handle artist extraction separately.
    // Here we just clean the full string.

    // 2. Strip trailing noise parentheticals: "Song (Official Video)" → "Song"
    let has_noise_paren = |s: &str| -> bool {
        if let Some(open_idx) = s.rfind('(') {
            if s[open_idx..].ends_with(')') {
                let content = s[open_idx + 1..s.len() - 1].trim().to_lowercase();
                return TITLE_NOISE.iter().any(|n| content.contains(n));
            }
        }
        false
    };

    loop {
        let trimmed = title.trim().to_string();
        if trimmed.is_empty() { break; }
        if has_noise_paren(&trimmed) {
            if let Some(open_idx) = trimmed.rfind('(') {
                title = trimmed[..open_idx].trim().to_string();
                continue;
            }
        }
        break;
    }

    // 3. Strip trailing noise bracket groups: "Song [Official Audio]" → "Song"
    let has_noise_bracket = |s: &str| -> bool {
        if let Some(open_idx) = s.rfind('[') {
            if s[open_idx..].ends_with(']') {
                let content = s[open_idx + 1..s.len() - 1].trim().to_lowercase();
                return TITLE_NOISE.iter().any(|n| content.contains(n));
            }
        }
        false
    };

    loop {
        let trimmed = title.trim().to_string();
        if trimmed.is_empty() { break; }
        if has_noise_bracket(&trimmed) {
            if let Some(open_idx) = trimmed.rfind('[') {
                title = trimmed[..open_idx].trim().to_string();
                continue;
            }
        }
        break;
    }

    // 4. Handle common title variations
    // "Song (Remix)" → "Song"
    if title.to_lowercase().contains(" (remix)") {
        title = title.split(" (remix)").next().unwrap_or(&title).to_string();
    }
    
    // "Song (Live)" → "Song"
    if title.to_lowercase().contains(" (live)") {
        title = title.split(" (live)").next().unwrap_or(&title).to_string();
    }
    
    // "Song (Acoustic)" → "Song"
    if title.to_lowercase().contains(" (acoustic)") {
        title = title.split(" (acoustic)").next().unwrap_or(&title).to_string();
    }
    
    // "Song (Radio Edit)" → "Song"
    if title.to_lowercase().contains(" (radio edit)") {
        title = title.split(" (radio edit)").next().unwrap_or(&title).to_string();
    }
    
    // "Song (Explicit)" → "Song"
    if title.to_lowercase().contains(" (explicit)") {
        title = title.split(" (explicit)").next().unwrap_or(&title).to_string();
    }
    
    // "Song (Clean)" → "Song"
    if title.to_lowercase().contains(" (clean)") {
        title = title.split(" (clean)").next().unwrap_or(&title).to_string();
    }
    
    // "Song - Single" → "Song"
    if title.to_lowercase().ends_with(" - single") {
        title = title[..title.len() - 8].trim().to_string();
    }
    
    // "Song - EP" → "Song"
    if title.to_lowercase().ends_with(" - ep") {
        title = title[..title.len() - 4].trim().to_string();
    }
    
    // "Song (feat. Artist)" → "Song"
    if title.contains(" (feat.") || title.contains(" (ft.") {
        if let Some(pos) = title.find(" (feat.") {
            title = title[..pos].trim().to_string();
        } else if let Some(pos) = title.find(" (ft.") {
            title = title[..pos].trim().to_string();
        }
    }

    title
}

/// Extract (artist, title) from a YouTube-style "Artist - Title" string.
/// Returns None if there's no separator or if the parts are too short.
fn parse_artist_title(raw: &str) -> Option<(String, String)> {
    let q = raw.trim();
    // Find the first common YouTube-style separator: " - ", " – " (en-dash),
    // or " — " (em-dash). Use the actual byte length of the matched separator
    // so we never slice into the middle of a multi-byte UTF-8 character.
    let (sep_pos, sep_len) = if let Some(pos) = q.find(" - ") {
        (pos, " - ".len())
    } else if let Some(pos) = q.find(" – ") {
        (pos, " – ".len())
    } else if let Some(pos) = q.find(" — ") {
        (pos, " — ".len())
    } else {
        return None;
    };

    let raw_artist = q[..sep_pos].trim();
    let raw_title = q[sep_pos + sep_len..].trim();

    // Minimum length checks — skip if either part is suspiciously short
    // (YouTube channel names like "CKay" are valid artists)
    if raw_title.is_empty() || raw_artist.is_empty() {
        return None;
    }

    // If the "artist" part is very long (>40 chars), it's probably not an artist
    // (might be a description line like "Subscribe to our channel - Song Name")
    if raw_artist.len() > 50 {
        return None;
    }

    Some((raw_artist.to_string(), raw_title.to_string()))
}

/// Full metadata cleaning pipeline: given the raw uploader and title from yt-dlp,
/// return a clean (artist, title) pair.
fn clean_metadata(uploader: &str, raw_title: &str) -> (String, String) {
    let clean_uploader = clean_artist(uploader);

    // Try to parse "Artist - Title" from the raw title
    if let Some((parsed_artist, parsed_title)) = parse_artist_title(raw_title) {
        let clean_artist_name = clean_artist(&parsed_artist);
        let clean_title_name = clean_title(&parsed_title);
        // Use the parsed artist if it looks better than the uploader
        // (uploader is often just the channel name, parsed artist is from the title)
        if !clean_artist_name.is_empty() && clean_artist_name != "Unknown" {
            return (clean_artist_name, clean_title_name);
        }
    }

    // Fallback: use uploader as artist, clean the title
    let clean_title_name = clean_title(raw_title);
    let artist = if clean_uploader.is_empty() {
        "Unknown Artist".to_string()
    } else {
        clean_uploader
    };

    (artist, clean_title_name)
}

/// Run a yt-dlp command with a hard timeout so a hanging search doesn't freeze the UI.
/// Returns the raw `Output` or a timeout/error string.
async fn run_ytdlp_with_timeout(
    mut cmd: std::process::Command,
    timeout_secs: u64,
) -> Result<Output, String> {
    let timeout = Duration::from_secs(timeout_secs);

    match tokio::time::timeout(timeout, tokio::task::spawn_blocking(move || cmd.output())).await
    {
        Ok(Ok(Ok(output))) => Ok(output),
        Ok(Ok(Err(io_err))) => Err(format!("yt-dlp is not available. Error: {}", io_err)),
        Ok(Err(join_err)) => Err(format!("yt-dlp task failed: {}", join_err)),
        Err(_) => Err(format!(
            "Search timed out after {}s. Check your network or try again.",
            timeout_secs
        )),
    }
}

/// Check if a result looks like music (not podcast, not long video, not compilation).
///
/// This filter runs AFTER yt-dlp's `--match-filter` which already restricts to
/// `category_id=10 & duration 30s-600s`, so we only need to catch non-music that
/// slipped through YouTube's category tagging.
fn is_music_content(title: &str, artist: &str, duration_secs: Option<f64>) -> bool {
    let title_lower = title.to_lowercase();
    let artist_lower = artist.to_lowercase();

    // ── Channel-level exclusions ──
    // These are strong signals that a channel doesn't host music.
    if artist_lower.contains("podcast")
        || artist_lower.contains("talk radio")
        || artist_lower.contains("audiobook")
        || artist_lower.contains("audiobooks")
    {
        return false;
    }

    // ── Title-based exclusions: non-music content ──
    // Only filter titles that are clearly NOT music at all.
    // Legitimate music variants (remixes, live, acoustic, instrumentals, lyric
    // videos, official audio/video, demos) are intentionally kept.
    let non_music_patterns = [
        // Talk / long-form
        "podcast",
        "interview",
        "talk show",
        "documentary",
        "tutorial",
        "how to",
        "news",
        "vlog",
        // Visual / non-audio content
        "gaming",
        "let's play",
        "behind the scenes",
        "making of",
        "reaction",
        "review",
        // Ambient / utility audio (not music)
        "ambient sounds",
        "sleep sounds",
        "white noise",
        "brown noise",
        "rain sounds",
        "asmr",
        "meditation",
        "breathing exercise",
    ];

    for pattern in &non_music_patterns {
        if title_lower.contains(pattern) {
            return false;
        }
    }

    // ── Duration: skip mega mixes / compilations / hour-long content ──
    // Individual songs rarely exceed 10 minutes; longer = likely a mix/compilation.
    if let Some(dur) = duration_secs {
        if dur > 900.0 {
            return false;
        }
    }

    // ── Compilation / mega-mix detection ──
    // Catch titles like "Top 100 Songs of 2024", "1 Hour Best Mix", "Full Album"
    // without over-matching real song titles.
    let compilation_patterns = [
        "top 100",
        "top 50",
        "best songs of",
        "hits of",
        "full album",
        "all songs",
        "every song",
        "complete collection",
        "mega mix",
        "super mix",
        "nonstop",
    ];

    for pattern in &compilation_patterns {
        if title_lower.contains(pattern) {
            return false;
        }
    }

    true
}

#[tauri::command]
pub async fn search_youtube(
    _app: tauri::AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<VideoResult>, String> {
    let limit = limit.unwrap_or(15);

    // Use yt-dlp to search YouTube, filtering by music category and duration.
    // Tuned for reliability: no format checking, flat playlist, geo bypass.
    let mut cmd = ytdlp_command();
    cmd.args([
        "--dump-json",
        "--flat-playlist",
        "--no-download",
        "--no-check-formats",
        "--no-abort-on-error",
        "--geo-bypass",
        "--default-search",
        "ytsearch",
        "--match-filter",
        "duration<900 & duration>15",
        &format!("ytsearch{}:{}", limit, query),
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    let output = run_ytdlp_with_timeout(cmd, 12).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let short_err = stderr.lines().find(|l| l.contains("ERROR")).unwrap_or(&stderr);
        return Err(format!("Search request failed. {}", short_err.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();

    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            let id = json["id"].as_str().unwrap_or("").to_string();
            let raw_title = json["title"].as_str().unwrap_or("Unknown").to_string();
            let uploader = json["uploader"].as_str()
                .or_else(|| json["channel"].as_str())
                .unwrap_or("Unknown Artist")
                .to_string();

            // Clean metadata: extract artist from "Artist - Title" pattern,
            // strip channel suffixes ("- Topic", "VEVO", etc), strip noise
            let (artist, title) = clean_metadata(&uploader, &raw_title);

            let duration_seconds = json["duration"].as_f64();

            // Secondary filter: skip non-music content that slipped through
            if !is_music_content(&title, &artist, duration_seconds) {
                continue;
            }

            let thumbnail = format!("https://img.youtube.com/vi/{}/maxresdefault.jpg", id);

            let duration = duration_seconds.map(|d| {
                let mins = (d as u64) / 60;
                let secs = (d as u64) % 60;
                format!("{}:{:02}", mins, secs)
            });

            let view_count = json["view_count"].as_f64().map(|v| {
                if v >= 1_000_000.0 {
                    format!("{:.1}M views", v / 1_000_000.0)
                } else if v >= 1_000.0 {
                    format!("{:.1}K views", v / 1_000.0)
                } else {
                    format!("{} views", v as u64)
                }
            });

            results.push(VideoResult {
                id,
                title,
                artist,
                thumbnail,
                duration,
                duration_seconds,
                view_count,
                album: None,
                release_year: None,
            });
        }
    }

    Ok(results)
}

/// Extract album name from yt-dlp JSON metadata
fn extract_album(json: &serde_json::Value) -> Option<String> {
    // Try direct "album" field first (most reliable from YouTube Music)
    if let Some(album) = json["album"].as_str() {
        let album = album.trim();
        if !album.is_empty() && album != "-" {
            return Some(album.to_string());
        }
    }
    
    // Try "album_artist" as fallback context
    if let Some(aa) = json["album_artist"].as_str() {
        let aa = aa.trim();
        if !aa.is_empty() && aa != "-" {
            // Some videos have album info embedded in webpage metadata
            if let Some(webpage_url) = json["webpage_url"].as_str() {
                // YouTube Music URLs often contain /album/ in the path
                if webpage_url.contains("/album/") {
                    return Some(aa.to_string());
                }
            }
        }
    }
    
    // Try "playlist_title" if this was part of a playlist/album
    if let Some(pl) = json["playlist_title"].as_str() {
        let pl = pl.trim();
        if !pl.is_empty() && pl != "-" && !pl.to_lowercase().contains("mix") && !pl.to_lowercase().contains("podcast") {
            return Some(pl.to_string());
        }
    }
    
    None
}

/// Extract release year from yt-dlp JSON metadata
fn extract_release_year(json: &serde_json::Value) -> Option<i32> {
    // Try "release_year" field
    if let Some(year) = json["release_year"].as_i64() {
        if year >= 1900 && year <= 2100 {
            return Some(year as i32);
        }
    }
    
    // Try "release_date" field (format: YYYYMMDD)
    if let Some(date_str) = json["release_date"].as_str() {
        if date_str.len() >= 4 {
            if let Ok(year) = date_str[..4].parse::<i32>() {
                if year >= 1900 && year <= 2100 {
                    return Some(year);
                }
            }
        }
    }
    
    // Try "upload_date" field as fallback
    if let Some(date_str) = json["upload_date"].as_str() {
        if date_str.len() >= 4 {
            if let Ok(year) = date_str[..4].parse::<i32>() {
                if year >= 1900 && year <= 2100 {
                    return Some(year);
                }
            }
        }
    }
    
    None
}

#[tauri::command]
pub async fn get_video_info(video_id: String) -> Result<VideoResult, String> {
    let url = format!("https://www.youtube.com/watch?v={}", video_id);

    let mut cmd = ytdlp_command();
    cmd.args([
        "--dump-json",
        "--no-download",
        "--no-check-formats",
        "--no-abort-on-error",
        "--geo-bypass",
        &url,
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    let output = run_ytdlp_with_timeout(cmd, 15).await?;

    if !output.status.success() {
        return Err("Failed to get video info".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    let id = json["id"].as_str().unwrap_or(&video_id).to_string();
    let title = json["title"].as_str().unwrap_or("Unknown").to_string();
    let artist = json["uploader"].as_str()
        .or_else(|| json["channel"].as_str())
        .unwrap_or("Unknown Artist")
        .to_string();

    // Enriched metadata from full video info
    let album = extract_album(&json);
    let release_year = extract_release_year(&json);

    let thumbnail = format!("https://img.youtube.com/vi/{}/maxresdefault.jpg", id);

    let duration = json["duration"].as_f64().map(|d| {
        let mins = (d as u64) / 60;
        let secs = (d as u64) % 60;
        format!("{}:{:02}", mins, secs)
    });

    let duration_seconds = json["duration"].as_f64();

    let view_count = json["view_count"].as_f64().map(|v| {
        if v >= 1_000_000.0 {
            format!("{:.1}M views", v / 1_000_000.0)
        } else if v >= 1_000.0 {
            format!("{:.1}K views", v / 1_000.0)
        } else {
            format!("{} views", v as u64)
        }
    });

    Ok(VideoResult {
        id,
        title,
        artist,
        thumbnail,
        duration,
        duration_seconds,
        view_count,
        album,
        release_year,
    })
}

#[tauri::command]
pub async fn search_artists(query: String, limit: Option<usize>) -> Result<Vec<VideoResult>, String> {
    let limit = limit.unwrap_or(8);

    // Use yt-dlp to search YouTube channels/artists
    let mut cmd = ytdlp_command();
    cmd.args([
        "--dump-json",
        "--flat-playlist",
        "--no-download",
        "--no-check-formats",
        "--no-abort-on-error",
        "--geo-bypass",
        "--default-search",
        "ytsearch",
        "--match-filter",
        "duration<900 & duration>15",
        &format!("ytsearch{}:{} artist channel", limit, query),
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    let output = run_ytdlp_with_timeout(cmd, 12).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let short_err = stderr.lines().find(|l| l.contains("ERROR")).unwrap_or(&stderr);
        return Err(format!("Search request failed. {}", short_err.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();

    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            let id = json["id"].as_str().unwrap_or("").to_string();
            let title = json["title"].as_str().unwrap_or("Unknown").to_string();
            let artist = json["uploader"].as_str()
                .or_else(|| json["channel"].as_str())
                .unwrap_or("Unknown Artist")
                .to_string();

            let duration_seconds = json["duration"].as_f64();

            // Skip non-music content
            if !is_music_content(&title, &artist, duration_seconds) {
                continue;
            }

            let thumbnail = format!("https://img.youtube.com/vi/{}/maxresdefault.jpg", id);

            let duration = duration_seconds.map(|d| {
                let mins = (d as u64) / 60;
                let secs = (d as u64) % 60;
                format!("{}:{:02}", mins, secs)
            });

            let view_count = json["view_count"].as_f64().map(|v| {
                if v >= 1_000_000.0 {
                    format!("{:.1}M views", v / 1_000_000.0)
                } else if v >= 1_000.0 {
                    format!("{:.1}K views", v / 1_000.0)
                } else {
                    format!("{} views", v as u64)
                }
            });

            results.push(VideoResult {
                id,
                title,
                artist,
                thumbnail,
                duration,
                duration_seconds,
                view_count,
                album: None,
                release_year: None,
            });
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn get_artist_songs(artist_channel_url: String) -> Result<Vec<VideoResult>, String> {
    let mut cmd = ytdlp_command();
    cmd.args([
        "--dump-json",
        "--flat-playlist",
        "--no-download",
        "--no-check-formats",
        "--no-abort-on-error",
        "--geo-bypass",
        &artist_channel_url,
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    let output = run_ytdlp_with_timeout(cmd, 18).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let short_err = stderr.lines().find(|l| l.contains("ERROR")).unwrap_or(&stderr);
        return Err(format!("Request failed. {}", short_err.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();

    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            let id = json["id"].as_str().unwrap_or("").to_string();
            let title = json["title"].as_str().unwrap_or("Unknown").to_string();
            let artist = json["uploader"].as_str()
                .or_else(|| json["channel"].as_str())
                .unwrap_or("Unknown Artist")
                .to_string();

            let duration_seconds = json["duration"].as_f64();

            // Skip non-music content
            if !is_music_content(&title, &artist, duration_seconds) {
                continue;
            }

            let thumbnail = format!("https://img.youtube.com/vi/{}/maxresdefault.jpg", id);

            let duration = duration_seconds.map(|d| {
                let mins = (d as u64) / 60;
                let secs = (d as u64) % 60;
                format!("{}:{:02}", mins, secs)
            });

            let view_count = json["view_count"].as_f64().map(|v| {
                if v >= 1_000_000.0 {
                    format!("{:.1}M views", v / 1_000_000.0)
                } else if v >= 1_000.0 {
                    format!("{:.1}K views", v / 1_000.0)
                } else {
                    format!("{} views", v as u64)
                }
            });

            results.push(VideoResult {
                id,
                title,
                artist,
                thumbnail,
                duration,
                duration_seconds,
                view_count,
                album: None,
                release_year: None,
            });
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_artist_title_ascii() {
        assert_eq!(
            parse_artist_title("Artist Name - Song Title"),
            Some(("Artist Name".to_string(), "Song Title".to_string()))
        );
    }

    #[test]
    fn test_parse_artist_title_en_dash() {
        // This was the exact crash case: '–' is a 3-byte UTF-8 en-dash.
        assert_eq!(
            parse_artist_title("Artist Name – Song Title"),
            Some(("Artist Name".to_string(), "Song Title".to_string()))
        );
    }

    #[test]
    fn test_parse_artist_title_em_dash() {
        assert_eq!(
            parse_artist_title("Artist Name — Song Title"),
            Some(("Artist Name".to_string(), "Song Title".to_string()))
        );
    }

    #[test]
    fn test_parse_artist_title_no_separator() {
        assert_eq!(parse_artist_title("Just a song title"), None);
    }

    #[test]
    fn test_clean_metadata_en_dash() {
        let (artist, title) = clean_metadata("Some Channel", "CKay – love nwantiti");
        assert_eq!(artist, "CKay");
        assert_eq!(title, "love nwantiti");
    }
}
