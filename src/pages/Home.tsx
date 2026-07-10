import { useEffect, useState } from "react";
import { Heart, Play, Music, Search, Clock, MoreHorizontal } from "lucide-react";
import { usePlaylistStore } from "../store/playlistStore";
import { useLanguageStore } from "../store/languageStore";
import FadingLines from "../components/ui/FadingLines";
import type { Translations } from "../i18n/en";
import type { VideoResult } from "../types";

interface HomePageProps {
  onPlayTrack: (track: VideoResult, queue?: VideoResult[]) => void;
  onSearchGenre?: (genre: string) => void;
  onNavigateToSearch?: () => void;
}

const PLAYLIST_CARDS = [
  { label: "R&B Hits", gradient: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" },
  { label: "Pop Hits", gradient: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)" },
  { label: "Chill Vibes", gradient: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)" },
  { label: "Workout", gradient: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)" },
];

function getGreeting(t: Translations["home"]["greeting"]): string {
  const hour = new Date().getHours();
  if (hour < 12) return t.morning;
  if (hour < 18) return t.afternoon;
  return t.evening;
}

export default function HomePage({ onPlayTrack, onSearchGenre, onNavigateToSearch }: HomePageProps) {
  const { translations: t } = useLanguageStore();
  const { recentlyPlayed, loadRecentlyPlayed, favorites, loadFavorites } = usePlaylistStore();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      await Promise.all([loadRecentlyPlayed(), loadFavorites()]);
      setIsLoading(false);
    };
    loadData();
  }, [loadFavorites, loadRecentlyPlayed]);

  const recentTracks: VideoResult[] = recentlyPlayed.map((r) => ({
    id: r.video_id,
    title: r.title,
    artist: r.artist || "Unknown Artist",
    thumbnail: r.thumbnail || `https://img.youtube.com/vi/${r.video_id}/default.jpg`,
  }));

  const favTracks: VideoResult[] = favorites.map((f) => ({
    id: f.video_id,
    title: f.title,
    artist: f.artist || "Unknown Artist",
    thumbnail: f.thumbnail || `https://img.youtube.com/vi/${f.video_id}/default.jpg`,
  }));

  const topFavTracks = favTracks.slice(0, 5);

  if (isLoading) {
    return (
      <div className="home-page animate-fade-in">
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "120px 0",
          gap: 32,
        }}>
          <FadingLines lines={6} />
          <div style={{
            fontSize: 14,
            color: "var(--text-muted)",
            fontFamily: "var(--font-body)",
            fontWeight: 500,
          }}>
            {t.common.loading}
          </div>
        </div>
      </div>
    );
  }

  if (recentTracks.length === 0 && favTracks.length === 0) {
    return (
      <div className="home-page animate-fade-in">
        <div className="home-header">
          <h1 className="home-greeting">{getGreeting(t.home.greeting)}</h1>
          <button className="home-search-bar" onClick={onNavigateToSearch}>
            <Search size={16} />
            <span>{t.search.placeholder}</span>
          </button>
        </div>
        <div className="empty-state" style={{ height: "50vh" }}>
          <Music size={56} style={{ color: "var(--text-muted)", marginBottom: 16 }} />
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>
            {t.home.welcome}
          </div>
          <div style={{ fontSize: 14, marginTop: 10, maxWidth: 300, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {t.home.welcomeDesc}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="home-page animate-fade-in">
      {/* Header: Greeting + Search */}
      <div className="home-header">
        <h1 className="home-greeting">{getGreeting(t.home.greeting)}</h1>
        <button className="home-search-bar" onClick={onNavigateToSearch}>
          <Search size={16} />
          <span>{t.search.placeholder}</span>
        </button>
      </div>

      {/* Playlist Quick Cards */}
      <div className="home-playlist-cards">
        {PLAYLIST_CARDS.map((card) => (
          <button
            key={card.label}
            className="home-playlist-card"
            style={{ background: card.gradient }}
            onClick={() => onSearchGenre?.(card.label)}
          >
            <span className="home-playlist-card-label">{card.label}</span>
            <Play size={16} fill="currentColor" className="home-playlist-card-icon" />
          </button>
        ))}
      </div>

      {/* Liked Songs — Side-by-side layout */}
      {topFavTracks.length > 0 && (
        <div className="home-section animate-slide-up">
          <div className="home-section-header">
            <div className="home-section-title">My Favorite Songs</div>
            <button className="home-section-more">
              <MoreHorizontal size={18} />
            </button>
          </div>
          <div className="home-fav-layout">
            <div
              className="home-fav-art"
              onClick={() => onPlayTrack(favTracks[0], favTracks)}
            >
              <img
                src={favTracks[0].thumbnail}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${favTracks[0].id}/maxresdefault.jpg`;
                }}
              />
              <button
                className="home-fav-play-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onPlayTrack(favTracks[0], favTracks);
                }}
              >
                <Play size={20} fill="currentColor" />
              </button>
            </div>
            <div className="home-fav-tracks">
              {topFavTracks.map((track, i) => (
                <div
                  key={`${track.id}-${i}`}
                  className="home-fav-track"
                  onClick={() => onPlayTrack(track, favTracks)}
                >
                  <span className="home-fav-track-num">{i + 1}</span>
                  <img
                    className="home-fav-track-thumb"
                    src={track.thumbnail}
                    alt=""
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${track.id}/default.jpg`;
                    }}
                  />
                  <div className="home-fav-track-info">
                    <div className="home-fav-track-title">{track.title}</div>
                    <div className="home-fav-track-artist">{track.artist}</div>
                  </div>
                  <Heart size={14} className="home-fav-track-heart" fill="var(--accent)" stroke="var(--accent)" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recently Played — Track list */}
      {recentTracks.length > 0 && (
        <div className="home-section animate-slide-up animate-delay-1">
          <div className="home-section-header">
            <div className="home-section-title">{t.home.recentlyPlayed}</div>
            <button className="home-section-more">
              <MoreHorizontal size={18} />
            </button>
          </div>
          <div className="home-track-list">
            {recentTracks.slice(0, 6).map((track, i) => (
              <div
                key={`${track.id}-${i}`}
                className="home-track-item"
                onClick={() => onPlayTrack(track, recentTracks)}
              >
                <span className="home-track-num">{i + 1}</span>
                <img
                  className="home-track-thumb"
                  src={track.thumbnail}
                  alt=""
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${track.id}/default.jpg`;
                  }}
                />
                <div className="home-track-info">
                  <div className="home-track-title">{track.title}</div>
                  <div className="home-track-artist">{track.artist}</div>
                </div>
                <div className="home-track-meta">
                  <Clock size={12} />
                </div>
                <button
                  className="home-track-play"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayTrack(track, recentTracks);
                  }}
                >
                  <Play size={16} fill="currentColor" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
