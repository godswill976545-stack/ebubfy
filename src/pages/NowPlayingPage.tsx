import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ChevronLeft,
  Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1,
  Volume2, Volume1, VolumeX,
  Heart, ListPlus, MoreHorizontal,
  List, Maximize2, Minimize2, Mic,
} from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import { usePlaylistStore } from "../store/playlistStore";
import { useLanguageStore } from "../store/languageStore";
import { formatTime } from "../lib/utils";
import { getVideoInfo, enrichTrackBackground, getTrackMetadata } from "../lib/api";
import { useClickOutside } from "../hooks/useClickOutside";
import { useToastStore } from "../store/toastStore";
import type { VideoResult } from "../types";
import LyricsPanel from "../components/lyrics/LyricsPanel";
import LazyImage from "../components/ui/LazyImage";

interface NowPlayingPageProps {
  onBack: () => void;
  onSeek?: (time: number) => void;
  onToggleQueue?: () => void;
}

interface PlaylistMenuProps {
  currentTrack: VideoResult;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function PlaylistMenu({ currentTrack, isOpen, onToggle, onClose }: PlaylistMenuProps) {
  const { playlists, loadPlaylists, addToPlaylist } = usePlaylistStore();
  const addToast = useToastStore((s) => s.addToast);
  const ref = useClickOutside<HTMLDivElement>(onClose, isOpen);

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button
        className="np-icon-btn"
        onClick={(e) => {
          e.stopPropagation();
          loadPlaylists();
          onToggle();
        }}
        aria-label="Add to playlist"
      >
        <ListPlus size={18} />
      </button>
      {isOpen && (
        <div className="np-playlist-menu" onClick={(e) => e.stopPropagation()}>
          {playlists.length === 0 ? (
            <div className="np-playlist-menu-empty">No playlists yet</div>
          ) : (
            playlists.map((pl) => (
              <button
                key={pl.id}
                className="np-playlist-menu-item"
                onClick={async () => {
                  try {
                    await addToPlaylist(pl.id, {
                      id: 0, playlist_id: pl.id, video_id: currentTrack.id,
                      title: currentTrack.title, artist: currentTrack.artist,
                      thumbnail: currentTrack.thumbnail, position: 0,
                    });
                    addToast(`Added to ${pl.name}`);
                  } catch {
                    addToast("Failed to add to playlist");
                  }
                  onClose();
                }}
              >
                {pl.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function NowPlayingPage({ onBack, onSeek, onToggleQueue }: NowPlayingPageProps) {
  const {
    currentTrack, isPlaying, currentTime, duration,
    volume, isMuted, shuffle, repeat,
    setIsPlaying, playNext, playPrevious,
    setShuffle, setRepeat, setVolume, setIsMuted,
    showLyrics, setShowLyrics, lyricsResult,
  } = usePlayerStore();
  const { isFavorite, toggleFavorite } = usePlaylistStore();
  const addToast = useToastStore((s) => s.addToast);

  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [heartAnimating, setHeartAnimating] = useState(false);

  const hasSyncedLyrics = Boolean(lyricsResult?.is_synced);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.time != null && onSeek) {
        onSeek(detail.time);
      }
    };
    const events = ["seek-to", "lyrics-seek"];
    events.forEach((name) => window.addEventListener(name, handler));
    return () => events.forEach((name) => window.removeEventListener(name, handler));
  }, [onSeek]);

  const seekBarRef = useRef<HTMLDivElement>(null);
  const volumeBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    interface EnrichmentEvent {
      video_id: string;
      album: string | null;
      year: number | null;
      cover_url: string | null;
      artist: string | null;
    }
    const unlisten = listen<EnrichmentEvent>("musicbrainz-enrichment", (event) => {
      const { video_id, album, year, cover_url, artist: mbArtist } = event.payload;
      const track = usePlayerStore.getState().currentTrack;
      if (!track || track.id !== video_id) return;
      const updates: Partial<VideoResult> = {};
      if (!track.album && album) updates.album = album;
      if (!track.release_year && year) updates.release_year = year;
      if (cover_url && (
        track.thumbnail.endsWith("/default.jpg") ||
        track.thumbnail.endsWith("/maxresdefault.jpg") ||
        track.thumbnail === ""
      )) {
        updates.thumbnail = cover_url;
      }
      if (mbArtist && track.artist && mbArtist !== track.artist) {
        const mbArtists = mbArtist.split(", ");
        const currentArtists = track.artist.split(" & ");
        if (mbArtists.length > currentArtists.length) {
          updates.artist = mbArtist;
        }
      }
      if (Object.keys(updates).length > 0) {
        usePlayerStore.getState().enrichCurrentTrack(updates);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    if (!currentTrack?.id) return;
    let cancelled = false;

    enrichTrackBackground(
      currentTrack.id,
      currentTrack.artist || "",
      currentTrack.title
    ).catch(() => {});

    getVideoInfo(currentTrack.id)
      .then((info) => {
        if (!cancelled && (info.format || info.bitrate)) {
          usePlayerStore.getState().enrichCurrentTrack({
            format: info.format,
            bitrate: info.bitrate,
            sample_rate: info.sample_rate,
            channels: info.channels,
          });
        }
      })
      .catch(() => {});

    // Deezer metadata lookup: fixes missing album art / year / label for
    // tracks loaded from the library, liked songs, or playlists (which
    // were saved before Deezer enrichment was available).
    if (
      currentTrack.artist &&
      currentTrack.artist !== "Unknown Artist" &&
      currentTrack.title &&
      currentTrack.title !== "Unknown"
    ) {
      getTrackMetadata(currentTrack.artist, currentTrack.title)
        .then((meta) => {
          if (cancelled) return;
          const track = usePlayerStore.getState().currentTrack;
          if (!track || track.id !== currentTrack.id) return;
          const updates: Partial<VideoResult> = {};
          if (!track.album && meta.album) updates.album = meta.album;
          if (!track.release_year && meta.album_release_date) {
            const year = parseInt(meta.album_release_date.slice(0, 4), 10);
            if (!isNaN(year) && year >= 1900 && year <= 2100) {
              updates.release_year = year;
            }
          }
          // Always upgrade the cover if we have a real one — YouTube
          // thumbnails are often missing or wrong.
          const hiRes = meta.album_cover_large || meta.album_cover_medium || meta.album_cover_small;
          if (hiRes && (
            !track.thumbnail ||
            track.thumbnail.includes("/default.jpg") ||
            track.thumbnail.includes("/maxresdefault.jpg") ||
            track.thumbnail === ""
          )) {
            updates.thumbnail = hiRes;
          }
          if (Object.keys(updates).length > 0) {
            usePlayerStore.getState().enrichCurrentTrack(updates);
          }
        })
        .catch(() => { /* ignore — no metadata found */ });
    }

    return () => { cancelled = true; };
  }, [currentTrack?.id, currentTrack?.artist, currentTrack?.title]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      // ignore fullscreen errors
    }
  }, []);

  useEffect(() => {
    const onFSChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFSChange);
    return () => document.removeEventListener("fullscreenchange", onFSChange);
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!seekBarRef.current || !duration || !onSeek) return;
    const rect = seekBarRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(pct * duration);
  }, [duration, onSeek]);

  const handleSeekMouseDown = useCallback((e: React.MouseEvent) => {
    handleSeek(e);
    const onMouseMove = (ev: MouseEvent) => handleSeek(ev);
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [handleSeek]);

  const handleVolumeChange = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!volumeBarRef.current) return;
    const rect = volumeBarRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setVolume(pct);
    if (isMuted && pct > 0) setIsMuted(false);
  }, [setVolume, isMuted, setIsMuted]);

  const handleVolumeMouseDown = useCallback((e: React.MouseEvent) => {
    handleVolumeChange(e);
    const onMouseMove = (ev: MouseEvent) => handleVolumeChange(ev);
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [handleVolumeChange]);

  const cycleRepeat = useCallback(() => {
    setRepeat(repeat === "off" ? "one" : repeat === "one" ? "all" : "off");
  }, [repeat, setRepeat]);

  const { translations: t } = useLanguageStore();

  if (!currentTrack) {
    return (
      <div className="np-root">
        <button className="np-back-btn" onClick={onBack}>
          <ChevronLeft size={24} />
        </button>
        <div style={{ flex: 1, justifyContent: "center", alignItems: "center", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>
            {t.nowPlaying.noTrack}
          </div>
          <div style={{ fontSize: 14, marginTop: 12, color: "var(--text-muted)" }}>
            {t.nowPlaying.noTrackDesc}
          </div>
        </div>
      </div>
    );
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const fav = isFavorite(currentTrack.id);
  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;

  return (
    <div className="np-root" onClick={() => setShowPlaylistMenu(false)}>
      {/* Dynamic Background */}
      <div className="np-bg">
        <img
          className="np-bg-img"
          src={currentTrack.thumbnail}
          alt=""
          crossOrigin="anonymous"
          draggable={false}
        />
        <div className="np-bg-overlay" />
      </div>

      {/* Top Bar */}
      <div className="np-top">
        <button className="np-back-btn" onClick={onBack} aria-label="Go back">
          <ChevronLeft size={22} />
        </button>
        <span className="np-top-label">{t.nowPlaying.nowPlaying}</span>
        <div className="np-top-actions">
          <button
            className={`np-icon-btn ${showLyrics ? "np-icon-btn-active" : ""}`}
            onClick={(e) => { e.stopPropagation(); setShowLyrics(!showLyrics); }}
            aria-label="Toggle lyrics"
            style={{ position: "relative" }}
          >
            <Mic size={18} />
            {hasSyncedLyrics && !showLyrics && (
              <span className="np-lyrics-available-dot" />
            )}
          </button>
          <button
            className="np-icon-btn"
            onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
            aria-label="Toggle fullscreen"
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
      </div>

      {/* Main Content — Scrollable */}
      <div className="np-scroll">
        {/* Album Art — Square */}
        <div className="np-art-container" style={{ position: "relative" }}>
          <LazyImage
            className="np-art"
            src={currentTrack.thumbnail}
            alt={currentTrack.title}
            fallback={`https://img.youtube.com/vi/${currentTrack.id}/maxresdefault.jpg`}
          />
        </div>

        {/* Track Info + Actions */}
        <div className="np-info-row">
          <div className="np-info-text">
            <h1 className="np-title">{currentTrack.title}</h1>
            <p className="np-artist">{currentTrack.artist}</p>
          </div>
          <div className="np-info-actions">
            <button
              className="np-icon-btn"
              onClick={async (e) => {
                e.stopPropagation();
                setHeartAnimating(true);
                try {
                  await toggleFavorite({
                    id: 0, playlist_id: 0, video_id: currentTrack.id,
                    title: currentTrack.title, artist: currentTrack.artist,
                    thumbnail: currentTrack.thumbnail, position: 0,
                  });
                  addToast(fav ? "Removed from liked songs" : "Added to liked songs");
                } catch {
                  addToast("Failed to update liked songs");
                }
              }}
              aria-label="Toggle favorite"
            >
              <span className={heartAnimating ? "np-heart-pop" : ""}
                onAnimationEnd={() => setHeartAnimating(false)}>
                <Heart
                  size={20}
                  fill={fav ? "var(--accent)" : "none"}
                  color={fav ? "var(--accent)" : "currentColor"}
                />
              </span>
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="np-progress-section">
          <div
            ref={seekBarRef}
            className="np-seekbar"
            onMouseDown={handleSeekMouseDown}
          >
            <div className="np-seekbar-track" />
            <div className="np-seekbar-fill" style={{ width: `${progress}%` }} />
            <div className="np-seekbar-thumb" style={{ left: `${progress}%` }} />
          </div>
          <div className="np-time-row">
            <span className="np-time">{formatTime(currentTime)}</span>
            <span className="np-time">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Primary Controls */}
        <div className="np-controls">
          <button
            className={`np-ctrl-btn ${shuffle ? "np-ctrl-active" : ""}`}
            onClick={(e) => { e.stopPropagation(); setShuffle(!shuffle); }}
            aria-label="Toggle shuffle"
          >
            <Shuffle size={20} />
          </button>

          <button className="np-ctrl-btn np-ctrl-main" onClick={(e) => { e.stopPropagation(); playPrevious(); }} aria-label="Previous track">
            <SkipBack size={24} fill="currentColor" />
          </button>

          <button
            className="np-play-btn"
            onClick={(e) => { e.stopPropagation(); setIsPlaying(!isPlaying); }}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause size={28} fill="currentColor" />
            ) : (
              <Play size={28} fill="currentColor" style={{ marginLeft: 3 }} />
            )}
          </button>

          <button className="np-ctrl-btn np-ctrl-main" onClick={(e) => { e.stopPropagation(); playNext(); }} aria-label="Next track">
            <SkipForward size={24} fill="currentColor" />
          </button>

          <button
            className={`np-ctrl-btn ${repeat !== "off" ? "np-ctrl-active" : ""}`}
            onClick={(e) => { e.stopPropagation(); cycleRepeat(); }}
            aria-label="Toggle repeat"
          >
            <RepeatIcon size={20} />
          </button>
        </div>

        {/* Secondary Controls */}
        <div className="np-secondary">
          <div className="np-volume" onClick={(e) => e.stopPropagation()}>
            <button
              className="np-icon-btn"
              onClick={() => setIsMuted(!isMuted)}
              aria-label="Toggle mute"
            >
              <VolumeIcon size={18} />
            </button>
            <div
              ref={volumeBarRef}
              className="np-vol-bar"
              onMouseDown={handleVolumeMouseDown}
            >
              <div className="np-vol-track" />
              <div className="np-vol-fill" style={{ width: `${isMuted ? 0 : volume * 100}%` }} />
            </div>
          </div>

          <div className="np-utility-btns">
            <PlaylistMenu
              currentTrack={currentTrack}
              isOpen={showPlaylistMenu}
              onToggle={() => setShowPlaylistMenu(!showPlaylistMenu)}
              onClose={() => setShowPlaylistMenu(false)}
            />

            <button
              className="np-icon-btn"
              onClick={(e) => { e.stopPropagation(); onToggleQueue?.(); }}
              aria-label="Toggle queue"
            >
              <List size={18} />
            </button>

            <button className="np-icon-btn" aria-label="More options">
              <MoreHorizontal size={18} />
            </button>
          </div>
        </div>

        {/* Inline Lyrics — scrollable below controls */}
        {showLyrics && (
          <div className="np-lyrics-inline">
            <LyricsPanel />
          </div>
        )}
      </div>
    </div>
  );
}
