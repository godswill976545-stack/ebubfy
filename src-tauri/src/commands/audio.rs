use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;

use super::ytdlp::ytdlp_command;

#[derive(Debug, Serialize, Deserialize)]
pub struct LyricLine {
    pub time: f64,
    pub text: String,
}

#[tauri::command]
pub async fn get_stream_url(video_id: String) -> Result<String, String> {
    let url = format!("https://www.youtube.com/watch?v={}", video_id);

    println!("[ebubfy-stream] Getting stream URL for: {}", video_id);

    // Format selection: prefer formats WebView2/Chromium can decode.
    // m4a (AAC/MP4) is universally supported. webm/opus often fails in <audio>.
    let format = "bestaudio[ext=m4a]/bestaudio[acodec=mp4a]/bestaudio[acodec=aac]/bestaudio[ext=mp3]/bestaudio[acodec=mp3]/bestaudio";

    let child = ytdlp_command()
        .args(["-f", format, "--get-url", "--no-warnings", &url])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    // Save PID before moving child into spawn_blocking
    let child_pid = child.id();

    // Wait with a 30-second timeout
    let timeout_secs = 30u64;
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        tokio::task::spawn_blocking(move || child.wait_with_output()),
    )
    .await;

    match result {
        Ok(Ok(Ok(output))) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                println!(
                    "[ebubfy-stream] yt-dlp FAILED (exit {:?}): {}",
                    output.status.code(),
                    stderr
                );
                return Err(format!("yt-dlp failed: {}", stderr));
            }

            // Log interesting stderr lines
            let stderr_text = String::from_utf8_lossy(&output.stderr);
            for line in stderr_text.lines() {
                let l = line.trim();
                if !l.is_empty()
                    && (l.contains("[info]")
                        || l.contains("format")
                        || l.contains("Merging")
                        || l.contains("Destination"))
                {
                    println!("[ebubfy-stream] yt-dlp: {}", l);
                }
            }

            let stream_url = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();

            if stream_url.is_empty() {
                println!("[ebubfy-stream] No stream URL found in output");
                return Err("No stream URL found".to_string());
            }

            // Detect audio format from URL
            let format_hint = if stream_url.contains("mime=audio%2Fmp4")
                || stream_url.contains("mime=audio/mp4")
            {
                "aac/mp4"
            } else if stream_url.contains("mime=audio%2Fwebm")
                || stream_url.contains("mime=audio/webm")
            {
                "opus/webm"
            } else if stream_url.contains("mime=audio/mpeg") {
                "mp3"
            } else {
                "unknown"
            };

            println!(
                "[ebubfy-stream] Got URL ({} chars, format={}) for: {}",
                stream_url.len(),
                format_hint,
                video_id
            );
            Ok(stream_url)
        }
        Ok(Ok(Err(e))) => Err(format!("Failed to read yt-dlp output: {}", e)),
        Ok(Err(e)) => Err(format!("yt-dlp task failed: {}", e)),
        Err(_) => {
            // Timeout -- kill the child process by PID
            println!(
                "[ebubfy-stream] yt-dlp timed out after {}s, killing PID {}...",
                timeout_secs, child_pid
            );
            #[cfg(target_os = "windows")]
            {
                use std::process::Command;
                let _ = Command::new("taskkill")
                    .args(["/F", "/PID", &child_pid.to_string(), "/T"])
                    .output();
            }
            #[cfg(not(target_os = "windows"))]
            {
                unsafe {
                    libc::kill(child_pid as i32, libc::SIGKILL);
                }
            }
            Err(format!("yt-dlp timed out after {}s", timeout_secs))
        }
    }
}

// ─── YouTube captions ─────────────────────────────────────

fn get_lyrics_dir() -> PathBuf {
    let data_dir = if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
    } else if cfg!(target_os = "macos") {
        std::env::var("HOME")
            .map(|p| PathBuf::from(p).join("Library/Application Support"))
            .unwrap_or_else(|_| PathBuf::from("."))
    } else {
        std::env::var("HOME")
            .map(|p| PathBuf::from(p).join(".local/share"))
            .unwrap_or_else(|_| PathBuf::from("."))
    };
    data_dir.join("ebubfy").join("lyrics")
}

fn list_available_subs(video_id: &str) -> Vec<String> {
    let url = format!("https://www.youtube.com/watch?v={}", video_id);
    let output = match ytdlp_command()
        .args(["--list-subs", "--skip-download", &url])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(o) => o,
        Err(_) => return vec![],
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut langs = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("Language")
            || trimmed.starts_with("[info]")
        {
            continue;
        }
        if let Some(lang_code) = trimmed.split_whitespace().next() {
            if lang_code.len() >= 2
                && !lang_code.starts_with('-')
                && !lang_code.contains('[')
            {
                langs.push(lang_code.to_string());
            }
        }
    }
    langs
}

fn pick_best_language(available: &[String], preferred: &str) -> String {
    let preferred_lower = preferred.to_lowercase();
    for lang in available {
        if lang.to_lowercase() == preferred_lower {
            return lang.clone();
        }
    }
    for lang in available {
        let lang_lower = lang.to_lowercase();
        if lang_lower.starts_with(&preferred_lower)
            || preferred_lower.starts_with(lang_lower.split('-').next().unwrap_or(""))
        {
            return lang.clone();
        }
    }
    let fallback_order = [
        "en", "fr", "es", "de", "pt", "it", "ja", "ko", "zh", "ar", "ru", "nl", "pl",
    ];
    for fallback in &fallback_order {
        for lang in available {
            let lang_lower = lang.to_lowercase();
            if lang_lower.starts_with(fallback) || lang_lower == *fallback {
                return lang.clone();
            }
        }
    }
    available.first().cloned().unwrap_or_else(|| "en".to_string())
}

#[tauri::command]
pub async fn get_video_captions(
    video_id: String,
    preferred_language: String,
) -> Result<Vec<LyricLine>, String> {
    let temp_dir = std::env::temp_dir().join("ebubfy_sub");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    let available = list_available_subs(&video_id);
    if available.is_empty() {
        return Ok(vec![]);
    }

    let best_lang = pick_best_language(&available, &preferred_language);
    let url = format!("https://www.youtube.com/watch?v={}", video_id);
    let output_template = temp_dir
        .join("%(id)s.%(ext)s")
        .to_str()
        .unwrap_or("")
        .to_string();

    let _ = ytdlp_command()
        .args([
            "--write-auto-sub",
            "--write-sub",
            "--sub-lang",
            &best_lang,
            "--skip-download",
            "--sub-format",
            "json3",
            "-o",
            &output_template,
            &url,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    let path = temp_dir.join(format!("{}.{}.json3", video_id, best_lang));
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            let _ = fs::remove_file(&path);
            if let Ok(lines) = parse_json3_content(&content) {
                if !lines.is_empty() {
                    return Ok(lines);
                }
            }
        }
    }

    if let Ok(entries) = fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with(&format!("{}.", video_id)) && name_str.ends_with(".json3") {
                if let Ok(content) = fs::read_to_string(entry.path()) {
                    let _ = fs::remove_file(entry.path());
                    if let Ok(lines) = parse_json3_content(&content) {
                        if !lines.is_empty() {
                            return Ok(lines);
                        }
                    }
                }
            }
        }
    }
    Ok(vec![])
}

fn parse_json3_content(content: &str) -> Result<Vec<LyricLine>, String> {
    let json: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("Failed to parse json3: {}", e))?;

    let events = match json["events"].as_array() {
        Some(e) => e,
        None => return Ok(vec![]),
    };

    let mut lines: Vec<LyricLine> = Vec::new();
    for event in events {
        let segs = match event["segs"].as_array() {
            Some(s) => s,
            None => continue,
        };
        let has_text = segs.iter().any(|seg| {
            seg["utf8"]
                .as_str()
                .map_or(false, |t| !t.trim().is_empty() && t != "\n")
        });
        if !has_text {
            continue;
        }
        let start_ms = event["tStartMs"].as_f64().unwrap_or(0.0);
        let time = start_ms / 1000.0;
        let text: String = segs
            .iter()
            .filter_map(|seg| seg["utf8"].as_str())
            .filter(|t| *t != "\n")
            .collect::<Vec<_>>()
            .join("")
            .trim()
            .to_string();

        if text.is_empty()
            || text == "[Musique]"
            || text == "[Music]"
            || text == "[M\u{00fa}ica]"
            || text == "[\u{266a}]"
        {
            continue;
        }
        lines.push(LyricLine { time, text });
    }
    Ok(lines)
}

// ─── Lyrics file persistence ──────────────────────────────

#[tauri::command]
pub async fn save_lyrics_file(_app: tauri::AppHandle, video_id: String, content: String) -> Result<(), String> {
    let lyrics_dir = get_lyrics_dir();
    fs::create_dir_all(&lyrics_dir)
        .map_err(|e| format!("Failed to create lyrics dir: {}", e))?;
    let file_path = lyrics_dir.join(format!("{}.lrc", video_id));
    fs::write(&file_path, &content)
        .map_err(|e| format!("Failed to write lyrics file: {}", e))?;
    println!("[ebubfy-lyrics] Saved lyrics to: {:?}", file_path);
    Ok(())
}

#[tauri::command]
pub async fn load_lyrics_file(_app: tauri::AppHandle, video_id: String) -> Result<Option<String>, String> {
    let lyrics_dir = get_lyrics_dir();
    let file_path = lyrics_dir.join(format!("{}.lrc", video_id));
    if file_path.exists() {
        let content = fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read lyrics file: {}", e))?;
        println!("[ebubfy-lyrics] Loaded lyrics from: {:?}", file_path);
        Ok(Some(content))
    } else {
        Ok(None)
    }
}
