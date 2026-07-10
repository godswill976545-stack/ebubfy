export interface VideoResult {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: string;
  duration_seconds?: number;
  view_count?: string;
  album?: string;
  release_year?: number;
  format?: string;
  bitrate?: string;
  sample_rate?: string;
  channels?: string;
  genres?: string[];
  album_artist?: string;
}

export interface Artist {
  id: string;
  name: string;
  thumbnail: string;
  followers?: string;
  popularity?: number;
  genres?: string[];
  topTracks?: VideoResult[];
  relatedArtists?: Artist[];
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  thumbnail: string;
  release_year?: number;
  total_tracks?: number;
  tracks: VideoResult[];
  genres?: string[];
  label?: string;
  copyrights?: string[];
}

export interface Playlist {
  id: number;
  name: string;
  created_at: string;
}

export interface PlaylistSong {
  id: number;
  playlist_id: number;
  video_id: string;
  title: string;
  artist?: string;
  thumbnail?: string;
  position: number;
}

export interface RecentlyPlayed {
  video_id: string;
  title: string;
  artist?: string;
  thumbnail?: string;
  played_at: string;
}

export interface LyricLine {
  time: number;
  text: string;
}

export type RepeatMode = "off" | "one" | "all";

export type Theme = "light" | "dark" | "midnight";

export type Page = "home" | "search" | "browse" | "library" | "playlist" | "now-playing" | "settings";
