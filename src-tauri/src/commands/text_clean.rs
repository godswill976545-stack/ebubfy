/// Shared text-cleaning utilities for YouTube metadata and lyrics queries.
///
/// Consolidates the duplicate CHANNEL_SUFFIXES / clean_artist / clean_title
/// logic that previously existed in both `youtube.rs` and `lyrics.rs`.

// ─── Channel name suffixes to strip from artist names ───────────────────────

const CHANNEL_SUFFIXES: &[&str] = &[
    " - Topic", "- Topic", " - topic",
    "-VEVO", " - VEVO", "-vevo",
    " (Official)", " (Official Channel)",
    " Music", " Records", " Music TV",
    "VEVO", "vevo",
    "Officiel", "officiel", "OFFICIEL",
    "Official", "OFFICIAL",
    "Music",
];

// ─── Noise descriptors to strip from titles ─────────────────────────────────

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

// ─── Artist cleaning ────────────────────────────────────────────────────────

/// Clean an artist name: strip channel suffixes, feat. collaborators, etc.
pub fn clean_artist(raw: &str) -> String {
    let mut result = raw.trim().to_string();

    // Strip channel suffixes (VEVO, Topic, Official, etc.)
    for suffix in CHANNEL_SUFFIXES {
        if result.to_lowercase().ends_with(&suffix.to_lowercase()) {
            let cut = result.len() - suffix.len();
            result = result[..cut].trim().to_string();
            break;
        }
    }

    // Strip trailing suffixes with rfind (handles cases where endswith missed)
    for suffix in &[" - Topic", "VEVO", "-VEVO"] {
        if let Some(pos) = result.rfind(suffix) {
            if result[pos + suffix.len()..].trim().is_empty() {
                result = result[..pos].trim().to_string();
            }
        }
    }

    // Handle common artist variations
    if result.contains(" & ") {
        result = result.split(" & ").next().unwrap_or(&result).to_string();
    }
    if result.to_lowercase().contains(" ft. ") {
        result = result.split(" ft. ").next().unwrap_or(&result).to_string();
    }
    if result.to_lowercase().contains(" feat. ") {
        result = result.split(" feat. ").next().unwrap_or(&result).to_string();
    }
    if result.contains(" (feat.") || result.contains(" (ft.") {
        if let Some(pos) = result.find(" (feat.") {
            result = result[..pos].trim().to_string();
        } else if let Some(pos) = result.find(" (ft.") {
            result = result[..pos].trim().to_string();
        }
    }

    result
}

// ─── Title cleaning (aggressive — for YouTube display) ──────────────────────

/// Clean a title aggressively: strip noise parentheticals, brackets, and
/// common suffixes like "Remix", "Live", "Radio Edit", etc.
pub fn clean_title(raw: &str) -> String {
    let mut title = raw.trim().to_string();

    // Strip trailing noise parentheticals: "Song (Official Video)" → "Song"
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

    // Strip trailing noise bracket groups: "Song [Official Audio]" → "Song"
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

    // Handle common title variations
    let lower = title.to_lowercase();
    for pattern in &[
        " (remix)", " (live)", " (acoustic)", " (radio edit)",
        " (explicit)", " (clean)",
    ] {
        if let Some(pos) = lower.find(pattern) {
            title = title[..pos].trim().to_string();
            break;
        }
    }

    // "Song - Single" / "Song - EP"
    if lower.ends_with(" - single") {
        title = title[..title.len() - 8].trim().to_string();
    } else if lower.ends_with(" - ep") {
        title = title[..title.len() - 4].trim().to_string();
    }

    // "Song (feat. Artist)" / "Song (ft. Artist)"
    if title.contains(" (feat.") || title.contains(" (ft.") {
        if let Some(pos) = title.find(" (feat.") {
            title = title[..pos].trim().to_string();
        } else if let Some(pos) = title.find(" (ft.") {
            title = title[..pos].trim().to_string();
        }
    }

    title
}

// ─── Title cleaning (gentle — for lyrics matching) ──────────────────────────

/// Clean a title gently for lyrics matching: only strip brackets and stop
/// at feat/ft markers. Keeps more of the original title for better API matching.
#[allow(dead_code)]
pub fn clean_title_gentle(raw: &str) -> String {
    let cleaned = raw
        .replace(|c: char| c == '(' || c == ')' || c == '[' || c == ']', " ")
        .replace(|c: char| c == '\u{FF08}' || c == '\u{FF09}' || c == '\u{FF3B}' || c == '\u{FF3D}', " ");

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

// ─── Separator finding ──────────────────────────────────────────────────────

/// Find the first YouTube-style "artist - title" separator in a string.
/// Returns the byte index and byte length of the separator, preferring the
/// ASCII hyphen first, then en-dash, then em-dash.
pub fn find_separator(q: &str) -> Option<(usize, usize)> {
    q.find(" - ")
        .map(|pos| (pos, " - ".len()))
        .or_else(|| q.find(" \u{2013} ").map(|pos| (pos, " \u{2013} ".len())))
        .or_else(|| q.find(" \u{2014} ").map(|pos| (pos, " \u{2014} ".len())))
}

// ─── Full query parsing ─────────────────────────────────────────────────────

/// Parse artist + title from a YouTube-style query.
/// Uses first " - " separator, but also handles cases where title contains artist.
/// Returns (artist, title) with cleaned, standardized formatting.
pub fn clean_query(query: &str) -> (String, String) {
    let q = query.trim();

    if let Some((pos, sep_len)) = find_separator(q) {
        let raw_artist = q[..pos].trim();
        let raw_title = q[pos + sep_len..].trim();

        let artist = clean_artist(raw_artist);
        let title = clean_title(raw_title);

        // If the cleaned title starts with the cleaned artist, remove the
        // artist prefix to avoid duplication (e.g., "CKay CKay - BODY")
        if !artist.is_empty() && !title.is_empty()
            && title.to_lowercase().starts_with(&artist.to_lowercase())
        {
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

    // No separator — assume the whole thing is the title
    (String::new(), clean_title(q))
}

/// Extract a cleaned title from the raw query for LRCLIB.
/// Keeps more of the original title than `clean_title` for better matching.
pub fn title_for_lrclib(query: &str) -> String {
    let q = query.trim();
    if let Some((pos, sep_len)) = find_separator(q) {
        q[pos + sep_len..].trim().to_string()
    } else {
        q.to_string()
    }
}

// ─── Extract artist/title from YouTube metadata ─────────────────────────────

/// Extract (artist, title) from a YouTube-style "Artist - Title" string.
/// Returns None if there's no separator or if the parts are too short.
pub fn parse_artist_title(raw: &str) -> Option<(String, String)> {
    let q = raw.trim();
    let (sep_pos, sep_len) = find_separator(q)?;

    let raw_artist = q[..sep_pos].trim();
    let raw_title = q[sep_pos + sep_len..].trim();

    if raw_title.is_empty() || raw_artist.is_empty() {
        return None;
    }
    if raw_artist.len() > 50 {
        return None;
    }

    Some((raw_artist.to_string(), raw_title.to_string()))
}
