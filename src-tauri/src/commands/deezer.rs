use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

// ─── Deezer free public API ─────────────────────────────────────────────────
// No key required. https://developers.deezer.com/api
const BASE_URL: &str = "https://api.deezer.com";

// ─── Response types ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Clone, Default)]
pub struct DeezerArtist {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub picture: String,
    #[serde(default)]
    pub picture_xl: String,
    #[serde(default)]
    pub nb_fan: i64,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct DeezerAlbum {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub cover: String,
    #[serde(default)]
    pub cover_big: String,
    #[serde(default)]
    pub cover_xl: String,
    #[serde(default)]
    pub release_date: String,
    #[serde(default)]
    pub artist: DeezerArtist,
    #[serde(default)]
    pub nb_tracks: i32,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub genres: serde_json::Value,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct DeezerTrack {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub duration: i32,
    #[serde(default)]
    pub artist: DeezerArtist,
    #[serde(default)]
    pub album: DeezerAlbum,
}

#[derive(Debug, Deserialize)]
struct SearchResponse<T> {
    #[serde(default)]
    data: Vec<T>,
}

// ─── Public enrichment result ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct TrackMetadata {
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub album_release_date: Option<String>,
    pub album_cover_small: Option<String>,
    pub album_cover_medium: Option<String>,
    pub album_cover_large: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub genre: Option<String>,
    pub label: Option<String>,
    pub duration_seconds: Option<i32>,
    pub deezer_track_id: Option<i64>,
    pub deezer_album_id: Option<i64>,
    pub deezer_artist_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ArtistInfo {
    pub id: i64,
    pub name: String,
    pub picture: Option<String>,
    pub picture_big: Option<String>,
    pub fan_count: i64,
    pub top_tracks: Vec<PublicTrack>,
    pub albums: Vec<PublicAlbum>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicAlbum {
    pub id: i64,
    pub title: String,
    pub cover_medium: Option<String>,
    pub cover_xl: Option<String>,
    pub release_date: Option<String>,
    pub artist_name: String,
    pub track_count: i32,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicTrack {
    pub id: i64,
    pub title: String,
    pub duration: i32,
    pub artist_name: String,
    pub album_title: String,
    pub album_cover_medium: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicAlbumFull {
    pub id: i64,
    pub title: String,
    pub cover_xl: Option<String>,
    pub cover_medium: Option<String>,
    pub release_date: Option<String>,
    pub artist_name: String,
    pub artist_id: i64,
    pub track_count: i32,
    pub label: Option<String>,
    pub genres: Vec<String>,
    pub tracks: Vec<PublicTrack>,
}

// ─── HTTP client + in-memory TTL cache ─────────────────────────────────────

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("ebubfy/0.1.0 (music player)")
            .timeout(Duration::from_secs(8))
            .pool_max_idle_per_host(8)
            .build()
            .expect("failed to build Deezer HTTP client")
    })
}

const CACHE_TTL_SECS: u64 = 24 * 60 * 60; // 24 hours
const CACHE_MAX_ENTRIES: usize = 500;

static CACHE: OnceLock<std::sync::Mutex<HashMap<String, (String, std::time::Instant)>>> = OnceLock::new();
fn cache_map() -> &'static std::sync::Mutex<HashMap<String, (String, std::time::Instant)>> {
    CACHE.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn cache_get(key: &str) -> Option<String> {
    let map = cache_map().lock().ok()?;
    let (value, inserted_at) = map.get(key)?;
    if inserted_at.elapsed().as_secs() > CACHE_TTL_SECS {
        // Entry expired — remove it lazily
        drop(map);
        if let Ok(mut map) = cache_map().lock() {
            map.remove(key);
        }
        return None;
    }
    Some(value.clone())
}

fn cache_put(key: &str, value: &str) {
    if let Ok(mut map) = cache_map().lock() {
        // Evict expired entries and enforce max size
        if map.len() >= CACHE_MAX_ENTRIES {
            let now = std::time::Instant::now();
            map.retain(|_, (_, t)| now.duration_since(*t).as_secs() <= CACHE_TTL_SECS);
            // If still over limit after eviction, remove oldest entries
            if map.len() >= CACHE_MAX_ENTRIES {
                let mut entries: Vec<_> = map.iter().map(|(k, (_, t))| (k.clone(), *t)).collect();
                entries.sort_by_key(|(_, t)| *t);
                let to_remove = entries.len() - CACHE_MAX_ENTRIES + 50;
                for (k, _) in entries.into_iter().take(to_remove) {
                    map.remove(&k);
                }
            }
        }
        map.insert(key.to_string(), (value.to_string(), std::time::Instant::now()));
    }
}

async fn fetch_json<T: for<'de> Deserialize<'de>>(url: &str) -> Result<T, String> {
    // Check cache
    if let Some(cached) = cache_get(url) {
        if let Ok(value) = serde_json::from_str::<T>(&cached) {
            return Ok(value);
        }
    }

    let resp = client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Deezer request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Deezer HTTP {}", resp.status()));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Deezer read failed: {}", e))?;

    cache_put(url, &body);

    serde_json::from_str::<T>(&body).map_err(|e| format!("Deezer JSON parse: {}", e))
}

/// Extract the first genre name from Deezer's nested `{"data": [{"id": ..., "name": ...}]}` structure.
fn extract_genre(genres: &serde_json::Value) -> Option<String> {
    genres
        .get("data")?
        .as_array()?
        .first()?
        .get("name")?
        .as_str()
        .map(|s| s.to_string())
}

// ─── Public API ────────────────────────────────────────────────────────────

/// Find a single track by (artist, title) and return rich metadata.
pub async fn fetch_track_metadata(artist: &str, title: &str) -> Option<TrackMetadata> {
    let query = format!("{} {}", artist, title);
    let url = format!(
        "{}/search/track?q={}&limit=5",
        BASE_URL,
        urlencoding::encode(&query)
    );
    let resp: SearchResponse<DeezerTrack> = fetch_json(&url).await.ok()?;
    if resp.data.is_empty() {
        return None;
    }

    // Pick the best match: prefer exact title match with the right artist.
    let title_lower = title.to_lowercase();
    let artist_lower = artist.to_lowercase();
    let track = resp
        .data
        .into_iter()
        .max_by_key(|t| {
            let title_match = t.title.to_lowercase() == title_lower;
            let artist_match = t.artist.name.to_lowercase() == artist_lower;
            let title_contains = t.title.to_lowercase().contains(&title_lower)
                || title_lower.contains(&t.title.to_lowercase());
            let artist_contains = t.artist.name.to_lowercase().contains(&artist_lower)
                || artist_lower.contains(&t.artist.name.to_lowercase());
            (title_match, artist_match, title_contains, artist_contains)
        })?;

    let mut meta = TrackMetadata {
        duration_seconds: if track.duration > 0 {
            Some(track.duration)
        } else {
            None
        },
        deezer_track_id: Some(track.id),
        deezer_album_id: if track.album.id > 0 {
            Some(track.album.id)
        } else {
            None
        },
        deezer_artist_id: if track.artist.id > 0 {
            Some(track.artist.id)
        } else {
            None
        },
        ..Default::default()
    };

    meta.album = (!track.album.title.is_empty()).then_some(track.album.title);
    meta.album_artist = (!track.artist.name.is_empty()).then_some(track.artist.name);
    meta.album_release_date = (!track.album.release_date.is_empty())
        .then_some(track.album.release_date);
    meta.album_cover_small = (!track.album.cover.is_empty()).then_some(track.album.cover);
    meta.album_cover_medium = (!track.album.cover_big.is_empty())
        .then_some(track.album.cover_big);
    meta.album_cover_large = (!track.album.cover_xl.is_empty()).then_some(track.album.cover_xl);
    meta.label = (!track.album.label.is_empty()).then_some(track.album.label);
    meta.genre = extract_genre(&track.album.genres);

    Some(meta)
}

/// Get artist info + top tracks + albums.
pub async fn fetch_artist(artist_name: &str) -> Option<ArtistInfo> {
    let url = format!(
        "{}/search/artist?q={}&limit=1",
        BASE_URL,
        urlencoding::encode(artist_name)
    );
    let resp: SearchResponse<DeezerArtist> = fetch_json(&url).await.ok()?;
    let artist = resp.data.into_iter().next()?;
    if artist.id == 0 {
        return None;
    }

    // Fetch top tracks and albums in parallel.
    let top_url = format!("{}/artist/{}/top?limit=15", BASE_URL, artist.id);
    let albums_url = format!("{}/artist/{}/albums?limit=20", BASE_URL, artist.id);

    let (top_res, albums_res) = tokio::join!(
        fetch_json::<DeezerTopResponse>(&top_url),
        fetch_json::<DeezerAlbumsResponse>(&albums_url),
    );

    let top_tracks = top_res
        .ok()
        .map(|r| {
            r.data
                .into_iter()
                .map(|t| PublicTrack {
                    id: t.id,
                    title: t.title,
                    duration: t.duration,
                    artist_name: t.artist.name,
                    album_title: t.album.title,
                    album_cover_medium: if t.album.cover_big.is_empty() {
                        None
                    } else {
                        Some(t.album.cover_big)
                    },
                })
                .collect()
        })
        .unwrap_or_default();

    let albums = albums_res
        .ok()
        .map(|r| {
            r.data
                .into_iter()
                .map(|a| PublicAlbum {
                    id: a.id,
                    title: a.title,
                    cover_medium: if a.cover_big.is_empty() {
                        None
                    } else {
                        Some(a.cover_big)
                    },
                    cover_xl: if a.cover_xl.is_empty() {
                        None
                    } else {
                        Some(a.cover_xl)
                    },
                    release_date: if a.release_date.is_empty() {
                        None
                    } else {
                        Some(a.release_date)
                    },
                    artist_name: a.artist.name,
                    track_count: a.nb_tracks,
                    label: if a.label.is_empty() { None } else { Some(a.label) },
                })
                .collect()
        })
        .unwrap_or_default();

    Some(ArtistInfo {
        id: artist.id,
        name: artist.name,
        picture: if artist.picture.is_empty() {
            None
        } else {
            Some(artist.picture)
        },
        picture_big: if artist.picture_xl.is_empty() {
            None
        } else {
            Some(artist.picture_xl)
        },
        fan_count: artist.nb_fan,
        top_tracks,
        albums,
    })
}

/// Get albums for an artist by name (cheaper than fetching full artist info).
pub async fn fetch_artist_albums(artist_name: &str) -> Option<Vec<PublicAlbum>> {
    // First find the artist ID
    let url = format!(
        "{}/search/artist?q={}&limit=1",
        BASE_URL,
        urlencoding::encode(artist_name)
    );
    let resp: SearchResponse<DeezerArtist> = fetch_json(&url).await.ok()?;
    let artist = resp.data.into_iter().next()?;
    if artist.id == 0 {
        return None;
    }

    let albums_url = format!("{}/artist/{}/albums?limit=30", BASE_URL, artist.id);
    let albums_res: DeezerAlbumsResponse = fetch_json(&albums_url).await.ok()?;

    let albums = albums_res
        .data
        .into_iter()
        .map(|a| PublicAlbum {
            id: a.id,
            title: a.title,
            cover_medium: if a.cover_big.is_empty() {
                None
            } else {
                Some(a.cover_big)
            },
            cover_xl: if a.cover_xl.is_empty() {
                None
            } else {
                Some(a.cover_xl)
            },
            release_date: if a.release_date.is_empty() {
                None
            } else {
                Some(a.release_date)
            },
            artist_name: a.artist.name,
            track_count: a.nb_tracks,
            label: if a.label.is_empty() { None } else { Some(a.label) },
        })
        .collect();

    Some(albums)
}

/// Get a full album with all tracks.
pub async fn fetch_album(album_name: &str, artist_name: &str) -> Option<PublicAlbumFull> {
    let query = format!("{} {}", artist_name, album_name);
    let url = format!(
        "{}/search/album?q={}&limit=5",
        BASE_URL,
        urlencoding::encode(&query)
    );
    let resp: SearchResponse<DeezerAlbum> = fetch_json(&url).await.ok()?;
    let album_lower = album_name.to_lowercase();
    let artist_lower = artist_name.to_lowercase();

    let album = resp
        .data
        .into_iter()
        .max_by_key(|a| {
            let title_match = a.title.to_lowercase() == album_lower;
            let artist_match = a.artist.name.to_lowercase() == artist_lower;
            let title_contains = a.title.to_lowercase().contains(&album_lower)
                || album_lower.contains(&a.title.to_lowercase());
            (
                title_match,
                artist_match,
                title_contains,
                a.nb_tracks,
            )
        })?;

    if album.id == 0 {
        return None;
    }

    // Fetch the full album with tracks.
    let album_url = format!("{}/album/{}", BASE_URL, album.id);
    let full: DeezerAlbumFull = fetch_json(&album_url).await.ok()?;

    let genres: Vec<String> = full
        .genres
        .get("data")
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|g| g.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let tracks: Vec<PublicTrack> = full
        .tracks
        .data
        .into_iter()
        .map(|t| PublicTrack {
            id: t.id,
            title: t.title,
            duration: t.duration,
            artist_name: t.artist.name,
            album_title: full.title.clone(),
            album_cover_medium: if full.cover_big.is_empty() {
                None
            } else {
                Some(full.cover_big.clone())
            },
        })
        .collect();

    Some(PublicAlbumFull {
        id: full.id,
        title: full.title,
        cover_xl: if full.cover_xl.is_empty() {
            None
        } else {
            Some(full.cover_xl)
        },
        cover_medium: if full.cover_big.is_empty() {
            None
        } else {
            Some(full.cover_big)
        },
        release_date: if full.release_date.is_empty() {
            None
        } else {
            Some(full.release_date)
        },
        artist_name: full.artist.name,
        artist_id: full.artist.id,
        track_count: tracks.len() as i32,
        label: if full.label.is_empty() {
            None
        } else {
            Some(full.label)
        },
        genres,
        tracks,
    })
}

#[derive(Debug, Deserialize)]
struct DeezerTopResponse {
    #[serde(default)]
    data: Vec<DeezerTrack>,
}

#[derive(Debug, Deserialize)]
struct DeezerAlbumsResponse {
    #[serde(default)]
    data: Vec<DeezerAlbum>,
}

#[derive(Debug, Deserialize)]
struct DeezerAlbumFull {
    #[serde(default)]
    id: i64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    cover_big: String,
    #[serde(default)]
    cover_xl: String,
    #[serde(default)]
    release_date: String,
    #[serde(default)]
    artist: DeezerArtist,
    #[serde(default)]
    label: String,
    #[serde(default)]
    genres: serde_json::Value,
    #[serde(default)]
    tracks: DeezerTracksContainer,
}

#[derive(Debug, Deserialize, Default)]
struct DeezerTracksContainer {
    #[serde(default)]
    data: Vec<DeezerTrack>,
}

impl Default for TrackMetadata {
    fn default() -> Self {
        Self {
            album: None,
            album_artist: None,
            album_release_date: None,
            album_cover_small: None,
            album_cover_medium: None,
            album_cover_large: None,
            track_number: None,
            disc_number: None,
            genre: None,
            label: None,
            duration_seconds: None,
            deezer_track_id: None,
            deezer_album_id: None,
            deezer_artist_id: None,
        }
    }
}
