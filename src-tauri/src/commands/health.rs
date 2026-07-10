use serde::Serialize;
use std::process::Stdio;
use std::time::Duration;

use super::ytdlp::ytdlp_command;

#[derive(Debug, Serialize)]
pub struct HealthReport {
    pub yt_dlp_ok: bool,
    pub yt_dlp_version: Option<String>,
    pub yt_dlp_error: Option<String>,
    pub deezer_ok: bool,
    pub deezer_error: Option<String>,
    pub lrclib_ok: bool,
    pub lrclib_error: Option<String>,
}

#[tauri::command]
pub async fn health_check() -> Result<HealthReport, String> {
    let mut report = HealthReport {
        yt_dlp_ok: false,
        yt_dlp_version: None,
        yt_dlp_error: None,
        deezer_ok: false,
        deezer_error: None,
        lrclib_ok: false,
        lrclib_error: None,
    };

    // ── yt-dlp ──
    let mut cmd = ytdlp_command();
    cmd.arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let ytdlp_fut = tokio::task::spawn_blocking(move || cmd.output());
    match tokio::time::timeout(Duration::from_secs(5), ytdlp_fut).await {
        Ok(Ok(Ok(out))) if out.status.success() => {
            report.yt_dlp_ok = true;
            report.yt_dlp_version = Some(
                String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .next()
                    .unwrap_or("unknown")
                    .trim()
                    .to_string(),
            );
        }
        Ok(Ok(Ok(out))) => {
            report.yt_dlp_error = Some(format!("exit {:?}", out.status.code()));
        }
        Ok(Ok(Err(e))) => report.yt_dlp_error = Some(e.to_string()),
        Ok(Err(e)) => report.yt_dlp_error = Some(e.to_string()),
        Err(_) => report.yt_dlp_error = Some("timeout after 5s".to_string()),
    }

    // ── Deezer ──
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .ok();
    if let Some(client) = client {
        match client
            .get("https://api.deezer.com/track/3135556")
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => report.deezer_ok = true,
            Ok(r) => report.deezer_error = Some(format!("HTTP {}", r.status())),
            Err(e) => report.deezer_error = Some(e.to_string()),
        }

        // ── LRCLIB ──
        match client
            .get("https://lrclib.net/api/get?track_name=test&artist_name=test")
            .send()
            .await
        {
            // 404 is fine — means the API is reachable, just no match.
            Ok(r) if r.status().is_success() || r.status().as_u16() == 404 => report.lrclib_ok = true,
            Ok(r) => report.lrclib_error = Some(format!("HTTP {}", r.status())),
            Err(e) => report.lrclib_error = Some(e.to_string()),
        }
    }

    Ok(report)
}
