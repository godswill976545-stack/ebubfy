import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft,
  ListMusic,
  Trash2,
  Play,
  Shuffle,
  Music,
  Heart,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { usePlaylistStore } from "../store/playlistStore";
import { usePlayerStore } from "../store/playerStore";
import { useLanguageStore } from "../store/languageStore";
import FadingLines from "../components/ui/FadingLines";
import { formatTime } from "../lib/utils";
import type { VideoResult } from "../types";

const LIKED_PLAYLIST_ID = -1;

interface PlaylistPageProps {
  playlistId: number;
  onBack: () => void;
  onPlayTrack: (track: VideoResult, queue?: VideoResult[]) => void;
}

interface SortableTrackProps {
  track: VideoResult;
  index: number;
  isActive: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  onRemove: () => void;
  isLikedView?: boolean;
}

function SortableTrackRow({
  track,
  index,
  isActive,
  isPlaying,
  onPlay,
  onRemove,
  isLikedView,
}: SortableTrackProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: track.id, disabled: isLikedView });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    position: "relative",
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`pl-row ${isActive ? "playing" : ""} ${isDragging ? "dragging" : ""}`}
      onClick={onPlay}
    >
      {/* Column 1: Number + Thumbnail (fixed) */}
      <div className="pl-row-start" {...attributes} {...listeners}>
        <div className="pl-row-num">
          {isActive && isPlaying ? (
            <div className="pl-eq">
              <span /><span /><span />
            </div>
          ) : (
            <span>{index + 1}</span>
          )}
        </div>
        <img
          className="pl-row-thumb"
          src={track.thumbnail}
          alt=""
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${track.id}/default.jpg`;
          }}
        />
      </div>

      {/* Column 2: Title (flexible) */}
      <div className="pl-row-title">{track.title}</div>

      {/* Column 3: Artist (end-aligned) */}
      <div className="pl-row-artist">{track.artist}</div>

      {/* Remove button — overlay on hover */}
      <button
        className="pl-row-remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export default function PlaylistPage({ playlistId, onBack, onPlayTrack }: PlaylistPageProps) {
  const { translations: t } = useLanguageStore();
  const { currentPlaylist, loadPlaylistTracks, removeFromPlaylist, reorderPlaylistSongs, loadFavorites, toggleFavorite } =
    usePlaylistStore();
  const { currentTrack, isPlaying } = usePlayerStore();
  const [tracks, setTracks] = useState<VideoResult[]>([]);
  const [loaded, setLoaded] = useState(false);

  const isLikedView = playlistId === LIKED_PLAYLIST_ID;

  useEffect(() => {
    const loadTracks = async () => {
      setLoaded(false);
      if (isLikedView) {
        await loadFavorites();
        const favs = usePlaylistStore.getState().favorites;
        setTracks(
          favs.map((item) => ({
            id: item.video_id,
            title: item.title,
            artist: item.artist || "Unknown Artist",
            thumbnail:
              item.thumbnail ||
              `https://img.youtube.com/vi/${item.video_id}/default.jpg`,
          }))
        );
      } else {
        const items = await loadPlaylistTracks(playlistId);
        setTracks(
          items.map((item) => ({
            id: item.video_id,
            title: item.title,
            artist: item.artist || "Unknown Artist",
            thumbnail:
              item.thumbnail ||
              `https://img.youtube.com/vi/${item.video_id}/default.jpg`,
          }))
        );
      }
      setLoaded(true);
    };
    loadTracks();
  }, [playlistId, isLikedView, loadFavorites, loadPlaylistTracks]);

  const handleRemoveTrack = async (videoId: string) => {
    if (isLikedView) {
      // For liked songs, toggle favorite to remove
      const track = tracks.find((t) => t.id === videoId);
      if (track) {
        await toggleFavorite({
          id: 0,
          playlist_id: 0,
          position: 0,
          video_id: videoId,
          title: track.title,
          artist: track.artist,
          thumbnail: track.thumbnail,
        });
        // Instantly remove from local state, reload in background
        setTracks((prev) => prev.filter((t) => t.id !== videoId));
        loadFavorites();
      }
    } else {
      await removeFromPlaylist(playlistId, videoId);
      setTracks((prev) => prev.filter((t) => t.id !== videoId));
    }
  };

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      if (isLikedView) return; // No reordering for liked songs
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = tracks.findIndex((t) => t.id === active.id);
      const newIndex = tracks.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...tracks];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);
      setTracks(reordered);

      // Persist the new order to the backend
      await reorderPlaylistSongs(
        playlistId,
        reordered.map((t) => t.id)
      );
    },
    [tracks, playlistId, reorderPlaylistSongs, isLikedView]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4, // Require 4px movement before drag activates
      },
    })
  );

  // Calculate total duration from real duration_seconds data if available
  const totalDurationSeconds = tracks.reduce((sum, t) => sum + (t.duration_seconds || 0), 0);
  const hasRealDurations = tracks.some((t) => t.duration_seconds && t.duration_seconds > 0);
  const totalLabel = hasRealDurations
    ? formatTime(totalDurationSeconds)
    : `~${formatTime(tracks.length * 200)}`;

  return (
    <div className="pl-page">
      <button className="pl-back" onClick={onBack}>
        <ArrowLeft size={20} />
      </button>

      <div className="pl-layout">
        {/* Left column — art + info + actions */}
        <div
          className="pl-left"
          style={{
            background: isLikedView
              ? "linear-gradient(135deg, rgba(67, 56, 202, 0.3), rgba(124, 58, 237, 0.2))"
              : "var(--glass-bg)",
            backdropFilter: "blur(16px) saturate(1.4)",
            WebkitBackdropFilter: "blur(16px) saturate(1.4)",
            border: "1px solid var(--glass-border)",
            borderRadius: "var(--radius-lg)",
          }}
        >
          <div className="pl-art" style={{ position: "relative" }}>
            {tracks.length > 0 ? (
              <>
                <div
                  className="pl-art-glow"
                  style={{
                    backgroundImage: `url(${tracks[0].thumbnail})`,
                  }}
                />
                <img
                  src={tracks[0].thumbnail}
                  alt=""
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${tracks[0].id}/default.jpg`;
                  }}
                />
              </>
            ) : (
              <div className="pl-art-placeholder">
                {isLikedView ? <Heart size={48} /> : <ListMusic size={48} />}
              </div>
            )}
          </div>

          <div className="pl-label">{isLikedView ? t.playlist.labelFavorites : t.playlist.labelPlaylist}</div>
          <h1 className="pl-name">{isLikedView ? t.home.likedSongs : currentPlaylist?.name || "Playlist"}</h1>
          <div className="pl-meta">
            {tracks.length} {tracks.length === 1 ? t.home.songs_one : t.home.songs_other}
            {totalDurationSeconds > 0 && ` · ${totalLabel}`}
          </div>

          <div className="pl-actions">
            {tracks.length > 0 && (
              <button
                className="pl-play-btn"
                onClick={() => onPlayTrack(tracks[0], tracks)}
              >
                <Play size={18} fill="currentColor" /> {t.playlist.playNow}
              </button>
            )}
            {tracks.length > 1 && (
              <button
                className="pl-shuffle-btn"
                onClick={() => {
                  const shuffled = [...tracks].sort(() => Math.random() - 0.5);
                  onPlayTrack(shuffled[0], shuffled);
                }}
              >
                <Shuffle size={18} /> {t.playlist.shuffle}
              </button>
            )}

          </div>


        </div>

        {/* Right column — track list */}
        <div className="pl-right">
          {!loaded ? (
            <div className="pl-empty" style={{ padding: "80px 0", gap: 32 }}>
              <FadingLines lines={6} />
            </div>
          ) : tracks.length === 0 ? (
            <div className="pl-empty">
              {isLikedView ? <Heart size={40} /> : <Music size={40} />}
              <div>{isLikedView ? t.playlist.noLikedSongs : t.playlist.noTracks}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                {isLikedView ? t.playlist.noLikedSongsDesc : t.playlist.noTracksDesc}
              </div>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={tracks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="pl-tracks">
                  {tracks.map((track, index) => (
                    <SortableTrackRow
                      key={track.id}
                      track={track}
                      index={index}
                      isActive={currentTrack?.id === track.id}
                      isPlaying={isPlaying}
                      onPlay={() => onPlayTrack(track, tracks)}
                      onRemove={() => handleRemoveTrack(track.id)}
                      isLikedView={isLikedView}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>
    </div>
  );
}
