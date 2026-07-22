import { invoke } from "@tauri-apps/api/core";
import type {
  VideoResult,
  Playlist,
  PlaylistSong,
  RecentlyPlayed,
  Album,
  Artist,
} from "../types";

// YouTube

const INVOKE_TIMEOUT_MS = 15000;

/** Race an invoke call against a timeout so the UI never hangs indefinitely. */
function invokeWithTimeout<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    invoke<T>(cmd, args),
    new Promise<never>((_, reject) =>
      timer = setTimeout(() => reject(new Error("Request timed out. Please try again.")), INVOKE_TIMEOUT_MS)
    ),
  ]).finally(() => clearTimeout(timer));
}

export async function searchYouTube(query: string, limit?: number): Promise<VideoResult[]> {
  return invokeWithTimeout("search_youtube", { query, limit });
}

/**
 * Search YouTube + enrich with metadata (album, cover art, artist).
 * If the enriched search fails or times out, falls back to a plain YouTube search.
 */
export async function searchYouTubeEnriched(query: string, limit?: number): Promise<VideoResult[]> {
  try {
    return await invokeWithTimeout<VideoResult[]>("search_youtube_enriched", { query, limit });
  } catch (err) {
    console.warn("[search] Enriched search failed, falling back to plain YouTube:", err);
    return invokeWithTimeout("search_youtube", { query, limit });
  }
}

export interface HistoryEntry {
  id: number;
  query: string;
  result_count: number;
  searched_at: string;
}

export async function getSearchHistory(): Promise<HistoryEntry[]> {
  return invokeWithTimeout("get_search_history", {});
}

export async function clearSearchHistory(): Promise<void> {
  return invokeWithTimeout("clear_search_history", {});
}

export async function removeHistoryEntry(id: number): Promise<void> {
  return invokeWithTimeout("remove_history_entry", { id });
}

export async function suggestQueries(prefix: string): Promise<string[]> {
  return invokeWithTimeout("suggest_queries", { prefix });
}

export async function cacheSearchResults(query: string, results: VideoResult[]): Promise<void> {
  return invokeWithTimeout("cache_search", { query, results });
}

export interface HealthReport {
  yt_dlp_ok: boolean;
  yt_dlp_version: string | null;
  yt_dlp_error: string | null;
  deezer_ok: boolean;
  deezer_error: string | null;
  lrclib_ok: boolean;
  lrclib_error: string | null;
}

export async function healthCheck(): Promise<HealthReport> {
  return invoke("health_check");
}

export interface TrackMetadata {
  album: string | null;
  album_artist: string | null;
  album_release_date: string | null;
  album_cover_small: string | null;
  album_cover_medium: string | null;
  album_cover_large: string | null;
  track_number: number | null;
  disc_number: number | null;
  genre: string | null;
  label: string | null;
  duration_seconds: number | null;
  deezer_track_id: number | null;
  deezer_album_id: number | null;
  deezer_artist_id: number | null;
}

export async function getTrackMetadata(artist: string, title: string): Promise<TrackMetadata> {
  return invoke("get_track_metadata", { artist, title });
}

export async function getVideoInfo(videoId: string): Promise<VideoResult> {
  return invoke("get_video_info", { videoId });
}

export async function searchArtists(query: string, limit?: number): Promise<VideoResult[]> {
  return invoke("search_artists", { query, limit });
}

export async function getArtistSongs(artistChannelUrl: string): Promise<VideoResult[]> {
  return invoke("get_artist_songs", { artistChannelUrl });
}

// Audio
export async function getStreamUrl(videoId: string): Promise<string> {
  return invokeWithTimeout("get_stream_url", { videoId });
}

// Captions / Lyrics (YouTube auto-subs, synced)
export async function getVideoCaptions(videoId: string, preferredLanguage: string): Promise<{ time: number; text: string }[]> {
  return invokeWithTimeout("get_video_captions", { videoId, preferredLanguage });
}

// ─── Lyrics (LRCLIB + ytmusicapi) ──────────────────────────

export interface LyricsResult {
  body: string;
  synced_lyrics?: string;
  source: string;
  duration?: number;
  provider: string;
  language?: string;
  is_synced: boolean;
  confidence: number;
  /** The YouTube video ID these lyrics are for. Set by the frontend. */
  track_id?: string;
}

/**
 * Search for lyrics from LRCLIB (synced) and ytmusicapi (plain text).
 * Returns synced LRC lyrics when available, plain text as fallback.
 */
export async function searchLyrics(query: string, duration?: number): Promise<LyricsResult | null> {
  return invokeWithTimeout("search_lyrics", { query, duration });
}

// Legacy compatibility stubs
export async function getLyricsById(trackId: number): Promise<LyricsResult | null> {
  return invokeWithTimeout("get_lyrics_by_id", { trackId });
}

export async function getLyricsTranslation(trackId: number, language: string): Promise<string | null> {
  return invokeWithTimeout("get_lyrics_translation", { trackId, language });
}

// Playlists
export async function getPlaylists(): Promise<Playlist[]> {
  return invokeWithTimeout("get_playlists", {});
}

export async function createPlaylist(name: string): Promise<number> {
  return invokeWithTimeout("create_playlist", { name });
}

export async function deletePlaylist(playlistId: number): Promise<void> {
  return invokeWithTimeout("delete_playlist", { playlistId });
}

export async function getPlaylistSongs(playlistId: number): Promise<PlaylistSong[]> {
  return invokeWithTimeout("get_playlist_songs", { playlistId });
}

export async function addToPlaylist(
  playlistId: number,
  song: { videoId: string; title: string; artist?: string; thumbnail?: string }
): Promise<number> {
  return invokeWithTimeout("add_to_playlist", {
    playlistId,
    videoId: song.videoId,
    title: song.title,
    artist: song.artist,
    thumbnail: song.thumbnail,
  });
}

export async function removeFromPlaylist(playlistId: number, videoId: string): Promise<void> {
  return invokeWithTimeout("remove_from_playlist", { playlistId, videoId });
}

export async function reorderPlaylistSongs(playlistId: number, videoIds: string[]): Promise<void> {
  return invokeWithTimeout("reorder_playlist_songs", { playlistId, videoIds });
}

// Favorites
export async function getFavorites(): Promise<PlaylistSong[]> {
  return invokeWithTimeout("get_favorites", {});
}

export async function toggleFavorite(song: {
  videoId: string;
  title: string;
  artist?: string;
  thumbnail?: string;
}): Promise<boolean> {
  return invokeWithTimeout("toggle_favorite", {
    videoId: song.videoId,
    title: song.title,
    artist: song.artist,
    thumbnail: song.thumbnail,
  });
}

// Recently Played
export async function addRecentlyPlayed(song: {
  videoId: string;
  title: string;
  artist?: string;
  thumbnail?: string;
}): Promise<void> {
  return invokeWithTimeout("add_recently_played", {
    videoId: song.videoId,
    title: song.title,
    artist: song.artist,
    thumbnail: song.thumbnail,
  });
}

export async function getRecentlyPlayed(): Promise<RecentlyPlayed[]> {
  return invokeWithTimeout("get_recently_played", {});
}

// Preferences
export async function savePreference(key: string, value: string): Promise<void> {
  return invokeWithTimeout("save_preference", { key, value });
}

export async function getPreference(key: string): Promise<string | null> {
  return invokeWithTimeout("get_preference", { key });
}

// Lyrics file persistence
export async function saveLyricsFile(videoId: string, lrcContent: string): Promise<void> {
  return invokeWithTimeout("save_lyrics_file", { videoId, content: lrcContent });
}

export async function loadLyricsFile(videoId: string): Promise<string | null> {
  return invokeWithTimeout("load_lyrics_file", { videoId });
}

// ─── YouTube Music sidecar has been removed ────────────────
// All metadata is now served by TheAudioDB via search_youtube_enriched.
// All lyrics come from LRCLIB and NetEase Cloud Music (synced LRC).
//
// Stub functions below keep the frontend building while the corresponding
// UI sections are updated to reflect the removal.

/** Trigger background MusicBrainz enrichment for a track (album, year, cover art). */
export async function enrichTrackBackground(
  videoId: string,
  artist: string,
  title: string,
): Promise<void> {
  return invoke("enrich_track_background", { videoId, artist, title });
}

/** Always returns "not configured" since the YouTube Music sidecar was removed. */
export async function checkYtmusicOauthStatus(): Promise<{ configured: boolean; error?: string }> {
  return { configured: false };
}

/** Throws since YouTube Music OAuth has been removed. */
export async function setupYtmusicOauth(): Promise<{ status: string }> {
  throw new Error("YouTube Music OAuth has been removed. Metadata is now sourced from TheAudioDB.");
}

// ─── Album & Artist Data ─────────────────────────────────────

/** Get album data from TheAudioDB */
export async function getAlbumData(albumName: string, artistName: string): Promise<Album> {
  return invoke("get_album_data", { albumName, artistName });
}

/** Get artist data from TheAudioDB */
export async function getArtistData(artistName: string): Promise<Artist> {
  return invoke("get_artist_data", { artistName });
}

/** Get all albums by an artist from TheAudioDB */
export async function getArtistAlbums(artistName: string): Promise<Album[]> {
  return invoke("get_artist_albums", { artistName });
}

