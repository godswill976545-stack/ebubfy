import { useEffect, useState } from "react";
import { ListMusic, Heart, Plus } from "lucide-react";
import { usePlaylistStore } from "../store/playlistStore";
import { useLanguageStore } from "../store/languageStore";
import type { VideoResult } from "../types";

interface LibraryPageProps {
  onPlayTrack: (track: VideoResult, queue?: VideoResult[]) => void;
  onSelectPlaylist: (playlist: { id: number; name: string; created_at: string }) => void;
  onCreatePlaylist: () => void;
  onOpenLikedPlaylist?: () => void;
}

type FilterType = "all" | "playlists" | "liked";

export default function LibraryPage({ onPlayTrack, onSelectPlaylist, onCreatePlaylist, onOpenLikedPlaylist }: LibraryPageProps) {
  const { translations: t } = useLanguageStore();
  const { playlists, favorites, loadPlaylists, loadFavorites, selectPlaylist } = usePlaylistStore();
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");

  useEffect(() => {
    loadPlaylists();
    loadFavorites();
  }, [loadFavorites, loadPlaylists]);

  const handlePlayFavorites = () => {
    if (favorites.length > 0) {
      const tracks: VideoResult[] = favorites.map((f) => ({
        id: f.video_id,
        title: f.title,
        artist: f.artist || "Unknown Artist",
        thumbnail: f.thumbnail || `https://img.youtube.com/vi/${f.video_id}/default.jpg`,
      }));
      onPlayTrack(tracks[0], tracks);
    }
  };

  const handlePlaylistClick = async (playlist: { id: number; name: string; created_at: string }) => {
    await selectPlaylist(playlist);
    onSelectPlaylist(playlist);
  };

  const showPlaylists = activeFilter === "all" || activeFilter === "playlists";
  const showLiked = activeFilter === "all" || activeFilter === "liked";

  return (
    <div className="library-page">
      <h1 className="library-header">{t.library.title}</h1>

      {/* Filter Chips */}
      <div className="library-filters">
        {([
          { key: "all" as FilterType, label: t.library.filterAll },
          { key: "playlists" as FilterType, label: t.library.filterPlaylists },
          { key: "liked" as FilterType, label: t.library.filterLiked },
        ]).map((filter) => (
          <button
            key={filter.key}
            className={`library-filter-chip ${activeFilter === filter.key ? "active" : ""}`}
            onClick={() => setActiveFilter(filter.key)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Liked Songs */}
      {showLiked && favorites.length > 0 && (
        <div
          className="liked-songs-card"
          onClick={() => {
            if (onOpenLikedPlaylist) {
              onOpenLikedPlaylist();
            } else {
              handlePlayFavorites();
            }
          }}
        >
          <div className="liked-songs-inner">
            <div className="liked-songs-icon">
              <Heart size={28} fill="white" color="white" />
            </div>
            <div>
              <div className="liked-songs-title">{t.library.likedSongs}</div>
              <div className="liked-songs-count">{favorites.length} {favorites.length === 1 ? t.home.songs_one : t.home.songs_other}</div>
            </div>
          </div>
        </div>
      )}

      {/* Playlists */}
      {showPlaylists && playlists.length > 0 && (
        <>
          <div className="section-title library-section-title">{t.library.playlists}</div>
          <div className="track-list">
            {playlists.map((playlist) => (
              <div
                key={playlist.id}
                className="track-item"
                onClick={() => handlePlaylistClick(playlist)}
              >
                <div className="library-playlist-icon">
                  <ListMusic size={20} />
                </div>
                <div className="track-info">
                  <div className="track-title">{playlist.name}</div>
                  <div className="track-artist">{t.library.playlistLabel}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {playlists.length === 0 && favorites.length === 0 && (
        <div className="empty-state">
          <ListMusic className="empty-state-icon" size={48} />
          <div className="empty-state-title">{t.library.emptyTitle}</div>
          <div className="empty-state-desc">{t.library.emptyDesc}</div>
        </div>
      )}

      {/* FAB for creating playlist */}
      <button className="fab" onClick={onCreatePlaylist} aria-label="Create playlist">
        <Plus size={24} />
      </button>
    </div>
  );
}
