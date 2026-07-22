use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Duration;

use super::deezer;

// ─── Public response types (kept stable for the frontend) ──────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AlbumData {
    pub id: String,
    pub name: String,
    pub artist: String,
    pub thumbnail: String,
    #[serde(rename = "release_year")]
    pub release_year: Option<i32>,
    #[serde(rename = "total_tracks")]
    pub total_tracks: Option<i32>,
    pub genres: Vec<String>,
    pub label: Option<String>,
    pub copyrights: Vec<String>,
    pub tracks: Vec<super::youtube::VideoResult>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArtistData {
    pub id: String,
    pub name: String,
    pub thumbnail: String,
    pub followers: Option<String>,
    pub popularity: Option<i32>,
    pub genres: Vec<String>,
    #[serde(rename = "topTracks")]
    pub top_tracks: Vec<super::youtube::VideoResult>,
    #[serde(rename = "relatedArtists")]
    pub related_artists: Vec<ArtistData>,
}

fn _shared_client() -> &'static reqwest::Client {
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

fn parse_year(date_str: Option<&str>) -> Option<i32> {
    let s = date_str?;
    if s.len() < 4 {
        return None;
    }
    s[..4].parse::<i32>().ok().filter(|y| *y >= 1900 && *y <= 2100)
}

fn format_duration(seconds: i32) -> String {
    let m = seconds / 60;
    let s = seconds % 60;
    format!("{}:{:02}", m, s)
}

fn deezer_track_to_video(
    title: String,
    artist_name: String,
    duration: i32,
    album_cover: Option<String>,
) -> super::youtube::VideoResult {
    super::youtube::VideoResult {
        id: format!("deezer:{}", title),
        title,
        artist: artist_name,
        thumbnail: album_cover.unwrap_or_default(),
        duration: Some(format_duration(duration)),
        duration_seconds: Some(duration as f64),
        view_count: None,
        album: None,
        release_year: None,
    }
}

#[tauri::command]
pub async fn get_album_data(album_name: String, artist_name: String) -> Result<AlbumData, String> {
    match deezer::fetch_album(&album_name, &artist_name).await {
        Some(album) => {
            let tracks = album
                .tracks
                .into_iter()
                .map(|t| {
                    deezer_track_to_video(
                        t.title,
                        t.artist_name,
                        t.duration,
                        t.album_cover_medium.or(album.cover_medium.clone()),
                    )
                })
                .collect();
            Ok(AlbumData {
                id: album.id.to_string(),
                name: album.title,
                artist: album.artist_name,
                thumbnail: album.cover_xl.unwrap_or_default(),
                release_year: parse_year(album.release_date.as_deref()),
                total_tracks: Some(album.track_count),
                genres: album.genres,
                label: album.label,
                copyrights: Vec::new(),
                tracks,
            })
        }
        None => Ok(AlbumData {
            id: format!("album-{}", urlencoding::encode(&album_name)),
            name: album_name,
            artist: artist_name,
            thumbnail: String::new(),
            release_year: None,
            total_tracks: None,
            genres: Vec::new(),
            label: None,
            copyrights: Vec::new(),
            tracks: Vec::new(),
        }),
    }
}

#[tauri::command]
pub async fn get_artist_data(artist_name: String) -> Result<ArtistData, String> {
    match deezer::fetch_artist(&artist_name).await {
        Some(artist) => {
            let top_tracks: Vec<super::youtube::VideoResult> = artist
                .top_tracks
                .into_iter()
                .map(|t| deezer_track_to_video(t.title, t.artist_name, t.duration, t.album_cover_medium))
                .collect();
            let fan_count = artist.fan_count;
            Ok(ArtistData {
                id: artist.id.to_string(),
                name: artist.name,
                thumbnail: artist.picture_big.unwrap_or_default(),
                followers: Some(format!("{} fans", fan_count)),
                popularity: None,
                genres: Vec::new(),
                top_tracks,
                related_artists: Vec::new(),
            })
        }
        None => Ok(ArtistData {
            id: format!("artist-{}", urlencoding::encode(&artist_name)),
            name: artist_name,
            thumbnail: String::new(),
            followers: None,
            popularity: None,
            genres: Vec::new(),
            top_tracks: Vec::new(),
            related_artists: Vec::new(),
        }),
    }
}

#[tauri::command]
pub async fn get_artist_albums(artist_name: String) -> Result<Vec<AlbumData>, String> {
    let albums = match deezer::fetch_artist_albums(&artist_name).await {
        Some(albums) => albums,
        None => return Ok(Vec::new()),
    };

    Ok(albums
        .into_iter()
        .map(|a| AlbumData {
            id: a.id.to_string(),
            name: a.title,
            artist: a.artist_name,
            thumbnail: a.cover_xl.unwrap_or_default(),
            release_year: parse_year(a.release_date.as_deref()),
            total_tracks: Some(a.track_count),
            genres: Vec::new(),
            label: a.label,
            copyrights: Vec::new(),
            tracks: Vec::new(),
        })
        .collect())
}

#[tauri::command]
pub async fn get_track_metadata(
    artist: String,
    title: String,
) -> Result<super::deezer::TrackMetadata, String> {
    deezer::fetch_track_metadata(&artist, &title)
        .await
        .ok_or_else(|| "No metadata found".to_string())
}
